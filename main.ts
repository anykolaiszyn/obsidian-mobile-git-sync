import { Plugin, TFile, Notice, Setting, PluginSettingTab, App, Modal, requestUrl } from 'obsidian';

interface MobileGitSyncSettings {
	githubToken: string;
	repoUrl: string;
	username: string;
	email: string;
	branch: string;
	autoSyncInterval: number;
	autoSyncEnabled: boolean;
	excludePatterns: string[];
	lastSyncTime: number;
	isConfigured: boolean;
	useGitHubAPI: boolean; // Use GitHub API instead of git directly
}

const DEFAULT_SETTINGS: MobileGitSyncSettings = {
	githubToken: '',
	repoUrl: '',
	username: '',
	email: '',
	branch: 'main',
	autoSyncInterval: 5,
	autoSyncEnabled: true,
	excludePatterns: ['.obsidian/**', '.git/**', '.trash/**'],
	lastSyncTime: 0,
	isConfigured: false,
	useGitHubAPI: true
};

interface FileChange {
	path: string;
	type: 'create' | 'modify' | 'delete';
	timestamp: number;
	content?: string;
}

interface GitHubFile {
	path: string;
	sha: string;
	content: string;
	encoding: string;
}

export default class MobileGitSyncPlugin extends Plugin {
	settings: MobileGitSyncSettings = DEFAULT_SETTINGS;
	syncInterval: number | null = null;
	changeQueue: Map<string, FileChange> = new Map();
	isSyncing = false;
	statusBarItem: HTMLElement | null = null;
	repoOwner = '';
	repoName = '';

	async onload() {
		await this.loadSettings();

		// Initialize status bar
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar('Ready');

		// Parse repository URL
		this.parseRepoUrl();

		// Add ribbon icon for manual sync
		this.addRibbonIcon('sync', 'Mobile Git Sync', () => {
			this.performManualSync();
		});

		// Register commands
		this.addCommand({
			id: 'manual-sync',
			name: 'Sync Now',
			callback: () => this.performManualSync()
		});

		this.addCommand({
			id: 'view-changes',
			name: 'View Pending Changes',
			callback: () => this.showChangesModal()
		});

		this.addCommand({
			id: 'test-connection',
			name: 'Test GitHub Connection',
			callback: () => this.testConnection()
		});

		// Add settings tab
		this.addSettingTab(new MobileGitSyncSettingTab(this.app, this));

		// Register vault events
		this.registerVaultEvents();

		// Start auto-sync if configured
		if (this.settings.isConfigured && this.settings.autoSyncEnabled) {
			this.startAutoSync();
		}

		// Initial sync on startup if configured
		if (this.settings.isConfigured) {
			setTimeout(() => this.performSync(), 2000);
		}
	}

