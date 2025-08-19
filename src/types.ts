/**
 * Mobile Git Sync Plugin Types
 * 
 * This file contains TypeScript type definitions for the Mobile Git Sync plugin.
 */

export interface PluginSettings {
	repoUrl: string;
	githubToken: string; // Deprecated - kept for migration purposes
	branch: string;
	excludePatterns: string[];
	syncFolders: string[];
	autoSyncInterval: number;
	useGitHubAPI: boolean;
	isConfigured: boolean;
	conflictStrategy: ConflictStrategy;
	// New security-related settings
	useSecureStorage?: boolean;
	lastTokenValidation?: number;
	migrationCompleted?: boolean;
	// UX Enhancement settings
	userMode?: 'beginner' | 'advanced';
	autoSyncEnabled?: boolean;
	hasCompletedOnboarding?: boolean;
}

export type ConflictStrategy = 'prompt' | 'latest' | 'local' | 'remote';

export interface FileChange {
	path: string;
	type: 'create' | 'modify' | 'delete';
	timestamp: number;
	content?: string;
}

export interface SyncStatus {
	isOnline: boolean;
	isSyncing: boolean;
	lastSyncTime: number;
	queuedChanges: number;
	hasErrors: boolean;
	errorMessage?: string;
}

export interface GitHubApiResponse {
	sha: string;
	content: string;
	encoding: string;
	message?: string;
	commit?: {
		committer?: {
			date: string;
		};
	};
	git_url?: string;
}

export interface GitHubFileInfo {
	path: string;
	type: 'file' | 'dir';
	download_url?: string;
	sha: string;
}

export interface ConflictFile {
	path: string;
	localContent: string;
	remoteContent: string;
	timestamp: number;
	localMtime?: number;
	remoteMtime?: number;
}

export interface SyncOperation {
	type: 'pull' | 'push' | 'commit';
	files: string[];
	timestamp: number;
	success: boolean;
	error?: string;
}

export interface RepoInfo {
	owner: string;
	name: string;
	branch: string;
	isPrivate: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface LogEntry {
	timestamp: number;
	level: LogLevel;
	message: string;
	data?: unknown;
	context?: LogContext;
}

export interface LogContext {
	component?: string;
	operation?: string;
	userId?: string;
	sessionId?: string;
}

export interface RetryConfig {
	maxRetries: number;
	initialDelay: number;
	maxDelay: number;
	backoffFactor: number;
}

export interface SyncPlan {
	toUpload: SyncFile[];
	toDownload: SyncFile[];
	toResolve: ConflictFile[];
	toDelete: SyncFile[];
	summary: string;
	totalOperations: number;
}

export interface SyncFile {
	path: string;
	content: string;
	reason: 'local-only' | 'remote-only' | 'conflict' | 'newer-local' | 'newer-remote' | 'local-delete';
	size?: number;
	lastModified?: number;
	hash?: string;
	mtime?: number;
}

export interface VaultScanResult {
	totalFiles: number;
	scannedFiles: string[];
	excludedFiles: string[];
	errors: string[];
}
