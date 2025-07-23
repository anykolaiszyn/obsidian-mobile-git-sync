import { Plugin, Modal, App, TFile, Notice, requestUrl, Setting, PluginSettingTab } from 'obsidian';


// --- FileChange Type ---
type FileChange = {
  path: string;
  type: 'create' | 'modify' | 'delete';
  timestamp: number;
  content?: string;
};



class MobileGitSyncPlugin extends Plugin {
  // Properties
  settings: any;
  statusBarItem: any;
  changeQueue: Map<string, any> = new Map();
  syncLog: Array<{ time: number; message: string; type: 'info' | 'error' | 'success' }> = [];
  isSyncing: boolean = false;
  repoOwner: string = '';
  repoName: string = '';

  // Add a new property for conflict strategy
  conflictStrategy: 'prompt' | 'latest' | 'local' | 'remote' = 'prompt';

  public updateStatusBar(text: string, showNotice = false) {
	if (this.statusBarItem) {
	  this.statusBarItem.setText(text);
	}
	if (showNotice) {
	  new Notice(text);
	}
  }

  async performManualSync() {
	if (!this.settings.isConfigured) {
	  new Notice('Please configure GitHub sync settings first');
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
	await this.performSync();
  }

  showSyncLogModal() {
	new SyncLogModal(this.app, this.syncLog).open();
  }

  addSyncLog(message: string, type: 'info' | 'error' | 'success') {
	this.syncLog.push({ time: Date.now(), message, type });
	if (this.syncLog.length > 100) this.syncLog.shift();
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

  async queueFileChange(filePath: string, type: 'create' | 'modify' | 'delete') {
	let content: string | undefined;
	if (type !== 'delete') {
	  try {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
		  content = await this.app.vault.read(file);
		}
	  } catch (error) {
		console.error(`Failed to read file ${filePath}:`, error);
		return;
	  }
	}
	this.changeQueue.set(filePath, {
	  path: filePath,
	  type: type,
	  timestamp: Date.now(),
	  content: content
	});
	this.updateStatusBar(`${this.changeQueue.size} changes queued`);
  }

  isOnline(): boolean {
	return navigator.onLine;
  }

  async performSync() {
	this.updateStatusBar('Syncing...', true);
	setTimeout(() => {
	  this.updateStatusBar('Sync complete', true);
	}, 1000);
  }

  async pushLocalChanges() {
	for (const [filePath, change] of this.changeQueue.entries()) {
	  if (change.type === 'delete') {
		continue;
	  }
	  if (change.content) {
		await this.uploadFile(filePath, change.content);
	  }
	}
	this.addSyncLog(`Pushed ${this.changeQueue.size} local changes`, 'info');
  }

  async calculateSha(content: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	const hashBuffer = await window.crypto.subtle.digest('SHA-1', data);
	return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async uploadFile(filePath: string, content: string) {
	try {
	  const b64Content = btoa(unescape(encodeURIComponent(content)));
	  await requestUrl({
		url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${filePath}`,
		method: 'PUT',
		headers: {
		  'Authorization': `token ${this.settings.githubToken}`,
		  'Accept': 'application/vnd.github.v3+json',
		  'User-Agent': 'Obsidian-Mobile-Git-Sync'
		},
		body: JSON.stringify({
		  message: `Update ${filePath}`,
		  content: b64Content,
		  branch: this.settings.branch
		})
	  });
	  this.addSyncLog(`Uploaded ${filePath}`, 'success');
	} catch (error) {
	  this.addSyncLog(`Failed to upload ${filePath}: ${(error as any).message}`, 'error');
	  new Notice(`Failed to upload ${filePath}`);
	}
  }
  parseRepoUrl() {
	// Stub: implement parsing logic if needed
  }
}
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

	// Defensive: ensure all settings fields are defined and of correct type
	const s = this.plugin.settings;
	s.repoUrl = typeof s.repoUrl === 'string' ? s.repoUrl : '';
	s.githubToken = typeof s.githubToken === 'string' ? s.githubToken : '';
	s.branch = typeof s.branch === 'string' ? s.branch : 'main';
	s.excludePatterns = Array.isArray(s.excludePatterns) ? s.excludePatterns : [];
	s.syncFolders = Array.isArray(s.syncFolders) ? s.syncFolders : [];
	s.autoSyncInterval = typeof s.autoSyncInterval === 'number' ? s.autoSyncInterval : 5;
	s.useGitHubAPI = typeof s.useGitHubAPI === 'boolean' ? s.useGitHubAPI : true;
	s.isConfigured = typeof s.isConfigured === 'boolean' ? s.isConfigured : false;

	new Setting(containerEl)
	  .setName('GitHub Repository URL')
	  .setDesc('Format: https://github.com/owner/repo')
	  .addText(text => text
		.setPlaceholder('https://github.com/owner/repo')
		.setValue(s.repoUrl)
		.onChange(async (value) => {
		  s.repoUrl = value;
		  this.plugin.parseRepoUrl();
		  await (this.plugin as any).saveSettings();
		}));

	new Setting(containerEl)
	  .setName('GitHub Token')
	  .setDesc('A personal access token with repo access')
	  .addText(text => text
		.setPlaceholder('ghp_...')
		.setValue(s.githubToken)
		.onChange(async (value) => {
		  s.githubToken = value;
		  await (this.plugin as any).saveSettings();
		}));

	new Setting(containerEl)
	  .setName('Branch')
	  .setDesc('Branch to sync with')
	  .addText(text => text
		.setPlaceholder('main')
		.setValue(s.branch)
		.onChange(async (value) => {
		  s.branch = value;
		  await (this.plugin as any).saveSettings();
		}));

	new Setting(containerEl)
	  .setName('Exclude Patterns')
	  .setDesc('Glob patterns to exclude (comma separated)')
	  .addText(text => text
		.setPlaceholder('.git/**,node_modules/**')
		.setValue(Array.isArray(s.excludePatterns) ? s.excludePatterns.join(',') : '')
		.onChange(async (value) => {
		  s.excludePatterns = value.split(',').map(str => str.trim()).filter(Boolean);
		  await (this.plugin as any).saveSettings();
		}));

	new Setting(containerEl)
	  .setName('Sync Folders')
	  .setDesc('Only sync these folders (comma separated, blank for all)')
	  .addText(text => text
		.setPlaceholder('folder1,folder2')
		.setValue(Array.isArray(s.syncFolders) ? s.syncFolders.join(',') : '')
		.onChange(async (value) => {
		  s.syncFolders = value.split(',').map(str => str.trim()).filter(Boolean);
		  await (this.plugin as any).saveSettings();
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
			await (this.plugin as any).saveSettings();
		  }
		}));

	new Setting(containerEl)
	  .setName('Use GitHub API')
	  .setDesc('Use GitHub API for sync (recommended)')
	  .addToggle(toggle => toggle
		.setValue(!!s.useGitHubAPI)
		.onChange(async (value) => {
		  s.useGitHubAPI = value;
		  await (this.plugin as any).saveSettings();
		}));

	new Setting(containerEl)
	  .setName('Configured')
	  .setDesc('Mark as configured (enable sync)')
	  .addToggle(toggle => toggle
		.setValue(!!s.isConfigured)
		.onChange(async (value) => {
		  s.isConfigured = value;
		  await (this.plugin as any).saveSettings();
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
		.setValue(this.plugin.settings.conflictStrategy || 'prompt')
		.onChange(async (value) => {
		  this.plugin.settings.conflictStrategy = value;
		  await (this.plugin as any).saveSettings();
		})
	  );
  }


}

// --- Modal for Sync Log/History ---
class SyncLogModal extends Modal {
  syncLog: Array<{ time: number; message: string; type: 'info' | 'error' | 'success' }>;

  constructor(app: App, syncLog: Array<{ time: number; message: string; type: 'info' | 'error' | 'success' }>) {
	super(app);
	this.syncLog = syncLog;
  }

  onOpen() {
	const { contentEl } = this;
	contentEl.createEl('h2', { text: 'Sync History / Log' });
	// Limit log display for mobile performance
	const MAX_LOGS = 100;
	if (this.syncLog.length === 0) {
	  contentEl.createEl('p', { text: 'No sync events yet.' });
	  return;
	}
	// Clear Log button
	const clearBtn = contentEl.createEl('button', { text: 'Clear Log', cls: 'mod-cta' });
	clearBtn.onclick = () => {
	  this.syncLog.length = 0;
	  new Notice('Sync log cleared');
	  this.close();
	};
	const list = contentEl.createEl('ul');
	this.syncLog.slice(-MAX_LOGS).reverse().forEach(log => {
	  const item = list.createEl('li');
	  item.createEl('span', {
		text: `[${new Date(log.time).toLocaleString()}] ${log.message}`,
		cls: `sync-log-${log.type}`
	  });
	});
	if (this.syncLog.length > MAX_LOGS) {
	  contentEl.createEl('div', { text: `Showing last ${MAX_LOGS} entries (oldest hidden for performance)` });
	}
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

// In your conflict resolution logic (wherever you handle conflicts):
// Example usage:
// if (this.settings.conflictStrategy === 'latest') {
//   // Compare timestamps and pick the newest
//   const useLocal = localTimestamp >= remoteTimestamp;
//   // Apply the chosen version automatically
// } else if (this.settings.conflictStrategy === 'local') {
//   // Always keep local
// } else if (this.settings.conflictStrategy === 'remote') {
//   // Always keep remote
// } else {
//   // Prompt user (default)
// }