	onunload() {
		this.stopAutoSync();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	parseRepoUrl() {
		if (this.settings.repoUrl) {
			// Parse GitHub URL to extract owner and repo name
			const match = this.settings.repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
			if (match) {
				this.repoOwner = match[1];
				this.repoName = match[2];
			}
		}
	}

	registerVaultEvents() {
		// File creation
		this.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile && !this.isExcluded(file.path)) {
				this.queueFileChange(file.path, 'create');
			}
		}));

		// File modification
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && !this.isExcluded(file.path)) {
				this.queueFileChange(file.path, 'modify');
			}
		}));

		// File deletion
		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile && !this.isExcluded(file.path)) {
				this.queueFileChange(file.path, 'delete');
			}
		}));

		// File rename
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile) {
				if (!this.isExcluded(oldPath)) {
					this.queueFileChange(oldPath, 'delete');
				}
				if (!this.isExcluded(file.path)) {
					this.queueFileChange(file.path, 'create');
				}
			}
		}));
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

		console.log(`Queued ${type} for ${filePath}`);
		this.updateStatusBar(`${this.changeQueue.size} changes queued`);
	}

	isExcluded(filePath: string): boolean {
		return this.settings.excludePatterns.some(pattern => {
			const regexPattern = pattern
				.replace(/\*\*/g, '.*')
				.replace(/\*/g, '[^/]*')
				.replace(/\?/g, '[^/]');
			const regex = new RegExp(`^${regexPattern}$`);
			return regex.test(filePath);
		});
	}

	startAutoSync() {
		this.stopAutoSync();

		this.syncInterval = window.setInterval(() => {
			if (!this.isSyncing && this.changeQueue.size > 0 && this.isOnline()) {
				this.performSync();
			}
		}, this.settings.autoSyncInterval * 60 * 1000);

		this.registerInterval(this.syncInterval);
	}

	stopAutoSync() {
		if (this.syncInterval) {
			window.clearInterval(this.syncInterval);
			this.syncInterval = null;
		}
	}

	isOnline(): boolean {
		return navigator.onLine;
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

	async performSync() {
		if (this.isSyncing || !this.isOnline()) return;

		this.isSyncing = true;
		this.updateStatusBar('Syncing...');

		try {
			if (this.settings.useGitHubAPI) {
				await this.syncWithGitHubAPI();
			} else {
				// Fallback to git operations (not implemented in this version)
				throw new Error('Direct git operations not implemented yet');
			}

			this.settings.lastSyncTime = Date.now();
			await this.saveSettings();

			const changeCount = this.changeQueue.size;
			this.changeQueue.clear();

			this.updateStatusBar(`Synced ${changeCount} changes`);
			
			if (changeCount > 0) {
				new Notice(`✅ Synced ${changeCount} changes`);
			}

		} catch (error) {
			console.error('Sync error:', error);
			new Notice(`❌ Sync failed: ${error.message}`);
			this.updateStatusBar('Sync failed');
		} finally {
			this.isSyncing = false;
		}
	}

	async syncWithGitHubAPI() {
		// First, pull any remote changes
		await this.pullRemoteChanges();

		// Then push local changes
		if (this.changeQueue.size > 0) {
			await this.pushLocalChanges();
		}
	}

	async pullRemoteChanges() {
		try {
			// Get list of files in repository
			const response = await requestUrl({
				url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/git/trees/${this.settings.branch}?recursive=1`,
				method: 'GET',
				headers: {
					'Authorization': `token ${this.settings.githubToken}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Obsidian-Mobile-Git-Sync'
				}
			});

			const tree = response.json;
			if (tree.tree) {
				for (const item of tree.tree) {
					if (item.type === 'blob' && !this.isExcluded(item.path)) {
						await this.pullFileIfNewer(item.path, item.sha);
					}
				}
			}
		} catch (error) {
			if (error.status === 404) {
				// Branch doesn't exist yet, which is fine
				console.log('Remote branch does not exist yet');
			} else {
				throw error;
			}
		}
	}

	async pullFileIfNewer(filePath: string, remoteSha: string) {
		try {
			const localFile = this.app.vault.getAbstractFileByPath(filePath);
			
			// If file doesn't exist locally, download it
			if (!localFile) {
				await this.downloadFile(filePath);
				return;
			}

			// Check if local file is different from remote
			if (localFile instanceof TFile) {
				const localContent = await this.app.vault.read(localFile);
				const localSha = await this.calculateSha(localContent);
				
				if (localSha !== remoteSha) {
					// File has changed remotely, handle potential conflict
					await this.handleRemoteChange(filePath, localContent);
				}
			}
		} catch (error) {
			console.error(`Failed to check file ${filePath}:`, error);
		}
	}

	async downloadFile(filePath: string) {
		try {
			const response = await requestUrl({
				url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${filePath}`,
				method: 'GET',
				headers: {
					'Authorization': `token ${this.settings.githubToken}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Obsidian-Mobile-Git-Sync'
				}
			});

			const fileData = response.json;
			if (fileData.content) {
				const content = atob(fileData.content);
				
				// Create the file in the vault
				const folders = filePath.split('/');
				folders.pop(); // Remove filename
				const folderPath = folders.join('/');
				
				if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
					await this.app.vault.createFolder(folderPath);
				}
				
				await this.app.vault.create(filePath, content);
				console.log(`Downloaded file: ${filePath}`);
			}
		} catch (error) {
			console.error(`Failed to download file ${filePath}:`, error);
		}
	}

	async handleRemoteChange(filePath: string, localContent: string) {
		// For now, create a conflict file - in the future, implement smart merging
		const conflictPath = `${filePath}.conflict.${Date.now()}`;
		
		try {
			// Download remote content
			const response = await requestUrl({
				url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${filePath}`,
				method: 'GET',
				headers: {
					'Authorization': `token ${this.settings.githubToken}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Obsidian-Mobile-Git-Sync'
				}
			});

			const fileData = response.json;
			const remoteContent = atob(fileData.content);
			
			// Save remote version as conflict file
			await this.app.vault.create(conflictPath, remoteContent);
			
			new Notice(`⚠️ Conflict detected in ${filePath}. Remote version saved as ${conflictPath}`);
			console.log(`Conflict detected: ${filePath} -> ${conflictPath}`);
			
		} catch (error) {
			console.error(`Failed to handle conflict for ${filePath}:`, error);
		}
	}

	async pushLocalChanges() {
		const changes = Array.from(this.changeQueue.values());
		
		for (const change of changes) {
			try {
				if (change.type === 'delete') {
					await this.deleteRemoteFile(change.path);
				} else {
					await this.uploadFile(change.path, change.content || '');
				}
			} catch (error) {
				console.error(`Failed to sync ${change.path}:`, error);
				throw error;
			}
		}
	}

	async uploadFile(filePath: string, content: string) {
		try {
			// First, try to get the current file to get its SHA (needed for updates)
			let sha: string | undefined;
			
			try {
				const response = await requestUrl({
					url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${filePath}`,
					method: 'GET',
					headers: {
						'Authorization': `token ${this.settings.githubToken}`,
						'Accept': 'application/vnd.github.v3+json',
						'User-Agent': 'Obsidian-Mobile-Git-Sync'
					}
				});
				sha = response.json.sha;
			} catch (error) {
				// File doesn't exist, which is fine for new files
			}

			// Upload the file
			const uploadData: any = {
				message: `Update ${filePath} from Obsidian Mobile`,
				content: btoa(content),
				branch: this.settings.branch,
				committer: {
					name: this.settings.username,
					email: this.settings.email
				},
				author: {
					name: this.settings.username,
					email: this.settings.email
				}
			};

			if (sha) {
				uploadData.sha = sha;
			}

			await requestUrl({
				url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${filePath}`,
				method: 'PUT',
				headers: {
					'Authorization': `token ${this.settings.githubToken}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Obsidian-Mobile-Git-Sync',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(uploadData)
			});

			console.log(`Uploaded file: ${filePath}`);
			
		} catch (error) {
			console.error(`Failed to upload ${filePath}:`, error);
			throw error;
		}
	}

	async deleteRemoteFile(filePath: string) {
		try {
			// Get the file's SHA first
			const response = await requestUrl({
				url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${filePath}`,
				method: 'GET',
				headers: {
					'Authorization': `token ${this.settings.githubToken}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Obsidian-Mobile-Git-Sync'
				}
			});

			const sha = response.json.sha;

			// Delete the file
			await requestUrl({
				url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/contents/${filePath}`,
				method: 'DELETE',
				headers: {
					'Authorization': `token ${this.settings.githubToken}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Obsidian-Mobile-Git-Sync',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					message: `Delete ${filePath} from Obsidian Mobile`,
					sha: sha,
					branch: this.settings.branch,
					committer: {
						name: this.settings.username,
						email: this.settings.email
					},
					author: {
						name: this.settings.username,
						email: this.settings.email
					}
				})
			});

			console.log(`Deleted file: ${filePath}`);
			
		} catch (error) {
			if (error.status === 404) {
				// File doesn't exist remotely, which is fine
				console.log(`File ${filePath} doesn't exist remotely`);
			} else {
				console.error(`Failed to delete ${filePath}:`, error);
				throw error;
			}
		}
	}

	async calculateSha(content: string): Promise<string> {
		// Simple SHA calculation for comparison
		// In a real implementation, you'd use proper Git SHA calculation
		const encoder = new TextEncoder();
		const data = encoder.encode(content);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	async testConnection() {
		if (!this.settings.githubToken || !this.repoOwner || !this.repoName) {
			new Notice('Please configure all settings first');
			return;
		}

		try {
			this.updateStatusBar('Testing connection...');
			
			const response = await requestUrl({
				url: `https://api.github.com/repos/${this.repoOwner}/${this.repoName}`,
				method: 'GET',
				headers: {
					'Authorization': `token ${this.settings.githubToken}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Obsidian-Mobile-Git-Sync'
				}
			});

			if (response.status === 200) {
				this.settings.isConfigured = true;
				await this.saveSettings();
				new Notice('✅ GitHub connection successful!');
				this.updateStatusBar('Connection verified');
			} else {
				throw new Error(`HTTP ${response.status}`);
			}
		} catch (error) {
			console.error('Connection test failed:', error);
			new Notice(`❌ Connection failed: ${error.message}`);
			this.updateStatusBar('Connection failed');
		}
	}

	updateStatusBar(text: string) {
		if (this.statusBarItem) {
			this.statusBarItem.setText(`Git: ${text}`);
		}
	}

	showChangesModal() {
		new ChangesModal(this.app, this.changeQueue).open();
	}
}

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

		// Instructions
		const instructionsEl = containerEl.createEl('div', { cls: 'setting-item-description' });
		instructionsEl.innerHTML = `
			<p><strong>Setup Instructions:</strong></p>
			<ol>
				<li>Create a <a href="https://github.com/settings/tokens/new" target="_blank">GitHub Personal Access Token</a> with <code>repo</code> scope</li>
				<li>Enter your repository URL (e.g., https://github.com/username/repo.git)</li>
				<li>Configure your Git username and email</li>
				<li>Test the connection</li>
				<li>Start syncing!</li>
			</ol>
		`;

		// GitHub Token
		new Setting(containerEl)
			.setName('GitHub Personal Access Token')
			.setDesc('Token with repo permissions for your private repository')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('ghp_...')
					.setValue(this.plugin.settings.githubToken)
					.onChange(async (value) => {
						this.plugin.settings.githubToken = value;
						this.plugin.parseRepoUrl();
						await this.plugin.saveSettings();
					});
			});

		// Repository URL
		new Setting(containerEl)
			.setName('Repository URL')
			.setDesc('Your GitHub repository URL')
			.addText(text => text
				.setPlaceholder('https://github.com/username/repo.git')
				.setValue(this.plugin.settings.repoUrl)
				.onChange(async (value) => {
					this.plugin.settings.repoUrl = value;
					this.plugin.parseRepoUrl();
					await this.plugin.saveSettings();
				}));

		// Username
		new Setting(containerEl)
			.setName('Git Username')
			.setDesc('Your GitHub username (for commit attribution)')
			.addText(text => text
				.setPlaceholder('username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		// Email
		new Setting(containerEl)
			.setName('Git Email')
			.setDesc('Your email (for commit attribution)')
			.addText(text => text
				.setPlaceholder('user@example.com')
				.setValue(this.plugin.settings.email)
				.onChange(async (value) => {
					this.plugin.settings.email = value;
					await this.plugin.saveSettings();
				}));

		// Branch
		new Setting(containerEl)
			.setName('Branch')
			.setDesc('Git branch to sync with')
			.addText(text => text
				.setPlaceholder('main')
				.setValue(this.plugin.settings.branch)
				.onChange(async (value) => {
					this.plugin.settings.branch = value;
					await this.plugin.saveSettings();
				}));

		// Test connection button
		new Setting(containerEl)
			.setName('Test Connection')
			.setDesc('Verify your GitHub settings')
			.addButton(button => button
				.setButtonText('Test Connection')
				.setCta()
				.onClick(() => this.plugin.testConnection()));

		containerEl.createEl('h3', { text: 'Sync Settings' });

		// Auto-sync toggle
		new Setting(containerEl)
			.setName('Enable Auto-sync')
			.setDesc('Automatically sync changes in the background')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSyncEnabled)
				.onChange(async (value) => {
					this.plugin.settings.autoSyncEnabled = value;
					await this.plugin.saveSettings();
					
					if (value && this.plugin.settings.isConfigured) {
						this.plugin.startAutoSync();
					} else {
						this.plugin.stopAutoSync();
					}
				}));

		// Sync interval
		new Setting(containerEl)
			.setName('Auto-sync Interval (minutes)')
			.setDesc('How often to check for changes to sync')
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.plugin.settings.autoSyncInterval)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.autoSyncInterval = value;
					await this.plugin.saveSettings();
					
					if (this.plugin.settings.autoSyncEnabled) {
						this.plugin.startAutoSync();
					}
				}));

		// Exclude patterns
		new Setting(containerEl)
			.setName('Exclude Patterns')
			.setDesc('File patterns to exclude from sync (one per line, supports wildcards)')
			.addTextArea(text => text
				.setPlaceholder('.obsidian/**\n.trash/**\nprivate/**\n*.tmp')
				.setValue(this.plugin.settings.excludePatterns.join('\n'))
				.onChange(async (value) => {
					this.plugin.settings.excludePatterns = value
						.split('\n')
						.map(line => line.trim())
						.filter(line => line.length > 0);
					await this.plugin.saveSettings();
				}));

		// Status display
		containerEl.createEl('h3', { text: 'Status' });
		
		const statusEl = containerEl.createEl('div', { cls: 'setting-item' });
		const statusInfo = statusEl.createEl('div', { cls: 'setting-item-info' });
		statusInfo.createEl('div', { text: 'Configuration Status', cls: 'setting-item-name' });
		
		const statusDesc = statusInfo.createEl('div', { cls: 'setting-item-description' });
		if (this.plugin.settings.isConfigured) {
			statusDesc.innerHTML = '✅ Ready to sync';
			statusDesc.style.color = 'var(--text-success)';
		} else {
			statusDesc.innerHTML = '⚠️ Configuration incomplete';
			statusDesc.style.color = 'var(--text-warning)';
		}

		// Last sync time
		if (this.plugin.settings.lastSyncTime > 0) {
			const lastSyncEl = containerEl.createEl('div', { cls: 'setting-item' });
			const lastSyncInfo = lastSyncEl.createEl('div', { cls: 'setting-item-info' });
			lastSyncInfo.createEl('div', { text: 'Last Sync', cls: 'setting-item-name' });
			lastSyncInfo.createEl('div', { 
				text: new Date(this.plugin.settings.lastSyncTime).toLocaleString(),
				cls: 'setting-item-description'
			});
		}

		// Pending changes count
		const changesEl = containerEl.createEl('div', { cls: 'setting-item' });
		const changesInfo = changesEl.createEl('div', { cls: 'setting-item-info' });
		changesInfo.createEl('div', { text: 'Pending Changes', cls: 'setting-item-name' });
		changesInfo.createEl('div', { 
			text: `${this.plugin.changeQueue.size} files queued for sync`,
			cls: 'setting-item-description'
		});
	}
}
