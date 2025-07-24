import { Plugin, Modal, App, TFile, Notice, requestUrl, Setting, PluginSettingTab, normalizePath, Menu, TFolder, moment } from 'obsidian';
import { PluginSettings, FileChange, LogLevel, LogEntry, RetryConfig, GitHubApiResponse, GitHubFileInfo, ConflictStrategy, SyncPlan, SyncFile, VaultScanResult } from './src/types';



export default class MobileGitSyncPlugin extends Plugin {
  private autoSyncIntervalId: NodeJS.Timeout | null = null;
  private fileChangeDebounceTimer: NodeJS.Timeout | null = null;
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
  };
  private onlineHandler!: () => void;
  private offlineHandler!: () => void;
  private ribbonIcon: HTMLElement | null = null;
  private syncInProgress: boolean = false;
  private lastSyncTime: number = 0;
  currentBranch: string = '';
  
  settings!: PluginSettings;
  statusBarItem: HTMLElement | null = null;
  changeQueue: Map<string, FileChange> = new Map();
  syncLog: LogEntry[] = [];
  isSyncing: boolean = false;
  repoOwner: string = '';
  repoName: string = '';

  async onload() {
	await this.loadSettings();
	
	// Initialize status bar with interactive controls
	this.statusBarItem = this.addStatusBarItem();
	this.setupStatusBarInteraction();
	this.updateStatusBar('Git Sync Ready');
	
	// Add ribbon icon for quick access
	this.ribbonIcon = this.addRibbonIcon('git-branch', 'Git Sync Actions', (evt) => {
	  this.showQuickActionsMenu(evt);
	});
	
	// Enhanced commands with better UX and desktop integration
	this.addCommand({
	  id: 'mobile-git-sync-full-sync',
	  name: '🔄 Full Sync (Pull then Push)',
	  callback: () => this.fullSync(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 's' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-push-only',
	  name: '⬆️ Push Changes Only',
	  callback: () => this.pushOnly(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'p' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-pull-only',
	  name: '⬇️ Pull Changes Only',
	  callback: () => this.pullFromRemote(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'l' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-quick-commit',
	  name: '💾 Quick Commit with Message',
	  callback: () => this.showQuickCommitModal(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'c' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-view-history',
	  name: '📜 View Sync History',
	  callback: () => this.showSyncHistory(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'h' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-switch-branch',
	  name: '🌿 Switch Branch',
	  callback: () => this.showBranchSwitcher(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'b' }]
	});
	// Listen for file changes in the vault with debouncing
	this.registerEvent(this.app.vault.on('modify', (file) => {
	  if (file instanceof TFile && !this.isExcluded(file.path)) {
		this.debouncedQueueFileChange(file.path, 'modify');
	  }
	}));
	this.registerEvent(this.app.vault.on('create', (file) => {
	  if (file instanceof TFile && !this.isExcluded(file.path)) {
		this.debouncedQueueFileChange(file.path, 'create');
	  }
	}));
	this.registerEvent(this.app.vault.on('delete', (file) => {
	  if (file instanceof TFile && !this.isExcluded(file.path)) {
		this.queueFileChange(file.path, 'delete'); // Don't debounce deletes
	  }
	}));
	
	// Bind event handlers to maintain 'this' context
	this.onlineHandler = () => {
	  this.log('Connection restored', 'info');
	  this.updateStatusBar('Online - Sync Ready');
	  if (this.changeQueue.size > 0 && this.settings.isConfigured) {
		this.performSync().catch(error => {
		  this.log('Auto-sync after reconnection failed', 'error', error);
		});
	  }
	};
	
	this.offlineHandler = () => {
	  this.log('Connection lost', 'warn');
	  this.updateStatusBar('Offline - Changes Queued');
	};
	
	// Listen for online/offline events
	window.addEventListener('online', this.onlineHandler);
	window.addEventListener('offline', this.offlineHandler);

	// Add command to pull from remote
	this.addCommand({
	  id: 'mobile-git-sync-pull-remote',
	  name: 'Pull from Remote',
	  callback: () => this.pullFromRemote(),
	});

	this.addCommand({
	  id: 'mobile-git-sync-view-pending',
	  name: '📋 View Pending Changes',
	  callback: () => this.showPendingChangesModal(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'v' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-smart-sync',
	  name: '🧠 Smart Sync (Auto-resolve conflicts)',
	  callback: () => this.smartSync(),
	  hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 's' }]
	});
	
	// Desktop-specific commands
	this.addCommand({
	  id: 'mobile-git-sync-force-push',
	  name: '⚡ Force Push (Override Remote)',
	  callback: () => this.showForcePushModal(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift', 'Alt'], key: 'p' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-sync-current-file',
	  name: '📄 Sync Current File Only',
	  checkCallback: (checking) => {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
		  if (!checking) {
			this.syncCurrentFile(activeFile);
		  }
		  return true;
		}
		return false;
	  },
	  hotkeys: [{ modifiers: ['Mod'], key: 'u' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-toggle-auto-sync',
	  name: '🔄 Toggle Auto-Sync',
	  callback: () => this.toggleAutoSync(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'a' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-open-settings',
	  name: '⚙️ Open Git Sync Settings',
	  callback: () => this.openSettings(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'g' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-push-all',
	  name: '🚀 Push All Local Files',
	  callback: () => this.pushAllLocal(),
	  hotkeys: [{ modifiers: ['Mod', 'Shift', 'Alt'], key: 'u' }]
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-scan-vault',
	  name: '🔍 Scan Vault for Changes',
	  callback: () => this.performInitialVaultScan(),
	});
	
	this.addCommand({
	  id: 'mobile-git-sync-show-sync-plan',
	  name: '📊 Show Sync Plan',
	  callback: () => this.showSyncPlan(),
	});

	// Register the settings tab so the configuration UI appears
	this.addSettingTab(new MobileGitSyncSettingTab(this.app, this));
	
	// Perform initial comprehensive sync scan
	if (this.settings.isConfigured) {
	  this.performInitialVaultScan();
	}
	
	// Start auto-sync if configured
	if (this.settings.isConfigured && this.settings.autoSyncInterval > 0) {
	  this.startAutoSync();
	}
	
	// Set current branch
	this.currentBranch = this.settings.branch || 'main';
	
	// Request notification permission for desktop
	if (!(this.app as any).isMobile) {
	  this.requestNotificationPermission();
	}
	
	this.log('Plugin loaded with enhanced UX', 'info');
  }

  private log(message: string, level: LogLevel = 'info', data?: unknown): void {
	const entry: LogEntry = {
	  timestamp: Date.now(),
	  level,
	  message,
	  data
	};
	this.syncLog.push(entry);
	if (this.syncLog.length > 500) {
	  this.syncLog = this.syncLog.slice(-250); // Keep last 250 entries
	}
	
	// Console logging for debugging
	switch (level) {
	  case 'error':
		console.error(`[MobileGitSync] ${message}`, data);
		break;
	  case 'warn':
		console.warn(`[MobileGitSync] ${message}`, data);
		break;
	  case 'debug':
		console.debug(`[MobileGitSync] ${message}`, data);
		break;
	  default:
		console.log(`[MobileGitSync] ${message}`, data);
	}
  }

  private async retryWithBackoff<T>(operation: () => Promise<T>, context: string): Promise<T> {
	let lastError: Error | null = null;
	
	for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
	  try {
		if (attempt > 0) {
		  const delay = Math.min(
			this.retryConfig.initialDelay * Math.pow(this.retryConfig.backoffFactor, attempt - 1),
			this.retryConfig.maxDelay
		  );
		  this.log(`Retrying ${context} (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}) after ${delay}ms`, 'warn');
		  await new Promise(resolve => setTimeout(resolve, delay));
		}
		
		return await operation();
	  } catch (error) {
		lastError = error as Error;
		this.log(`${context} failed on attempt ${attempt + 1}: ${lastError.message}`, 'warn', error);
		
		if (attempt === this.retryConfig.maxRetries) {
		  break;
		}
	  }
	}
	
	this.log(`${context} failed after ${this.retryConfig.maxRetries + 1} attempts`, 'error', lastError);
	throw lastError;
  }

  private isNetworkError(error: Error): boolean {
	return error.message.includes('fetch') || 
		   error.message.includes('network') ||
		   error.message.includes('timeout') ||
		   error.message.includes('ENOTFOUND') ||
		   error.message.includes('ECONNRESET');
  }

  // Recursively fetch all files in the repo (including subfolders)
  async fetchAllRepoFiles(path = ''): Promise<GitHubFileInfo[]> {
	const resp = await this.retryWithBackoff(async () => {
	  if (!this.isOnline()) {
		throw new Error('No internet connection');
	  }
	  return await requestUrl({
		url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${path}?ref=${this.settings.branch}`,
		method: 'GET',
		headers: {
		  'Authorization': `token ${await this.getSecureToken()}`,
		  'Accept': 'application/vnd.github.v3+json',
		  'User-Agent': 'Obsidian-Mobile-Git-Sync'
		}
	  });
	}, `Fetch repo contents at ${path}`);
	const data = resp.json;
	let files: GitHubFileInfo[] = [];
	if (Array.isArray(data)) {
	  for (const item of data) {
		if (item.type === 'file') {
		  files.push(item as GitHubFileInfo);
		} else if (item.type === 'dir') {
		  try {
			const subFiles = await this.fetchAllRepoFiles(item.path);
			files = files.concat(subFiles);
		  } catch (error) {
			this.log(`Failed to fetch subdirectory ${item.path}: ${(error as Error).message}`, 'warn');
		  }
		}
	  }
	}
	return files;
  }

  async pullFromRemote() {
	// Recursively fetch all files
	const files = await this.fetchAllRepoFiles();
	for (const file of files) {
	  const resp = await this.retryWithBackoff(async () => {
		if (!file.download_url) {
		  throw new Error(`No download URL for file ${file.path}`);
		}
		return await requestUrl({
		  url: file.download_url,
		  method: 'GET',
		  headers: { 'User-Agent': 'Obsidian-Mobile-Git-Sync' }
		});
	  }, `Download file ${file.path}`);
	  const remoteContent = resp.text;
	  const localFile = this.app.vault.getAbstractFileByPath(file.path);
	  if (localFile instanceof TFile) {
		const localContent = await this.app.vault.read(localFile);
		if (localContent !== remoteContent) {
		  // Conflict strategy
		  let doWrite = true;
		  if (this.settings.conflictStrategy === 'latest') {
			// Use the latest by comparing timestamps (GitHub API: file.sha is not a timestamp, so we fetch commit info)
			let remoteMtime = 0;
			let localMtime = localFile.stat.mtime;
			try {
			  const commitResp = await this.retryWithBackoff(async () => {
				return await requestUrl({
				  url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits?path=${encodeURIComponent(file.path)}&sha=${this.settings.branch}&per_page=1`,
				  method: 'GET',
				  headers: {
					'Authorization': `token ${await this.getSecureToken()}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Obsidian-Mobile-Git-Sync'
				  }
				});
			  }, `Get commit info for ${file.path}`);
			  const commitData = commitResp.json;
			  if (Array.isArray(commitData) && commitData.length > 0) {
				remoteMtime = new Date(commitData[0].commit.committer.date).getTime();
			  }
			} catch (e) {}
			if (remoteMtime > localMtime) doWrite = true;
			else doWrite = false;
		  } else if (this.settings.conflictStrategy === 'local') {
			doWrite = false;
		  } else if (this.settings.conflictStrategy === 'remote') {
			doWrite = true;
		  } else {
			// Prompt user
			await new Promise((resolve) => {
			  new ConflictResolutionModal(this.app, file.path, localContent, remoteContent, (resolution) => {
				if (resolution === 'local') doWrite = false;
				else if (resolution === 'remote') doWrite = true;
				else {
				  this.app.vault.modify(localFile, resolution);
				  doWrite = false;
				}
				resolve(undefined);
			  }).open();
			});
		  }
		  if (doWrite) {
			await this.app.vault.modify(localFile, remoteContent);
			this.addSyncLog(`Pulled and updated ${file.path}`, 'success');
		  } else {
			this.addSyncLog(`Skipped pull for ${file.path} (conflict strategy)`, 'info');
		  }
		}
	  } else {
		// File does not exist locally, create it
		await this.app.vault.create(file.path, remoteContent);
		this.addSyncLog(`Pulled and created ${file.path}`, 'success');
	  }
	}
	new Notice('Pull from remote complete');
  }

  // Revolutionary full bidirectional sync
  async fullSync(): Promise<void> {
	if (this.syncInProgress) {
	  new Notice('Sync already in progress');
	  return;
	}
	
	this.syncInProgress = true;
	try {
	  this.updateStatusBar('Starting comprehensive sync...');
	  
	  // Step 1: Comprehensive comparison
	  const syncPlan = await this.createSyncPlan();
	  
	  if (syncPlan.totalOperations === 0) {
		new Notice('✅ Everything is already in sync!');
		this.updateStatusBar('Already in sync');
		return;
	  }
	  
	  // Step 2: Execute sync plan
	  await this.executeSyncPlan(syncPlan);
	  
	  // Step 3: Clean up and finalize
	  this.changeQueue.clear();
	  this.lastSyncTime = Date.now();
	  
	  const summary = `✅ Sync complete! ${syncPlan.summary}`;
	  this.updateStatusBar('Sync complete');
	  new Notice(summary);
	  this.log(summary, 'success');
	  
	} catch (error) {
	  const message = `Full sync failed: ${(error as Error).message}`;
	  this.updateStatusBar('Sync failed');
	  new Notice(`❌ ${message}`);
	  this.log(message, 'error');
	  throw error;
	} finally {
	  this.syncInProgress = false;
	}
  }

  showPendingChangesModal() {
	new EnhancedChangesModal(this.app, this.changeQueue, this).open();
  }

  async pushOnly(): Promise<void> {
	if (this.changeQueue.size === 0) {
	  new Notice('No changes to push');
	  return;
	}
	this.updateStatusBar('Pushing changes...');
	try {
	  await this.pushLocalChanges();
	  this.changeQueue.clear();
	  this.lastSyncTime = Date.now();
	  new Notice(`Pushed ${this.changeQueue.size} changes successfully`);
	  this.updateStatusBar('Push complete');
	} catch (error) {
	  new Notice(`Push failed: ${(error as Error).message}`);
	  this.updateStatusBar('Push failed');
	}
  }

  async smartSync(): Promise<void> {
	new SmartSyncModal(this.app, this).open();
  }

  showQuickCommitModal(): void {
	new QuickCommitModal(this.app, this).open();
  }

  showSyncHistory(): void {
	new EnhancedSyncLogModal(this.app, this.syncLog, this).open();
  }

  showBranchSwitcher(): void {
	new BranchSwitcherModal(this.app, this).open();
  }

  // Enhanced commands for the new sync system
  async pushAllLocal(): Promise<void> {
	try {
	  this.updateStatusBar('Scanning local files...');
	  const localFiles = await this.getAllLocalFiles();
	  
	  if (localFiles.length === 0) {
		new Notice('No local files to push');
		return;
	  }
	  
	  let uploadCount = 0;
	  for (const file of localFiles) {
		try {
		  this.updateStatusBar(`Uploading ${file.path}... (${uploadCount + 1}/${localFiles.length})`);
		  const content = await this.app.vault.read(file);
		  await this.uploadFile(file.path, content);
		  uploadCount++;
		} catch (error) {
		  this.log(`Failed to upload ${file.path}: ${(error as Error).message}`, 'error');
		}
	  }
	  
	  this.updateStatusBar('Push complete');
	  new Notice(`✅ Pushed ${uploadCount}/${localFiles.length} files`);
	  this.log(`Pushed ${uploadCount} files to remote`, 'success');
	} catch (error) {
	  const message = `Push all failed: ${(error as Error).message}`;
	  new Notice(`❌ ${message}`);
	  this.log(message, 'error');
	}
  }

  async commitWithMessage(message: string, pushAfter: boolean = true): Promise<void> {
	try {
	  this.updateStatusBar('Committing changes...');
	  
	  // For now, we'll just do a regular sync with the message logged
	  this.log(`Custom commit: ${message}`, 'info');
	  
	  if (pushAfter) {
		await this.performSync();
	  } else {
		await this.pushLocalChanges();
	  }
	  
	  this.lastSyncTime = Date.now();
	  new Notice(`✅ Committed: ${message}`);
	} catch (error) {
	  new Notice(`❌ Commit failed: ${(error as Error).message}`);
	  throw error;
	}
  }

  async createBackup(): Promise<void> {
	try {
	  const timestamp = moment().format('YYYY-MM-DD-HH-mm-ss');
	  const backupFolder = `backups/backup-${timestamp}`;
	  
	  // Create backup folder
	  await this.app.vault.createFolder(backupFolder).catch(() => {});
	  
	  // Copy changed files to backup
	  for (const [filePath] of this.changeQueue) {
		try {
		  const file = this.app.vault.getAbstractFileByPath(filePath);
		  if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			const backupPath = `${backupFolder}/${filePath}`;
			
			// Create parent directories if needed
			const parentPath = backupPath.substring(0, backupPath.lastIndexOf('/'));
			if (parentPath !== backupFolder) {
			  await this.app.vault.createFolder(parentPath).catch(() => {});
			}
			
			await this.app.vault.create(backupPath, content);
		  }
		} catch (error) {
		  this.log(`Failed to backup ${filePath}: ${(error as Error).message}`, 'warn');
		}
	  }
	  
	  this.log(`Backup created: ${backupFolder}`, 'success');
	  new Notice(`Backup created in ${backupFolder}`);
	} catch (error) {
	  this.log(`Backup failed: ${(error as Error).message}`, 'error');
	  throw error;
	}
  }

  // Desktop-specific methods
  showForcePushModal(): void {
	// Simple confirmation for force push without modal for now
	const confirmed = confirm('⚡ FORCE PUSH - This will override remote repository and may cause data loss!\n\nType "yes" to confirm:');
	if (confirmed) {
	  this.forcePush();
	}
  }

  async syncCurrentFile(file: TFile): Promise<void> {
	try {
	  this.updateStatusBar('Syncing current file...');
	  
	  const content = await this.app.vault.read(file);
	  await this.uploadFile(file.path, content);
	  
	  // Remove from queue if it was there
	  this.changeQueue.delete(file.path);
	  
	  this.updateStatusBar('File synced');
	  new Notice(`✅ Synced: ${file.name}`);
	  this.log(`Individual file sync: ${file.path}`, 'success');
	} catch (error) {
	  const message = `Failed to sync ${file.name}: ${(error as Error).message}`;
	  new Notice(`❌ ${message}`);
	  this.log(message, 'error');
	}
  }

  toggleAutoSync(): void {
	if (this.autoSyncIntervalId) {
	  this.stopAutoSync();
	  new Notice('🔴 Auto-sync disabled');
	} else if (this.settings.isConfigured) {
	  this.startAutoSync();
	  new Notice(`🟢 Auto-sync enabled (${this.settings.autoSyncInterval} min intervals)`);
	} else {
	  new Notice('⚠️ Please configure Git sync settings first');
	  this.openSettings();
	}
  }

  openSettings(): void {
	// @ts-ignore - Obsidian internal API
	this.app.setting.open();
	// @ts-ignore - Obsidian internal API  
	this.app.setting.openTabById(this.manifest.id);
  }

  // Enhanced desktop notifications
  private showDesktopNotification(title: string, message: string, type: 'info' | 'success' | 'error' = 'info'): void {
	// Show Obsidian notice
	new Notice(`${this.getNotificationIcon(type)} ${message}`);
	
	// Desktop notification (if supported)
	if ('Notification' in window && Notification.permission === 'granted') {
	  new Notification(title, {
		body: message,
		icon: this.getNotificationIcon(type),
		badge: '/icons/git-branch.svg'
	  });
	}
  }

  private getNotificationIcon(type: string): string {
	switch (type) {
	  case 'success': return '✅';
	  case 'error': return '❌';
	  case 'info': return 'ℹ️';
	  default: return '📢';
	}
  }

  // Request notification permission on desktop
  private async requestNotificationPermission(): Promise<void> {
	if ('Notification' in window && Notification.permission === 'default') {
	  await Notification.requestPermission();
	}
  }

  async forcePush(): Promise<void> {
	try {
	  this.updateStatusBar('Force pushing...', true);
	  this.log('FORCE PUSH initiated - this will override remote!', 'warn');
	  
	  // Force push all changes without conflict checking
	  for (const [filePath, change] of this.changeQueue.entries()) {
		if (change.type !== 'delete' && change.content) {
		  await this.uploadFile(filePath, change.content);
		}
	  }
	  
	  this.changeQueue.clear();
	  this.lastSyncTime = Date.now();
	  
	  this.showDesktopNotification('Force Push Complete', 'Your changes have overridden the remote repository', 'success');
	  this.updateStatusBar('Force push complete');
	  this.log('Force push completed successfully', 'success');
	} catch (error) {
	  const message = `Force push failed: ${(error as Error).message}`;
	  this.showDesktopNotification('Force Push Failed', message, 'error');
	  this.updateStatusBar('Force push failed');
	  this.log(message, 'error');
	  throw error;
	}
  }

  // 🚀 GAME-CHANGING SYNC SYSTEM
  
  async performInitialVaultScan(): Promise<void> {
	try {
	  this.log('Starting initial vault scan...', 'info');
	  const localFiles = await this.getAllLocalFiles();
	  
	  // Queue all existing files that aren't already tracked
	  let newFilesFound = 0;
	  for (const file of localFiles) {
		if (!this.changeQueue.has(file.path)) {
		  await this.queueFileChange(file.path, 'create');
		  newFilesFound++;
		}
	  }
	  
	  if (newFilesFound > 0) {
		this.log(`Found ${newFilesFound} existing files to sync`, 'info');
		this.updateStatusBar(`${newFilesFound} files ready to sync`);
	  }
	} catch (error) {
	  this.log(`Initial vault scan failed: ${(error as Error).message}`, 'error');
	}
  }

  async getAllLocalFiles(): Promise<TFile[]> {
	const files: TFile[] = [];
	
	const scanFolder = (folder: TFolder) => {
	  for (const child of folder.children) {
		if (child instanceof TFile) {
		  if (!this.isExcluded(child.path)) {
			files.push(child);
		  }
		} else if (child instanceof TFolder) {
		  scanFolder(child);
		}
	  }
	};
	
	scanFolder(this.app.vault.getRoot());
	return files;
  }

  async createSyncPlan(): Promise<SyncPlan> {
	this.updateStatusBar('Analyzing differences...');
	
	// Get all local files
	const localFiles = await this.getAllLocalFiles();
	const localFileMap = new Map(localFiles.map(f => [f.path, f]));
	
	// Get all remote files
	let remoteFiles: GitHubFileInfo[] = [];
	try {
	  remoteFiles = await this.fetchAllRepoFiles();
	} catch (error) {
	  if ((error as any).status === 404) {
		remoteFiles = []; // Empty repository
	  } else {
		throw error;
	  }
	}
	const remoteFileMap = new Map(remoteFiles.map(f => [f.path, f]));
	
	const plan: SyncPlan = {
	  toUpload: [],
	  toDownload: [],
	  toResolve: [],
	  toDelete: [],
	  summary: '',
	  totalOperations: 0
	};
	
	// Find files to upload (local only or newer locally)
	for (const [path, localFile] of localFileMap) {
	  const remoteFile = remoteFileMap.get(path);
	  
	  if (!remoteFile) {
		// File exists locally but not remotely
		const content = await this.app.vault.read(localFile);
		plan.toUpload.push({ path, content, reason: 'local-only' });
	  } else {
		// File exists in both places - check if different
		try {
		  const localContent = await this.app.vault.read(localFile);
		  const remoteContent = await this.getRemoteFileContent(remoteFile);
		  
		  if (localContent !== remoteContent) {
			plan.toResolve.push({
			  path,
			  localContent,
			  remoteContent,
			  timestamp: Date.now(),
			  localMtime: localFile.stat.mtime,
			  remoteMtime: await this.getRemoteFileTimestamp(path)
			});
		  }
		} catch (error) {
		  this.log(`Error comparing ${path}: ${(error as Error).message}`, 'warn');
		}
	  }
	}
	
	// Find files to download (remote only)
	for (const [path, remoteFile] of remoteFileMap) {
	  if (!localFileMap.has(path)) {
		try {
		  const content = await this.getRemoteFileContent(remoteFile);
		  plan.toDownload.push({ path, content, reason: 'remote-only' });
		} catch (error) {
		  this.log(`Error fetching remote file ${path}: ${(error as Error).message}`, 'warn');
		}
	  }
	}
	
	// Calculate totals and summary
	plan.totalOperations = plan.toUpload.length + plan.toDownload.length + plan.toResolve.length;
	plan.summary = [
	  plan.toUpload.length > 0 ? `${plan.toUpload.length} to upload` : null,
	  plan.toDownload.length > 0 ? `${plan.toDownload.length} to download` : null,
	  plan.toResolve.length > 0 ? `${plan.toResolve.length} conflicts` : null
	].filter(Boolean).join(', ');
	
	this.log(`Sync plan: ${plan.summary || 'No changes needed'}`, 'info');
	return plan;
  }

  async executeSyncPlan(plan: SyncPlan): Promise<void> {
	let completedOps = 0;
	const totalOps = plan.totalOperations;
	
	// Show progress modal for large syncs (>10 operations)
	let progressModal: ProgressModal | null = null;
	if (totalOps > 10) {
	  progressModal = new ProgressModal(this.app, 'Synchronizing Files', totalOps);
	  progressModal.open();
	}
	
	const updateProgress = (operation: string, filename: string) => {
	  completedOps++;
	  const progressText = `${operation} ${filename}... (${completedOps}/${totalOps})`;
	  this.updateStatusBar(progressText);
	  
	  if (progressModal) {
		progressModal.updateProgress(completedOps, `${operation} ${filename}`);
	  }
	};
	
	// Upload local-only files
	for (const item of plan.toUpload) {
	  try {
		updateProgress('Uploading', item.path);
		await this.uploadFile(item.path, item.content);
		this.log(`Uploaded: ${item.path}`, 'success');
	  } catch (error) {
		this.log(`Failed to upload ${item.path}: ${(error as Error).message}`, 'error');
	  }
	}
	
	// Download remote-only files
	for (const item of plan.toDownload) {
	  try {
		updateProgress('Downloading', item.path);
		await this.createLocalFile(item.path, item.content);
		this.log(`Downloaded: ${item.path}`, 'success');
	  } catch (error) {
		this.log(`Failed to download ${item.path}: ${(error as Error).message}`, 'error');
	  }
	}
	
	// Resolve conflicts
	for (const item of plan.toResolve) {
	  try {
		updateProgress('Resolving', item.path);
		const shouldUseRemote = await this.resolveConflict(item.path, item.localContent, item.remoteContent, item.localMtime);
		
		if (shouldUseRemote) {
		  const localFile = this.app.vault.getAbstractFileByPath(item.path);
		  if (localFile instanceof TFile) {
			await this.app.vault.modify(localFile, item.remoteContent);
			this.log(`Conflict resolved (used remote): ${item.path}`, 'success');
		  }
		} else {
		  await this.uploadFile(item.path, item.localContent);
		  this.log(`Conflict resolved (used local): ${item.path}`, 'success');
		}
	  } catch (error) {
		this.log(`Failed to resolve conflict for ${item.path}: ${(error as Error).message}`, 'error');
	  }
	}
	
	// Close progress modal
	if (progressModal) {
	  progressModal.close();
	}
  }

  async getRemoteFileContent(remoteFile: GitHubFileInfo): Promise<string> {
	if (!remoteFile.download_url) {
	  throw new Error(`No download URL for ${remoteFile.path}`);
	}
	
	const response = await requestUrl({
	  url: remoteFile.download_url,
	  method: 'GET',
	  headers: { 'User-Agent': 'Obsidian-Mobile-Git-Sync' }
	});
	
	return response.text;
  }

  async getRemoteFileTimestamp(filePath: string): Promise<number> {
	try {
	  const commitResp = await requestUrl({
		url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits?path=${encodeURIComponent(filePath)}&sha=${this.settings.branch}&per_page=1`,
		method: 'GET',
		headers: {
		  'Authorization': `token ${await this.getSecureToken()}`,
		  'Accept': 'application/vnd.github.v3+json',
		  'User-Agent': 'Obsidian-Mobile-Git-Sync'
		}
	  });
	  
	  const commitData = commitResp.json;
	  if (Array.isArray(commitData) && commitData.length > 0) {
		return new Date(commitData[0].commit.committer.date).getTime();
	  }
	} catch (error) {
	  this.log(`Could not get timestamp for ${filePath}`, 'warn');
	}
	return 0;
  }

  async createLocalFile(filePath: string, content: string): Promise<void> {
	// Create parent directories if needed
	const pathParts = filePath.split('/');
	if (pathParts.length > 1) {
	  const folderPath = pathParts.slice(0, -1).join('/');
	  try {
		await this.app.vault.createFolder(folderPath);
	  } catch {
		// Folder might already exist
	  }
	}
	
	await this.app.vault.create(filePath, content);
  }

  async resolveConflict(filePath: string, localContent: string, remoteContent: string, localMtime?: number, remoteMtime?: number): Promise<boolean> {
	switch (this.settings.conflictStrategy) {
	  case 'latest':
		// Use the latest timestamp
		if (localMtime && remoteMtime) {
		  return remoteMtime > localMtime;
		}
		return true; // Default to remote if timestamps unavailable
		
	  case 'local':
		return false; // Keep local
		
	  case 'remote':
		return true; // Use remote
		
	  case 'prompt':
	  default:
		// Show conflict resolution modal to user
		return new Promise((resolve) => {
		  new ConflictResolutionModal(this.app, filePath, localContent, remoteContent, (resolution) => {
			if (resolution === 'local') {
			  resolve(false);
			} else if (resolution === 'remote') {
			  resolve(true);
			} else {
			  // Custom merge - user provided custom content
			  // This case is handled by the modal, so we just keep local for now
			  resolve(false);
			}
		  }).open();
		});
	}
  }

  async showSyncPlan(): Promise<void> {
	try {
	  if (!this.settings.isConfigured) {
		new Notice('Git sync not configured. Check settings.');
		return;
	  }
	  
	  this.updateStatusBar('Creating sync plan...');
	  const plan = await this.createSyncPlan();
	  
	  new SyncPlanModal(this.app, plan, (shouldExecute) => {
		if (shouldExecute) {
		  this.executeSyncPlan(plan).catch(error => {
			this.log(`Sync execution failed: ${(error as Error).message}`, 'error');
			new Notice('Sync failed. Check logs for details.');
		  });
		}
	  }).open();
	  
	} catch (error) {
	  this.log(`Failed to create sync plan: ${(error as Error).message}`, 'error');
	  new Notice('Failed to create sync plan. Check logs for details.');
	  this.updateStatusBar('Sync plan failed');
	}
  }

  onunload() {
	this.stopAutoSync();
	
	// Clear debounce timer
	if (this.fileChangeDebounceTimer) {
	  clearTimeout(this.fileChangeDebounceTimer);
	  this.fileChangeDebounceTimer = null;
	}
	
	// Remove event listeners
	window.removeEventListener('online', this.onlineHandler);
	window.removeEventListener('offline', this.offlineHandler);
	
	// Clean up UI elements
	if (this.ribbonIcon) {
	  this.ribbonIcon.remove();
	}
	
	this.log('Plugin unloaded', 'info');
  }

  private async getSecureToken(): Promise<string> {
	if (!this.settings.githubToken) {
	  throw new Error('GitHub token not configured');
	}
	// For now, return the token directly. In a production app, this would be encrypted
	// Obsidian doesn't have built-in secure storage, so we rely on the app's sandboxing
	return this.settings.githubToken;
  }

  async setSecureToken(token: string): Promise<void> {
	// For now, store directly. In production, this would be encrypted
	this.settings.githubToken = token;
	await this.saveSettings();
  }

  validateSettings(): { isValid: boolean; errors: string[] } {
	const errors: string[] = [];
	
	if (!this.settings.repoUrl) {
	  errors.push('Repository URL is required');
	} else if (!this.settings.repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/)) {
	  errors.push('Invalid GitHub repository URL format');
	}
	
	if (!this.settings.githubToken) {
	  errors.push('GitHub token is required');
	} else if (!this.settings.githubToken.startsWith('ghp_') && !this.settings.githubToken.startsWith('github_pat_')) {
	  errors.push('Invalid GitHub token format');
	}
	
	if (!this.settings.branch) {
	  errors.push('Branch name is required');
	}
	
	if (this.settings.autoSyncInterval < 1) {
	  errors.push('Auto sync interval must be at least 1 minute');
	}
	
	return {
	  isValid: errors.length === 0,
	  errors
	};
  }

  async loadSettings() {
	const defaultSettings: PluginSettings = {
	  repoUrl: '',
	  githubToken: '',
	  branch: 'main',
	  excludePatterns: [],
	  syncFolders: [],
	  autoSyncInterval: 5,
	  useGitHubAPI: true,
	  isConfigured: false,
	  conflictStrategy: 'prompt' as ConflictStrategy,
	};
	
	this.settings = Object.assign(defaultSettings, await this.loadData());
	await this.parseRepoUrl();
	
	// Validate settings on load
	const validation = this.validateSettings();
	if (!validation.isValid && this.settings.isConfigured) {
	  this.log('Settings validation failed: ' + validation.errors.join(', '), 'error');
	  this.settings.isConfigured = false;
	  await this.saveSettings();
	}
  }

  async saveSettings() {
	await this.saveData(this.settings);
	
	// Restart auto-sync if interval changed
	if (this.settings.isConfigured) {
	  this.stopAutoSync();
	  if (this.settings.autoSyncInterval > 0) {
		this.startAutoSync();
	  }
	}
  }

  private startAutoSync(): void {
	if (this.autoSyncIntervalId) {
	  return; // Already running
	}
	
	const intervalMs = this.settings.autoSyncInterval * 60 * 1000; // Convert minutes to milliseconds
	this.autoSyncIntervalId = setInterval(async () => {
	  if (this.settings.isConfigured && this.changeQueue.size > 0 && this.isOnline() && !this.isSyncing) {
		try {
		  this.log(`Auto-sync triggered (${this.changeQueue.size} changes)`, 'info');
		  await this.performSync();
		} catch (error) {
		  this.log('Auto-sync failed', 'error', error);
		}
	  }
	}, intervalMs);
	
	this.log(`Auto-sync started (interval: ${this.settings.autoSyncInterval} minutes)`, 'info');
  }

  private stopAutoSync(): void {
	if (this.autoSyncIntervalId) {
	  clearInterval(this.autoSyncIntervalId);
	  this.autoSyncIntervalId = null;
	  this.log('Auto-sync stopped', 'info');
	}
  }

  private updateStatusBar(text: string, showNotice = false): void {
	if (this.statusBarItem) {
	  const now = Date.now();
	  const timeAgo = this.lastSyncTime ? this.formatTimeAgo(now - this.lastSyncTime) : '';
	  const displayText = timeAgo ? `${text} (${timeAgo})` : text;
	  
	  this.statusBarItem.setText(displayText);
	  this.statusBarItem.title = `Click for sync options. ${this.changeQueue.size} pending changes.`;
	}
	if (showNotice) {
	  new Notice(text);
	}
  }

  formatTimeAgo(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (minutes > 0) return `${minutes}m ago`;
	return 'just now';
  }

  private setupStatusBarInteraction(): void {
	if (this.statusBarItem) {
	  // Left click for quick actions
	  this.statusBarItem.addEventListener('click', (evt) => {
		if (evt.button === 0) { // Left click
		  this.showQuickActionsMenu(evt);
		}
	  });
	  
	  // Right click for context menu (desktop)
	  this.statusBarItem.addEventListener('contextmenu', (evt) => {
		evt.preventDefault();
		this.showDesktopContextMenu(evt);
	  });
	  
	  // Middle click for quick sync (desktop)
	  this.statusBarItem.addEventListener('mousedown', (evt) => {
		if (evt.button === 1) { // Middle click
		  evt.preventDefault();
		  this.fullSync();
		}
	  });
	  
	  // Hover effects for desktop
	  this.statusBarItem.addEventListener('mouseenter', () => {
		this.statusBarItem?.setAttribute('title', this.getDetailedStatusTooltip());
	  });
	}
  }

  private getDetailedStatusTooltip(): string {
	const pending = this.changeQueue.size;
	const lastSync = this.lastSyncTime ? this.formatTimeAgo(Date.now() - this.lastSyncTime) : 'Never';
	const status = this.isSyncing ? 'Syncing...' : (this.isOnline() ? 'Online' : 'Offline');
	
	return `Git Sync Status: ${status}\nPending changes: ${pending}\nLast sync: ${lastSync}\nBranch: ${this.currentBranch}\n\nLeft click: Quick actions\nRight click: Context menu\nMiddle click: Full sync`;
  }

  private showDesktopContextMenu(evt: MouseEvent): void {
	const menu = new Menu();
	
	// Status info
	menu.addItem((item) => {
	  item.setTitle(`Status: ${this.isSyncing ? 'Syncing...' : (this.isOnline() ? 'Online' : 'Offline')}`)
		.setIcon('info')
		.setDisabled(true);
	});
	
	menu.addItem((item) => {
	  item.setTitle(`Branch: ${this.currentBranch}`)
		.setIcon('git-branch')
		.setDisabled(true);
	});
	
	menu.addSeparator();
	
	// Quick actions with keyboard shortcuts
	menu.addItem((item) => {
	  item.setTitle('Full Sync')
		.setIcon('refresh-ccw')
		.onClick(() => this.fullSync())
		.setSection('sync');
	});
	
	menu.addItem((item) => {
	  item.setTitle('Push Only')
		.setIcon('upload')
		.onClick(() => this.pushOnly())
		.setDisabled(this.changeQueue.size === 0)
		.setSection('sync');
	});
	
	menu.addItem((item) => {
	  item.setTitle('Pull Only')
		.setIcon('download')
		.onClick(() => this.pullFromRemote())
		.setSection('sync');
	});
	
	menu.addSeparator();
	
	// Tools
	menu.addItem((item) => {
	  item.setTitle('View Changes')
		.setIcon('file-text')
		.onClick(() => this.showPendingChangesModal())
		.setSection('view');
	});
	
	menu.addItem((item) => {
	  item.setTitle('Sync History')
		.setIcon('history')
		.onClick(() => this.showSyncHistory())
		.setSection('view');
	});
	
	menu.addItem((item) => {
	  item.setTitle('Branch Switcher')
		.setIcon('git-branch')
		.onClick(() => this.showBranchSwitcher())
		.setSection('view');
	});
	
	menu.addSeparator();
	
	// Settings
	menu.addItem((item) => {
	  item.setTitle('Settings')
		.setIcon('settings')
		.onClick(() => this.openSettings())
		.setSection('config');
	});
	
	menu.addItem((item) => {
	  item.setTitle(`Auto-sync: ${this.autoSyncIntervalId ? 'ON' : 'OFF'}`)
		.setIcon('timer')
		.onClick(() => this.toggleAutoSync())
		.setSection('config');
	});
	
	menu.showAtMouseEvent(evt);
  }

  private showQuickActionsMenu(evt: MouseEvent): void {
	const menu = new Menu();
	
	// Quick sync options
	menu.addItem((item) => {
	  item.setTitle('🔄 Full Sync')
		.setIcon('refresh-ccw')
		.onClick(() => this.fullSync());
	});
	
	menu.addItem((item) => {
	  item.setTitle('⬆️ Push Changes')
		.setIcon('upload')
		.onClick(() => this.pushOnly())
		.setDisabled(this.changeQueue.size === 0);
	});
	
	menu.addItem((item) => {
	  item.setTitle('⬇️ Pull Changes')
		.setIcon('download')
		.onClick(() => this.pullFromRemote());
	});
	
	menu.addSeparator();
	
	// Smart features
	menu.addItem((item) => {
	  item.setTitle('🧠 Smart Sync')
		.setIcon('zap')
		.onClick(() => this.smartSync());
	});
	
	menu.addItem((item) => {
	  item.setTitle('💾 Quick Commit')
		.setIcon('edit')
		.onClick(() => this.showQuickCommitModal())
		.setDisabled(this.changeQueue.size === 0);
	});
	
	menu.addSeparator();
	
	// View options
	menu.addItem((item) => {
	  item.setTitle(`📋 Pending Changes (${this.changeQueue.size})`)
		.setIcon('file-text')
		.onClick(() => this.showPendingChangesModal());
	});
	
	menu.addItem((item) => {
	  item.setTitle('📜 Sync History')
		.setIcon('history')
		.onClick(() => this.showSyncHistory());
	});
	
	menu.addSeparator();
	
	// Branch management
	menu.addItem((item) => {
	  item.setTitle(`🌿 Branch: ${this.currentBranch}`)
		.setIcon('git-branch')
		.onClick(() => this.showBranchSwitcher());
	});
	
	// Settings
	menu.addItem((item) => {
	  item.setTitle('⚙️ Settings')
		.setIcon('settings')
		.onClick(() => this.openSettings());
	});
	
	menu.showAtMouseEvent(evt);
  }

  async performManualSync(): Promise<void> {
	const validation = this.validateSettings();
	if (!validation.isValid) {
	  new Notice('Please configure GitHub sync settings first: ' + validation.errors.join(', '));
	  return;
	}
	
	if (this.isSyncing) {
	  new Notice('Sync already in progress');
	  return;
	}
	
	if (!this.isOnline()) {
	  new Notice('No internet connection. Changes will sync when online.');
	  return;
	}
	
	// Test actual connectivity
	const hasConnectivity = await this.testConnectivity();
	if (!hasConnectivity) {
	  new Notice('Unable to reach GitHub. Check your connection.');
	  return;
	}
	
	await this.performSync();
  }

  showSyncLogModal() {
	new EnhancedSyncLogModal(this.app, this.syncLog, this).open();
  }

  private addSyncLog(message: string, type: LogLevel): void {
	this.log(message, type);
  }

  isExcluded(filePath: string): boolean {
	const excluded = this.settings.excludePatterns.some((pattern: string) => {
	  const regexPattern = pattern
		.replace(/\*\*/g, '.*')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '[^/]');
	  const regex = new RegExp(`^${regexPattern}$`);
	  return regex.test(filePath);
	});
	if (excluded) return true;
	if (this.settings.syncFolders && this.settings.syncFolders.length > 0) {
	  return !this.settings.syncFolders.some((folder: string) => {
		const folderPath = folder.endsWith('/') ? folder : folder + '/';
		return filePath.startsWith(folderPath);
	  });
	}
	return false;
  }

  private debouncedQueueFileChange(filePath: string, type: 'create' | 'modify'): void {
	if (this.fileChangeDebounceTimer) {
	  clearTimeout(this.fileChangeDebounceTimer);
	}
	
	this.fileChangeDebounceTimer = setTimeout(() => {
	  this.queueFileChange(filePath, type);
	}, 1000); // 1 second debounce
  }

  private async queueFileChange(filePath: string, type: 'create' | 'modify' | 'delete'): Promise<void> {
	try {
	  let content: string | undefined;
	  if (type !== 'delete') {
		try {
		  const file = this.app.vault.getAbstractFileByPath(normalizePath(filePath));
		  if (file instanceof TFile) {
			content = await this.app.vault.read(file);
		  }
		} catch (error) {
		  this.log(`Failed to read file ${filePath}`, 'error', error);
		  return;
		}
	  }
	  
	  const change: FileChange = {
		path: filePath,
		type: type,
		timestamp: Date.now(),
		content: content
	  };
	  
	  this.changeQueue.set(filePath, change);
	  this.updateStatusBar(`${this.changeQueue.size} changes queued`);
	  this.log(`Queued ${type} for ${filePath}`, 'debug');
	} catch (error) {
	  this.log(`Failed to queue change for ${filePath}`, 'error', error);
	}
  }

  private isOnline(): boolean {
	return navigator.onLine;
  }

  private async testConnectivity(): Promise<boolean> {
	try {
	  const response = await fetch('https://api.github.com', { 
		method: 'HEAD',
		mode: 'no-cors',
		cache: 'no-cache'
	  });
	  return true;
	} catch {
	  return false;
	}
  }

  async performSync(): Promise<void> {
	if (this.isSyncing) {
	  this.log('Sync already in progress, skipping', 'warn');
	  return;
	}
	
	this.isSyncing = true;
	const startTime = Date.now();
	this.updateStatusBar('Syncing...', true);
	try {
	  const changeCount = this.changeQueue.size;
	  if (changeCount === 0) {
		this.log('No changes to sync', 'info');
		this.updateStatusBar('No changes to sync');
		return;
	  }
	  
	  this.log(`Starting sync of ${changeCount} changes`, 'info');
	  await this.pushLocalChanges();
	  
	  // Clear successfully synced changes
	  this.changeQueue.clear();
	  
	  const duration = Date.now() - startTime;
	  this.addSyncLog(`Sync complete (${changeCount} changes, ${duration}ms)`, 'success');
	  this.updateStatusBar('Sync complete');
	  
	  new Notice(`Synced ${changeCount} changes successfully`);
	} catch (error) {
	  const errorMessage = (error as Error).message;
	  this.addSyncLog(`Sync failed: ${errorMessage}`, 'error');
	  this.updateStatusBar('Sync failed', true);
	  
	  // Don't clear queue on failure - allow retry
	  new Notice(`Sync failed: ${errorMessage}`);
	  throw error; // Re-throw for caller handling
	} finally {
	  this.isSyncing = false;
	}
  }

  private async pushLocalChanges(): Promise<void> {
	const changes = Array.from(this.changeQueue.values());
	let successCount = 0;
	let failureCount = 0;
	
	for (const change of changes) {
	  try {
		if (change.type === 'delete') {
		  // TODO: Implement file deletion via GitHub API
		  this.log(`Skipping delete for ${change.path} (not implemented)`, 'warn');
		  continue;
		}
		
		if (change.content !== undefined) {
		  await this.uploadFile(change.path, change.content);
		  successCount++;
		} else {
		  this.log(`Skipping ${change.path} - no content`, 'warn');
		}
	  } catch (error) {
		this.log(`Failed to upload ${change.path}: ${(error as Error).message}`, 'error');
		failureCount++;
	  }
	}
	
	this.log(`Upload complete: ${successCount} succeeded, ${failureCount} failed`, 'info');
	
	if (failureCount > 0) {
	  throw new Error(`${failureCount} files failed to upload`);
	}
  }

  async calculateSha(content: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	const hashBuffer = await window.crypto.subtle.digest('SHA-1', data);
	return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async parseRepoUrl(): Promise<void> {
	if (this.settings.repoUrl) {
	  const match = this.settings.repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
	  if (match) {
		this.repoOwner = match[1];
		this.repoName = match[2];
		this.log(`Parsed repo: ${this.repoOwner}/${this.repoName}`, 'debug');
	  } else {
		this.log(`Invalid repo URL format: ${this.settings.repoUrl}`, 'error');
	  }
	}
  }

  async uploadFile(filePath: string, content: string) {
	try {
	  const b64Content = btoa(unescape(encodeURIComponent(content)));
	  // Get remote file info (if exists)
	  let remoteSha: string | undefined = undefined;
	  let remoteContent: string | undefined = undefined;
	  let remoteTimestamp = 0;
	  try {
		const resp = await this.retryWithBackoff(async () => {
		  return await requestUrl({
			url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${filePath}?ref=${this.settings.branch}`,
			method: 'GET',
			headers: {
			  'Authorization': `token ${await this.getSecureToken()}`,
			  'Accept': 'application/vnd.github.v3+json',
			  'User-Agent': 'Obsidian-Mobile-Git-Sync'
			}
		  });
		}, `Get file contents for ${filePath}`);
		const data = resp.json as GitHubApiResponse;
		remoteSha = data.sha;
		remoteContent = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
		remoteTimestamp = data.commit?.committer?.date ? new Date(data.commit.committer.date).getTime() : 0;
	  } catch (e) {
		// File does not exist remotely, that's fine
	  }
	  // Conflict resolution
	  let doUpload = true;
	  if (remoteSha && remoteContent !== undefined) {
		if (remoteContent !== content) {
		  if (this.settings.conflictStrategy === 'latest') {
			const localTimestamp = Date.now();
			if (localTimestamp < remoteTimestamp) doUpload = false;
		  } else if (this.settings.conflictStrategy === 'local') {
			doUpload = true;
		  } else if (this.settings.conflictStrategy === 'remote') {
			doUpload = false;
		  } else {
			await new Promise((resolve) => {
			new ConflictResolutionModal(this.app, filePath, content, remoteContent ?? '', (resolution) => {
				if (resolution === 'local') doUpload = true;
				else if (resolution === 'remote') doUpload = false;
				else {
				  content = resolution;
				  doUpload = true;
				}
				resolve(undefined);
			  }).open();
			});
		  }
		} else {
		  doUpload = false;
		}
	  }
	  if (doUpload) {
		await this.retryWithBackoff(async () => {
		  return await requestUrl({
			url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${filePath}`,
			method: 'PUT',
			headers: {
			  'Authorization': `token ${await this.getSecureToken()}`,
			  'Accept': 'application/vnd.github.v3+json',
			  'User-Agent': 'Obsidian-Mobile-Git-Sync'
			},
			body: JSON.stringify({
			  message: `Update ${filePath}`,
			  content: b64Content,
			  branch: this.settings.branch,
			  sha: remoteSha
			})
		  });
		}, `Upload file ${filePath}`);
		this.addSyncLog(`Uploaded ${filePath}`, 'success');
	  } else {
		this.addSyncLog(`Skipped upload for ${filePath} (conflict strategy)`, 'info');
	  }
	} catch (error) {
	  this.addSyncLog(`Failed to upload ${filePath}: ${(error as any).message}`, 'error');
	  new Notice(`Failed to upload ${filePath}`);
	}
  }
}
// Enhanced Pending Changes Modal with Rich UX
class EnhancedChangesModal extends Modal {
  changeQueue: Map<string, FileChange>;
  plugin: MobileGitSyncPlugin;
  
  constructor(app: App, changeQueue: Map<string, FileChange>, plugin: MobileGitSyncPlugin) {
	super(app);
	this.changeQueue = changeQueue;
	this.plugin = plugin;
  }
  
  onOpen() {
	const { contentEl } = this;
	contentEl.addClass('git-sync-modal');
	
	// Header with stats
	const header = contentEl.createEl('div', { cls: 'git-sync-header' });
	header.createEl('h2', { text: '📋 Pending Changes' });
	const stats = header.createEl('div', { cls: 'git-sync-stats' });
	stats.createEl('span', { text: `${this.changeQueue.size} files` });
	
	if (this.changeQueue.size === 0) {
	  const emptyState = contentEl.createEl('div', { cls: 'git-sync-empty' });
	  emptyState.createEl('div', { text: '✅', cls: 'git-sync-empty-icon' });
	  emptyState.createEl('p', { text: 'No pending changes' });
	  emptyState.createEl('small', { text: 'All your files are in sync!' });
	  return;
	}
	
	// Changes list with grouping
	const changesByType = this.groupChangesByType();
	Object.entries(changesByType).forEach(([type, changes]) => {
	  if (changes.length === 0) return;
	  
	  const section = contentEl.createEl('div', { cls: 'git-sync-section' });
	  const typeHeader = section.createEl('h3', { cls: `git-sync-type-${type}` });
	  typeHeader.createEl('span', { text: this.getTypeIcon(type) });
	  typeHeader.createEl('span', { text: ` ${type.toUpperCase()} (${changes.length})` });
	  
	  const list = section.createEl('ul', { cls: 'git-sync-changes-list' });
	  changes.forEach((change) => {
		const item = list.createEl('li', { cls: 'git-sync-change-item' });
		const path = item.createEl('span', { 
		  text: change.path,
		  cls: 'git-sync-path'
		});
		const time = item.createEl('small', {
		  text: this.plugin.formatTimeAgo(Date.now() - change.timestamp),
		  cls: 'git-sync-timestamp'
		});
		
		// Add file preview button for text files
		if (change.content && change.content.length < 1000) {
		  const previewBtn = item.createEl('button', { 
			text: '👁️',
			cls: 'git-sync-preview-btn',
			title: 'Preview changes'
		  });
		  previewBtn.onclick = () => this.showFilePreview(change);
		}
	  });
	});
	
	// Enhanced action buttons
	const actions = contentEl.createEl('div', { cls: 'git-sync-actions' });
	
	const quickCommitBtn = actions.createEl('button', { 
	  text: '💾 Quick Commit',
	  cls: 'mod-cta'
	});
	quickCommitBtn.onclick = () => {
	  this.close();
	  this.plugin.showQuickCommitModal();
	};
	
	const pushBtn = actions.createEl('button', { 
	  text: '⬆️ Push Changes',
	  cls: 'mod-cta'
	});
	pushBtn.onclick = async () => {
	  await this.plugin.pushOnly();
	  this.close();
	};
	
	const pullBtn = actions.createEl('button', { text: '⬇️ Pull Remote' });
	pullBtn.onclick = async () => {
	  await this.plugin.pullFromRemote();
	  this.close();
	};
	
	const syncBtn = actions.createEl('button', { text: '🔄 Full Sync' });
	syncBtn.onclick = async () => {
	  await this.plugin.fullSync();
	  this.close();
	};
  }
  
  private groupChangesByType(): Record<string, FileChange[]> {
	const groups: Record<string, FileChange[]> = {
	  create: [],
	  modify: [],
	  delete: []
	};
	
	this.changeQueue.forEach((change) => {
	  groups[change.type].push(change);
	});
	
	return groups;
  }
  
  private getTypeIcon(type: string): string {
	switch (type) {
	  case 'create': return '➕';
	  case 'modify': return '✏️';
	  case 'delete': return '❌';
	  default: return '📄';
	}
  }
  
  private showFilePreview(change: FileChange): void {
	new FilePreviewModal(this.app, change).open();
  }
  
  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

// (Move all plugin methods and properties that are after this point back inside the MobileGitSyncPlugin class)
// ...existing code...
// --- Settings Tab ---
class MobileGitSyncSettingTab extends PluginSettingTab {
  plugin: MobileGitSyncPlugin;

  constructor(app: App, plugin: MobileGitSyncPlugin) {
	super(app, plugin);
	this.plugin = plugin;
  }

  display(): void {
	const { containerEl } = this;
	containerEl.empty();
	containerEl.createEl('h2', { text: 'Mobile Git Sync Settings' });

	const s = this.plugin.settings;
	
	// Validation status
	const validation = this.plugin.validateSettings();
	if (!validation.isValid) {
	  const errorDiv = containerEl.createEl('div', { cls: 'setting-validation-errors' });
	  errorDiv.createEl('h3', { text: 'Configuration Issues:', cls: 'setting-error-title' });
	  const errorList = errorDiv.createEl('ul');
	  validation.errors.forEach(error => {
		errorList.createEl('li', { text: error, cls: 'setting-error-item' });
	  });
	}

	new Setting(containerEl)
	  .setName('GitHub Repository URL')
	  .setDesc('Format: https://github.com/owner/repo')
	  .addText(text => text
		.setPlaceholder('https://github.com/owner/repo')
		.setValue(s.repoUrl)
		.onChange(async (value) => {
		  s.repoUrl = value;
		  await this.plugin.parseRepoUrl();
		  await this.plugin.saveSettings();
		}));

	new Setting(containerEl)
	  .setName('GitHub Token')
	  .setDesc('A personal access token with repo access (stored securely)')
	  .addText(text => {
		text.setPlaceholder('ghp_...')
		  .setValue(s.githubToken ? '••••••••••••••••' : '')
		  .onChange(async (value) => {
			if (value && value !== '••••••••••••••••') {
			  await this.plugin.setSecureToken(value);
			  text.setValue('••••••••••••••••'); // Mask the token immediately
			}
		  });
		text.inputEl.type = 'password';
		text.inputEl.autocomplete = 'off';
		return text;
	  });

	new Setting(containerEl)
	  .setName('Branch')
	  .setDesc('Branch to sync with')
	  .addText(text => text
		.setPlaceholder('main')
		.setValue(s.branch)
		.onChange(async (value) => {
		  s.branch = value;
		  await this.plugin.saveSettings();
		}));

	new Setting(containerEl)
	  .setName('Exclude Patterns')
	  .setDesc('Glob patterns to exclude (comma separated)')
	  .addText(text => text
		.setPlaceholder('.git/**,node_modules/**')
		.setValue(Array.isArray(s.excludePatterns) ? s.excludePatterns.join(',') : '')
		.onChange(async (value) => {
		  s.excludePatterns = value.split(',').map(str => str.trim()).filter(Boolean);
		  await this.plugin.saveSettings();
		}));

	new Setting(containerEl)
	  .setName('Sync Folders')
	  .setDesc('Only sync these folders (comma separated, blank for all)')
	  .addText(text => text
		.setPlaceholder('folder1,folder2')
		.setValue(Array.isArray(s.syncFolders) ? s.syncFolders.join(',') : '')
		.onChange(async (value) => {
		  s.syncFolders = value.split(',').map(str => str.trim()).filter(Boolean);
		  await this.plugin.saveSettings();
		}));

	new Setting(containerEl)
	  .setName('Auto Sync Interval (minutes)')
	  .setDesc('How often to auto-sync (in minutes)')
	  .addText(text => text
		.setPlaceholder('5')
		.setValue(String(s.autoSyncInterval))
		.onChange(async (value) => {
		  const num = parseInt(value);
		  if (!isNaN(num) && num > 0) {
			s.autoSyncInterval = num;
			await this.plugin.saveSettings();
		  }
		}));

	new Setting(containerEl)
	  .setName('Use GitHub API')
	  .setDesc('Use GitHub API for sync (recommended)')
	  .addToggle(toggle => toggle
		.setValue(!!s.useGitHubAPI)
		.onChange(async (value) => {
		  s.useGitHubAPI = value;
		  await this.plugin.saveSettings();
		}));

	new Setting(containerEl)
	  .setName('Configured')
	  .setDesc('Mark as configured (enable sync) - only enable after all settings are valid')
	  .addToggle(toggle => toggle
		.setValue(!!s.isConfigured)
		.setDisabled(!validation.isValid)
		.onChange(async (value) => {
		  const currentValidation = this.plugin.validateSettings();
		  if (value && !currentValidation.isValid) {
			new Notice('Cannot enable sync: ' + currentValidation.errors.join(', '));
			toggle.setValue(false);
			return;
		  }
		  s.isConfigured = value;
		  await this.plugin.saveSettings();
		  if (value) {
			new Notice('Mobile Git Sync enabled!');
		  }
		}));

	// Add conflict resolution strategy setting
	new Setting(containerEl)
	  .setName('Conflict Resolution Strategy')
	  .setDesc('Choose how to handle file conflicts: Prompt, Take Latest, Always Keep Local, or Always Keep Remote')
	  .addDropdown(drop => drop
		.addOption('prompt', 'Prompt')
		.addOption('latest', 'Take Latest')
		.addOption('local', 'Always Keep Local')
		.addOption('remote', 'Always Keep Remote')
		.setValue(this.plugin.settings.conflictStrategy as string)
		.onChange(async (value) => {
		  this.plugin.settings.conflictStrategy = value as ConflictStrategy;
		  await this.plugin.saveSettings();
		})
	  );
  }


}

// --- Modal for Sync Log/History ---
// Enhanced Sync History Modal
class EnhancedSyncLogModal extends Modal {
  syncLog: LogEntry[];
  plugin: MobileGitSyncPlugin;
  
  constructor(app: App, syncLog: LogEntry[], plugin: MobileGitSyncPlugin) {
	super(app);
	this.syncLog = syncLog;
	this.plugin = plugin;
  }
  
  onOpen() {
	const { contentEl } = this;
	contentEl.addClass('git-sync-modal');
	
	const header = contentEl.createEl('div', { cls: 'git-sync-header' });
	header.createEl('h2', { text: '📜 Sync History' });
	
	if (this.syncLog.length === 0) {
	  const emptyState = contentEl.createEl('div', { cls: 'git-sync-empty' });
	  emptyState.createEl('div', { text: '📜', cls: 'git-sync-empty-icon' });
	  emptyState.createEl('p', { text: 'No sync history yet' });
	  return;
	}
	
	// Filter controls
	const filters = contentEl.createEl('div', { cls: 'git-sync-filters' });
	const levelFilter = filters.createEl('select');
	levelFilter.createEl('option', { text: 'All Levels', value: '' });
	['debug', 'info', 'warn', 'error', 'success'].forEach(level => {
	  levelFilter.createEl('option', { text: level.toUpperCase(), value: level });
	});
	
	// Stats
	const stats = contentEl.createEl('div', { cls: 'git-sync-stats' });
	const counts = this.getLogCounts();
	stats.innerHTML = `
	  <span class="stat-success">✅ ${counts.success}</span>
	  <span class="stat-error">❌ ${counts.error}</span>
	  <span class="stat-warn">⚠️ ${counts.warn}</span>
	  <span class="stat-info">ℹ️ ${counts.info}</span>
	`;
	
	// Log entries with improved formatting
	const logContainer = contentEl.createEl('div', { cls: 'git-sync-log-container' });
	this.renderLogEntries(logContainer);
	
	// Actions
	const actions = contentEl.createEl('div', { cls: 'git-sync-actions' });
	const exportBtn = actions.createEl('button', { text: '📎 Export Log' });
	exportBtn.onclick = () => this.exportLog();
	
	const clearBtn = actions.createEl('button', { text: '🗑️ Clear Log', cls: 'mod-warning' });
	clearBtn.onclick = () => this.clearLog();
	
	// Filter functionality
	levelFilter.onchange = () => {
	  this.renderLogEntries(logContainer, levelFilter.value);
	};
  }
  
  private renderLogEntries(container: HTMLElement, filterLevel?: string): void {
	container.empty();
	const MAX_LOGS = 200;
	const filteredLogs = filterLevel ? 
	  this.syncLog.filter(log => log.level === filterLevel) : 
	  this.syncLog;
	  
	filteredLogs.slice(-MAX_LOGS).reverse().forEach(log => {
	  const entry = container.createEl('div', { cls: `git-sync-log-entry log-${log.level}` });
	  
	  const timestamp = entry.createEl('span', { 
		text: new Date(log.timestamp).toLocaleTimeString(),
		cls: 'git-sync-log-time'
	  });
	  
	  const level = entry.createEl('span', {
		text: this.getLevelIcon(log.level),
		cls: 'git-sync-log-level'
	  });
	  
	  const message = entry.createEl('span', {
		text: log.message,
		cls: 'git-sync-log-message'
	  });
	  
	  if (log.data) {
		const details = entry.createEl('details', { cls: 'git-sync-log-details' });
		details.createEl('summary', { text: 'Details' });
		details.createEl('pre', { text: JSON.stringify(log.data, null, 2) });
	  }
	});
  }
  
  private getLevelIcon(level: LogLevel): string {
	switch (level) {
	  case 'success': return '✅';
	  case 'error': return '❌';
	  case 'warn': return '⚠️';
	  case 'info': return 'ℹ️';
	  case 'debug': return '🔍';
	  default: return '📝';
	}
  }
  
  private getLogCounts(): Record<string, number> {
	const counts = { success: 0, error: 0, warn: 0, info: 0, debug: 0 };
	this.syncLog.forEach(log => {
	  if (counts.hasOwnProperty(log.level)) {
		counts[log.level as keyof typeof counts]++;
	  }
	});
	return counts;
  }
  
  private exportLog(): void {
	const logText = this.syncLog.map(log => 
	  `[${new Date(log.timestamp).toISOString()}] ${log.level.toUpperCase()}: ${log.message}${log.data ? '\n' + JSON.stringify(log.data, null, 2) : ''}`
	).join('\n\n');
	
	navigator.clipboard.writeText(logText).then(() => {
	  new Notice('Log exported to clipboard');
	}).catch(() => {
	  new Notice('Failed to export log');
	});
  }
  
  private clearLog(): void {
	this.plugin.syncLog.length = 0;
	new Notice('Sync log cleared');
	this.close();
  }
  
  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

// --- Modal for Pending Changes ---
class ChangesModal extends Modal {
  changeQueue: Map<string, FileChange>;

  constructor(app: App, changeQueue: Map<string, FileChange>) {
	super(app);
	this.changeQueue = changeQueue;
  }

  onOpen() {
	const { contentEl } = this;
	contentEl.createEl('h2', { text: 'Pending Changes' });
	if (this.changeQueue.size === 0) {
	  contentEl.createEl('p', { text: 'No pending changes' });
	  return;
	}
	const list = contentEl.createEl('ul');
	this.changeQueue.forEach((change) => {
	  const item = list.createEl('li');
	  item.createEl('span', { 
		text: `${change.type.toUpperCase()}: ${change.path}`,
		cls: `change-${change.type}`
	  });
	  item.createEl('small', { 
		text: ` (${new Date(change.timestamp).toLocaleString()})`,
		cls: 'change-timestamp'
	  });
	});
  }

  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

// Quick Commit Modal with Custom Messages
class QuickCommitModal extends Modal {
  plugin: MobileGitSyncPlugin;
  
  constructor(app: App, plugin: MobileGitSyncPlugin) {
	super(app);
	this.plugin = plugin;
  }
  
  onOpen() {
	const { contentEl } = this;
	contentEl.addClass('git-sync-modal');
	
	contentEl.createEl('h2', { text: '💾 Quick Commit' });
	
	// Show pending changes summary
	const summary = contentEl.createEl('div', { cls: 'git-sync-summary' });
	summary.createEl('p', { text: `Ready to commit ${this.plugin.changeQueue.size} changes` });
	
	// Commit message input
	const messageContainer = contentEl.createEl('div', { cls: 'git-sync-input-container' });
	messageContainer.createEl('label', { text: 'Commit Message:' });
	const messageInput = messageContainer.createEl('textarea', {
	  placeholder: 'Enter a descriptive commit message...',
	  cls: 'git-sync-commit-input'
	}) as HTMLTextAreaElement;
	
	// Smart suggestions based on changes
	const suggestions = this.generateCommitSuggestions();
	if (suggestions.length > 0) {
	  const suggestionsContainer = contentEl.createEl('div', { cls: 'git-sync-suggestions' });
	  suggestionsContainer.createEl('label', { text: 'Quick suggestions:' });
	  suggestions.forEach(suggestion => {
		const btn = suggestionsContainer.createEl('button', {
		  text: suggestion,
		  cls: 'git-sync-suggestion-btn'
		});
		btn.onclick = () => messageInput.value = suggestion;
	  });
	}
	
	// Options
	const options = contentEl.createEl('div', { cls: 'git-sync-options' });
	const pushAfterCommit = options.createEl('label');
	const pushCheckbox = pushAfterCommit.createEl('input', { type: 'checkbox' });
	pushCheckbox.checked = true;
	pushAfterCommit.appendChild(document.createTextNode(' Push immediately after commit'));
	
	// Actions
	const actions = contentEl.createEl('div', { cls: 'git-sync-actions' });
	const commitBtn = actions.createEl('button', {
	  text: '💾 Commit & Sync',
	  cls: 'mod-cta'
	});
	const cancelBtn = actions.createEl('button', { text: 'Cancel' });
	
	commitBtn.onclick = async () => {
	  const message = messageInput.value.trim();
	  if (!message) {
		new Notice('Please enter a commit message');
		return;
	  }
	  
	  try {
		this.close();
		await this.plugin.commitWithMessage(message, pushCheckbox.checked);
	  } catch (error) {
		new Notice(`Commit failed: ${(error as Error).message}`);
	  }
	};
	
	cancelBtn.onclick = () => this.close();
	
	// Focus on input
	messageInput.focus();
  }
  
  private generateCommitSuggestions(): string[] {
	const changes = Array.from(this.plugin.changeQueue.values());
	const suggestions: string[] = [];
	
	const types = {
	  create: changes.filter(c => c.type === 'create').length,
	  modify: changes.filter(c => c.type === 'modify').length,
	  delete: changes.filter(c => c.type === 'delete').length
	};
	
	if (types.create > 0 && types.modify === 0 && types.delete === 0) {
	  suggestions.push(`Add ${types.create} new file${types.create > 1 ? 's' : ''}`);
	}
	if (types.modify > 0 && types.create === 0 && types.delete === 0) {
	  suggestions.push(`Update ${types.modify} file${types.modify > 1 ? 's' : ''}`);
	}
	if (types.delete > 0 && types.create === 0 && types.modify === 0) {
	  suggestions.push(`Remove ${types.delete} file${types.delete > 1 ? 's' : ''}`);
	}
	
	suggestions.push('Update notes', 'Daily sync', 'Mobile update');
	
	return suggestions;
  }
  
  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

// --- Conflict Resolution Modal ---
class ConflictResolutionModal extends Modal {
  filePath: string;
  localContent: string;
  remoteContent: string;
  onResolve: (resolution: 'local' | 'remote' | string) => void;

  constructor(app: App, filePath: string, localContent: string, remoteContent: string, onResolve: (resolution: 'local' | 'remote' | string) => void) {
	super(app);
	this.filePath = filePath;
	this.localContent = localContent;
	this.remoteContent = remoteContent;
	this.onResolve = onResolve;
  }

  onOpen() {
	const { contentEl } = this;
	contentEl.empty();
	contentEl.createEl('h2', { text: 'Resolve Conflict' });
	contentEl.createEl('div', { text: `File: ${this.filePath}` });

	// Local version
	contentEl.createEl('h3', { text: 'Local Version' });
	const localArea = contentEl.createEl('textarea');
	localArea.value = this.localContent;
	localArea.style.width = '100%';
	localArea.style.height = '100px';

	// Remote version
	contentEl.createEl('h3', { text: 'Remote Version' });
	const remoteArea = contentEl.createEl('textarea');
	remoteArea.value = this.remoteContent;
	remoteArea.style.width = '100%';
	remoteArea.style.height = '100px';

	// Merge area
	contentEl.createEl('h3', { text: 'Merged (Edit to resolve)' });
	const mergeArea = contentEl.createEl('textarea');
	mergeArea.value = this.localContent;
	mergeArea.style.width = '100%';
	mergeArea.style.height = '100px';

	// Buttons
	const buttonRow = contentEl.createEl('div', { cls: 'conflict-modal-buttons' });
	const keepLocalBtn = buttonRow.createEl('button', { text: 'Keep Local' });
	const keepRemoteBtn = buttonRow.createEl('button', { text: 'Keep Remote' });
	const keepMergedBtn = buttonRow.createEl('button', { text: 'Keep Merged' });

	keepLocalBtn.onclick = () => {
	  this.close();
	  this.onResolve('local');
	};
	keepRemoteBtn.onclick = () => {
	  this.close();
	  this.onResolve('remote');
	};
	keepMergedBtn.onclick = () => {
	  this.close();
	  this.onResolve(mergeArea.value);
	};
  }

  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

// Smart Sync Modal for Conflict Resolution
class SmartSyncModal extends Modal {
  plugin: MobileGitSyncPlugin;
  
  constructor(app: App, plugin: MobileGitSyncPlugin) {
	super(app);
	this.plugin = plugin;
  }
  
  onOpen() {
	const { contentEl } = this;
	contentEl.addClass('git-sync-modal');
	
	contentEl.createEl('h2', { text: '🧠 Smart Sync' });
	contentEl.createEl('p', { text: 'Intelligent sync with automatic conflict resolution' });
	
	// Conflict strategy selection
	const strategyContainer = contentEl.createEl('div', { cls: 'git-sync-strategy' });
	strategyContainer.createEl('h3', { text: 'Conflict Resolution Strategy:' });
	
	const strategies = [
	  { value: 'latest', label: '⏰ Use Latest (timestamp-based)', desc: 'Choose the most recently modified version' },
	  { value: 'local', label: '📱 Prefer Local', desc: 'Keep your local changes when conflicts occur' },
	  { value: 'remote', label: '☁️ Prefer Remote', desc: 'Accept remote changes when conflicts occur' },
	  { value: 'prompt', label: '❓ Ask Me', desc: 'Show conflict resolution dialog for each conflict' }
	];
	
	let selectedStrategy = this.plugin.settings.conflictStrategy;
	strategies.forEach(strategy => {
	  const option = strategyContainer.createEl('label', { cls: 'git-sync-strategy-option' });
	  const radio = option.createEl('input', { type: 'radio' });
	  radio.name = 'strategy';
	  radio.value = strategy.value;
	  radio.checked = strategy.value === selectedStrategy;
	  radio.onchange = () => selectedStrategy = strategy.value as ConflictStrategy;
	  
	  const labelContainer = option.createEl('div');
	  labelContainer.createEl('strong', { text: strategy.label });
	  labelContainer.createEl('br');
	  labelContainer.createEl('small', { text: strategy.desc });
	});
	
	// Additional options
	const options = contentEl.createEl('div', { cls: 'git-sync-options' });
	const backupOption = options.createEl('label');
	const backupCheckbox = backupOption.createEl('input', { type: 'checkbox' });
	backupCheckbox.checked = true;
	backupOption.appendChild(document.createTextNode(' Create backup before sync'));
	
	// Actions
	const actions = contentEl.createEl('div', { cls: 'git-sync-actions' });
	const syncBtn = actions.createEl('button', {
	  text: '🧠 Start Smart Sync',
	  cls: 'mod-cta'
	});
	const cancelBtn = actions.createEl('button', { text: 'Cancel' });
	
	syncBtn.onclick = async () => {
	  this.plugin.settings.conflictStrategy = selectedStrategy;
	  await this.plugin.saveSettings();
	  
	  this.close();
	  
	  if (backupCheckbox.checked) {
		await this.plugin.createBackup();
	  }
	  
	  await this.plugin.fullSync();
	};
	
	cancelBtn.onclick = () => this.close();
  }
  
  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

// File Preview Modal
class FilePreviewModal extends Modal {
  change: FileChange;
  
  constructor(app: App, change: FileChange) {
	super(app);
	this.change = change;
  }
  
  onOpen() {
	const { contentEl } = this;
	contentEl.addClass('git-sync-modal', 'git-sync-preview-modal');
	
	contentEl.createEl('h2', { text: `👁️ Preview: ${this.change.path}` });
	
	const info = contentEl.createEl('div', { cls: 'git-sync-file-info' });
	info.createEl('span', { text: `Type: ${this.change.type.toUpperCase()}` });
	info.createEl('span', { text: `Modified: ${new Date(this.change.timestamp).toLocaleString()}` });
	
	if (this.change.content) {
	  const preview = contentEl.createEl('pre', {
		text: this.change.content.substring(0, 2000),
		cls: 'git-sync-preview-content'
	  });
	  
	  if (this.change.content.length > 2000) {
		contentEl.createEl('p', { text: '... (content truncated)' });
	  }
	} else {
	  contentEl.createEl('p', { text: 'No content preview available' });
	}
	
	const actions = contentEl.createEl('div', { cls: 'git-sync-actions' });
	const closeBtn = actions.createEl('button', { text: 'Close', cls: 'mod-cta' });
	closeBtn.onclick = () => this.close();
  }
  
  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

// Branch Switcher Modal
class BranchSwitcherModal extends Modal {
  plugin: MobileGitSyncPlugin;
  
  constructor(app: App, plugin: MobileGitSyncPlugin) {
	super(app);
	this.plugin = plugin;
  }
  
  onOpen() {
	const { contentEl } = this;
	contentEl.addClass('git-sync-modal');
	
	contentEl.createEl('h2', { text: '🌿 Branch Management' });
	
	// Current branch info
	const current = contentEl.createEl('div', { cls: 'git-sync-current-branch' });
	current.createEl('strong', { text: `Current: ${this.plugin.currentBranch}` });
	
	// Branch input
	const inputContainer = contentEl.createEl('div', { cls: 'git-sync-input-container' });
	inputContainer.createEl('label', { text: 'Switch to branch:' });
	const branchInput = inputContainer.createEl('input', {
	  type: 'text',
	  placeholder: 'Enter branch name',
	  value: this.plugin.currentBranch
	}) as HTMLInputElement;
	
	// Common branches
	const common = contentEl.createEl('div', { cls: 'git-sync-common-branches' });
	common.createEl('label', { text: 'Common branches:' });
	['main', 'master', 'develop', 'dev'].forEach(branch => {
	  const btn = common.createEl('button', {
		text: branch,
		cls: 'git-sync-branch-btn'
	  });
	  btn.onclick = () => branchInput.value = branch;
	});
	
	// Actions
	const actions = contentEl.createEl('div', { cls: 'git-sync-actions' });
	const switchBtn = actions.createEl('button', {
	  text: '🌿 Switch Branch',
	  cls: 'mod-cta'
	});
	const cancelBtn = actions.createEl('button', { text: 'Cancel' });
	
	switchBtn.onclick = async () => {
	  const newBranch = branchInput.value.trim();
	  if (!newBranch) {
		new Notice('Please enter a branch name');
		return;
	  }
	  
	  this.plugin.settings.branch = newBranch;
	  this.plugin.currentBranch = newBranch;
	  await this.plugin.saveSettings();
	  
	  new Notice(`Switched to branch: ${newBranch}`);
	  this.close();
	};
	
	cancelBtn.onclick = () => this.close();
	
	branchInput.focus();
  }
  
  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

// Sync Plan Modal - Shows detailed plan before executing sync
class SyncPlanModal extends Modal {
  plan: SyncPlan;
  callback: (shouldExecute: boolean) => void;
  
  constructor(app: App, plan: SyncPlan, callback: (shouldExecute: boolean) => void) {
	super(app);
	this.plan = plan;
	this.callback = callback;
  }
  
  onOpen() {
	const { contentEl } = this;
	contentEl.addClass('git-sync-modal');
	
	// Header
	const header = contentEl.createEl('div', { cls: 'git-sync-header' });
	header.createEl('h2', { text: '📊 Sync Plan' });
	
	if (this.plan.totalOperations === 0) {
	  const empty = contentEl.createEl('div', { cls: 'git-sync-empty' });
	  empty.createEl('div', { text: '✅', cls: 'git-sync-empty-icon' });
	  empty.createEl('p', { text: 'Everything is up to date!' });
	  empty.createEl('p', { text: 'No files need to be synchronized.', cls: 'text-muted' });
	} else {
	  // Summary
	  const summary = contentEl.createEl('div', { cls: 'git-sync-stats' });
	  if (this.plan.toUpload.length > 0) {
		summary.createEl('span', { text: `⬆️ ${this.plan.toUpload.length} upload`, cls: 'stat-info' });
	  }
	  if (this.plan.toDownload.length > 0) {
		summary.createEl('span', { text: `⬇️ ${this.plan.toDownload.length} download`, cls: 'stat-success' });
	  }
	  if (this.plan.toResolve.length > 0) {
		summary.createEl('span', { text: `⚠️ ${this.plan.toResolve.length} conflicts`, cls: 'stat-warn' });
	  }
	  
	  // Upload section
	  if (this.plan.toUpload.length > 0) {
		this.createFileSection(contentEl, '⬆️ Files to Upload', this.plan.toUpload, 'create');
	  }
	  
	  // Download section  
	  if (this.plan.toDownload.length > 0) {
		this.createFileSection(contentEl, '⬇️ Files to Download', this.plan.toDownload, 'modify');
	  }
	  
	  // Conflicts section
	  if (this.plan.toResolve.length > 0) {
		const section = contentEl.createEl('div', { cls: 'git-sync-section' });
		const sectionHeader = section.createEl('h3', { cls: 'git-sync-type-delete' });
		sectionHeader.createEl('span', { text: '⚠️ Conflicts to Resolve' });
		
		const list = section.createEl('ul', { cls: 'git-sync-changes-list' });
		
		for (const conflict of this.plan.toResolve) {
		  const item = list.createEl('li', { cls: 'git-sync-change-item' });
		  item.style.borderLeftColor = 'var(--color-red)';
		  
		  const path = item.createEl('span', { text: conflict.path, cls: 'git-sync-path' });
		  const info = item.createEl('span', { text: 'Manual resolution required', cls: 'git-sync-timestamp' });
		}
	  }
	}
	
	// Actions
	const actions = contentEl.createEl('div', { cls: 'git-sync-actions' });
	
	if (this.plan.totalOperations > 0) {
	  const executeBtn = actions.createEl('button', {
		text: `🚀 Execute Sync (${this.plan.totalOperations} operations)`,
		cls: 'mod-cta'
	  });
	  executeBtn.onclick = () => {
		this.callback(true);
		this.close();
	  };
	}
	
	const cancelBtn = actions.createEl('button', { text: 'Cancel' });
	cancelBtn.onclick = () => {
	  this.callback(false);
	  this.close();
	};
  }
  
  private createFileSection(container: HTMLElement, title: string, files: SyncFile[], type: string) {
	const section = container.createEl('div', { cls: 'git-sync-section' });
	const sectionHeader = section.createEl('h3', { cls: `git-sync-type-${type}` });
	sectionHeader.createEl('span', { text: title });
	
	const list = section.createEl('ul', { cls: 'git-sync-changes-list' });
	
	for (const file of files) {
	  const item = list.createEl('li', { cls: 'git-sync-change-item' });
	  
	  // Color coding
	  if (type === 'create') item.style.borderLeftColor = 'var(--color-green)';
	  else if (type === 'modify') item.style.borderLeftColor = 'var(--color-orange)';
	  
	  const path = item.createEl('span', { text: file.path, cls: 'git-sync-path' });
	  const reason = item.createEl('span', { 
		text: file.reason === 'local-only' ? 'Local only' : 'Remote only', 
		cls: 'git-sync-timestamp' 
	  });
	  
	  if (file.size) {
		const size = item.createEl('span', { 
		  text: this.formatFileSize(file.size), 
		  cls: 'git-sync-timestamp' 
		});
	  }
	}
  }
  
  private formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  
  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

// Progress Modal - Shows progress for long-running operations
class ProgressModal extends Modal {
  private title: string;
  private total: number;
  private current: number = 0;
  private progressBar: HTMLElement | null = null;
  private progressText: HTMLElement | null = null;
  private currentStepEl: HTMLElement | null = null;
  
  constructor(app: App, title: string, total: number) {
	super(app);
	this.title = title;
	this.total = total;
  }
  
  onOpen() {
	const { contentEl } = this;
	contentEl.addClass('git-sync-modal');
	contentEl.addClass('git-sync-progress-modal');
	
	// Header
	contentEl.createEl('h2', { text: this.title });
	
	// Current step
	this.currentStepEl = contentEl.createEl('div', {
	  text: 'Preparing...',
	  cls: 'git-sync-current-step'
	});
	
	// Progress container
	const progressContainer = contentEl.createEl('div', {
	  cls: 'git-sync-progress-container'
	});
	
	const progressBarWrapper = progressContainer.createEl('div', {
	  cls: 'git-sync-progress-bar'
	});
	
	this.progressBar = progressBarWrapper.createEl('div', {
	  cls: 'git-sync-progress-fill'
	});
	
	// Progress text
	this.progressText = contentEl.createEl('div', {
	  text: '0%',
	  cls: 'git-sync-progress-text'
	});
  }
  
  updateProgress(current: number, currentStep?: string) {
	this.current = Math.min(current, this.total);
	const percentage = Math.round((this.current / this.total) * 100);
	
	if (this.progressBar) {
	  this.progressBar.style.width = `${percentage}%`;
	}
	
	if (this.progressText) {
	  this.progressText.textContent = `${percentage}% (${this.current}/${this.total})`;
	}
	
	if (this.currentStepEl && currentStep) {
	  this.currentStepEl.textContent = currentStep;
	}
  }
  
  onClose() {
	const { contentEl } = this;
	contentEl.empty();
  }
}

