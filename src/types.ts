/**
 * Mobile Git Sync Plugin Types
 * 
 * This file contains TypeScript type definitions for the Mobile Git Sync plugin.
 */

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
}

export interface ConflictFile {
	path: string;
	localContent: string;
	remoteContent: string;
	timestamp: number;
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

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
	timestamp: number;
	level: LogLevel;
	message: string;
	data?: any;
}
