/**
 * Sync Service
 * 
 * Orchestrates synchronization between local vault and remote repository
 * with intelligent conflict resolution and progress tracking
 */

import { App, TFile, Notice } from 'obsidian';
import { DisposableService } from '../core/container';
import { GitHubApiService, GitHubFile } from './githubService';
import { ConflictResolutionService, ConflictResolution } from './conflictService';
import { PluginSettings, FileChange, SyncPlan, SyncFile, ConflictFile } from '../types';

export interface SyncOptions {
  direction?: 'pull' | 'push' | 'bidirectional';
  dryRun?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFiles?: number;
  batchSize?: number;
  progressCallback?: (current: number, total: number, operation: string) => void;
}

export interface SyncResult {
  success: boolean;
  filesProcessed: number;
  filesUploaded: number;
  filesDownloaded: number;
  filesDeleted: number;
  conflictsResolved: number;
  errors: Array<{ file: string; error: string }>;
  duration: number;
  bytesTransferred: number;
}

export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageDuration: number;
  totalFilesProcessed: number;
  totalBytesTransferred: number;
  lastSyncTime: number;
  commonErrors: Array<{ error: string; count: number }>;
}

export class SyncService extends DisposableService {
  private syncHistory: SyncResult[] = [];
  private maxHistorySize = 100;
  private currentSyncAbortController: AbortController | null = null;

  constructor(
    private app: App,
    private githubService: GitHubApiService,
    private conflictService: ConflictResolutionService,
    private settings: PluginSettings
  ) {
    super();
  }

  /**
   * Creates a sync plan showing what operations will be performed
   */
  async createSyncPlan(options: SyncOptions = {}): Promise<SyncPlan> {
    this.checkDisposed();

    const startTime = Date.now();
    const { owner, repo } = this.parseRepoUrl();
    const branch = this.settings.branch;

    // Get local files
    const localFiles = await this.scanLocalFiles(options.excludePatterns);
    
    // Get remote files
    const remoteFiles = await this.getRemoteFiles(owner, repo, branch);

    // Analyze differences
    const analysis = this.analyzeFileDifferences(localFiles, remoteFiles, options);

    const plan: SyncPlan = {
      toUpload: analysis.toUpload,
      toDownload: analysis.toDownload,
      toResolve: analysis.conflicts,
      toDelete: analysis.toDelete,
      summary: this.generateSyncSummary(analysis),
      totalOperations: analysis.toUpload.length + analysis.toDownload.length + 
                      analysis.conflicts.length + analysis.toDelete.length
    };

    return plan;
  }

  /**
   * Executes a sync operation based on the provided options
   */
  async executeSync(options: SyncOptions = {}): Promise<SyncResult> {
    this.checkDisposed();

    const startTime = Date.now();
    this.currentSyncAbortController = new AbortController();

    const result: SyncResult = {
      success: false,
      filesProcessed: 0,
      filesUploaded: 0,
      filesDownloaded: 0,
      filesDeleted: 0,
      conflictsResolved: 0,
      errors: [],
      duration: 0,
      bytesTransferred: 0
    };

    try {
      // Create sync plan
      const plan = await this.createSyncPlan(options);
      
      if (options.dryRun) {
        result.success = true;
        result.duration = Date.now() - startTime;
        return result;
      }

      const totalOperations = plan.totalOperations;
      let currentOperation = 0;

      // Progress callback helper
      const updateProgress = (operation: string) => {
        if (options.progressCallback) {
          options.progressCallback(currentOperation, totalOperations, operation);
        }
      };

      // Handle uploads
      for (const file of plan.toUpload) {
        if (this.currentSyncAbortController?.signal.aborted) {
          throw new Error('Sync operation was cancelled');
        }

        try {
          updateProgress(`Uploading ${file.path}`);
          await this.uploadFile(file);
          result.filesUploaded++;
          result.bytesTransferred += file.content.length;
        } catch (error) {
          result.errors.push({
            file: file.path,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        currentOperation++;
        result.filesProcessed++;
      }

      // Handle downloads
      for (const file of plan.toDownload) {
        if (this.currentSyncAbortController?.signal.aborted) {
          throw new Error('Sync operation was cancelled');
        }

        try {
          updateProgress(`Downloading ${file.path}`);
          await this.downloadFile(file);
          result.filesDownloaded++;
          result.bytesTransferred += file.content.length;
        } catch (error) {
          result.errors.push({
            file: file.path,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        currentOperation++;
        result.filesProcessed++;
      }

      // Handle conflicts
      for (const conflict of plan.toResolve) {
        if (this.currentSyncAbortController?.signal.aborted) {
          throw new Error('Sync operation was cancelled');
        }

        try {
          updateProgress(`Resolving conflict in ${conflict.path}`);
          const resolution = await this.conflictService.resolveConflict(conflict, this.settings.conflictStrategy);
          await this.applyConflictResolution(conflict, resolution);
          result.conflictsResolved++;
        } catch (error) {
          result.errors.push({
            file: conflict.path,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        currentOperation++;
        result.filesProcessed++;
      }

      // Handle deletions
      for (const file of plan.toDelete) {
        if (this.currentSyncAbortController?.signal.aborted) {
          throw new Error('Sync operation was cancelled');
        }

        try {
          updateProgress(`Deleting ${file.path}`);
          await this.deleteFile(file);
          result.filesDeleted++;
        } catch (error) {
          result.errors.push({
            file: file.path,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        currentOperation++;
        result.filesProcessed++;
      }

      result.success = result.errors.length === 0;
      result.duration = Date.now() - startTime;

      // Add to history
      this.addToHistory(result);

      return result;

    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      result.errors.push({
        file: 'SYNC_OPERATION',
        error: error instanceof Error ? error.message : String(error)
      });

      this.addToHistory(result);
      throw error;

    } finally {
      this.currentSyncAbortController = null;
    }
  }

  /**
   * Cancels the current sync operation
   */
  cancelSync(): void {
    if (this.currentSyncAbortController) {
      this.currentSyncAbortController.abort();
    }
  }

  /**
   * Gets sync statistics and history
   */
  getSyncStats(): SyncStats {
    const history = this.syncHistory;
    const successful = history.filter(r => r.success);
    const failed = history.filter(r => !r.success);

    // Calculate common errors
    const errorMap = new Map<string, number>();
    history.forEach(result => {
      result.errors.forEach(error => {
        const key = error.error;
        errorMap.set(key, (errorMap.get(key) || 0) + 1);
      });
    });

    const commonErrors = Array.from(errorMap.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalSyncs: history.length,
      successfulSyncs: successful.length,
      failedSyncs: failed.length,
      averageDuration: history.length > 0 
        ? history.reduce((sum, r) => sum + r.duration, 0) / history.length 
        : 0,
      totalFilesProcessed: history.reduce((sum, r) => sum + r.filesProcessed, 0),
      totalBytesTransferred: history.reduce((sum, r) => sum + r.bytesTransferred, 0),
      lastSyncTime: history.length > 0 ? Date.now() : 0,
      commonErrors
    };
  }

  /**
   * Gets recent sync history
   */
  getSyncHistory(limit: number = 10): SyncResult[] {
    return this.syncHistory.slice(-limit);
  }

  /**
   * Clears sync history
   */
  clearHistory(): void {
    this.syncHistory = [];
  }

  /**
   * Scans local vault for files
   */
  private async scanLocalFiles(excludePatterns: string[] = []): Promise<Map<string, SyncFile>> {
    const files = new Map<string, SyncFile>();
    const allFiles = this.app.vault.getFiles();

    for (const file of allFiles) {
      if (this.shouldExcludeFile(file.path, excludePatterns)) {
        continue;
      }

      try {
        const content = await this.app.vault.read(file);
        files.set(file.path, {
          path: file.path,
          content,
          reason: 'local-only',
          size: content.length,
          lastModified: file.stat.mtime
        });
      } catch (error) {
        console.warn(`Failed to read local file ${file.path}:`, error);
      }
    }

    return files;
  }

  /**
   * Gets remote files from GitHub
   */
  private async getRemoteFiles(owner: string, repo: string, branch: string): Promise<Map<string, SyncFile>> {
    const files = new Map<string, SyncFile>();

    try {
      // Get all files recursively
      const remoteFiles = await this.getAllRemoteFiles(owner, repo, '', branch);
      
      for (const remoteFile of remoteFiles) {
        if (remoteFile.type === 'file') {
          files.set(remoteFile.path, {
            path: remoteFile.path,
            content: remoteFile.content,
            reason: 'remote-only',
            size: remoteFile.size,
            lastModified: remoteFile.lastModified?.getTime()
          });
        }
      }
    } catch (error) {
      console.warn('Failed to get remote files:', error);
    }

    return files;
  }

  /**
   * Recursively gets all files from remote repository
   */
  private async getAllRemoteFiles(owner: string, repo: string, path: string, branch: string): Promise<GitHubFile[]> {
    const allFiles: GitHubFile[] = [];
    
    try {
      const items = await this.githubService.listFiles(owner, repo, path, branch);
      
      for (const item of items) {
        if (item.type === 'file') {
          // Get file content
          const fileWithContent = await this.githubService.getFile(owner, repo, item.path, branch);
          allFiles.push(fileWithContent);
        } else if (item.type === 'dir') {
          // Recursively get directory contents
          const dirFiles = await this.getAllRemoteFiles(owner, repo, item.path, branch);
          allFiles.push(...dirFiles);
        }
      }
    } catch (error) {
      console.warn(`Failed to get files from ${path}:`, error);
    }

    return allFiles;
  }

  /**
   * Analyzes differences between local and remote files
   */
  private analyzeFileDifferences(
    localFiles: Map<string, SyncFile>,
    remoteFiles: Map<string, SyncFile>,
    options: SyncOptions
  ): {
    toUpload: SyncFile[];
    toDownload: SyncFile[];
    conflicts: ConflictFile[];
    toDelete: SyncFile[];
  } {
    const toUpload: SyncFile[] = [];
    const toDownload: SyncFile[] = [];
    const conflicts: ConflictFile[] = [];
    const toDelete: SyncFile[] = [];

    const allPaths = new Set([...localFiles.keys(), ...remoteFiles.keys()]);

    for (const path of allPaths) {
      const localFile = localFiles.get(path);
      const remoteFile = remoteFiles.get(path);

      if (localFile && remoteFile) {
        // File exists in both places
        if (localFile.content !== remoteFile.content) {
          // Content differs - potential conflict
          const localMtime = localFile.lastModified || 0;
          const remoteMtime = remoteFile.lastModified || 0;

          if (Math.abs(localMtime - remoteMtime) < 1000) {
            // Very close timestamps - treat as conflict
            conflicts.push({
              path,
              localContent: localFile.content,
              remoteContent: remoteFile.content,
              timestamp: Date.now(),
              localMtime,
              remoteMtime
            });
          } else if (localMtime > remoteMtime) {
            // Local is newer
            toUpload.push({ ...localFile, reason: 'newer-local' });
          } else {
            // Remote is newer
            toDownload.push({ ...remoteFile, reason: 'newer-remote' });
          }
        }
        // If content is the same, no action needed
      } else if (localFile && !remoteFile) {
        // File only exists locally
        if (options.direction !== 'pull') {
          toUpload.push({ ...localFile, reason: 'local-only' });
        }
      } else if (!localFile && remoteFile) {
        // File only exists remotely
        if (options.direction !== 'push') {
          toDownload.push({ ...remoteFile, reason: 'remote-only' });
        }
      }
    }

    return { toUpload, toDownload, conflicts, toDelete };
  }

  /**
   * Uploads a file to the remote repository
   */
  private async uploadFile(file: SyncFile): Promise<void> {
    const { owner, repo } = this.parseRepoUrl();
    const branch = this.settings.branch;

    // Check if file already exists to get SHA
    let sha: string | undefined;
    try {
      const existingFile = await this.githubService.getFile(owner, repo, file.path, branch);
      sha = existingFile.sha;
    } catch (error) {
      // File doesn't exist, that's okay
    }

    const message = `Update ${file.path} via Obsidian Mobile Git Sync`;
    
    await this.githubService.createOrUpdateFile(
      owner,
      repo,
      file.path,
      file.content,
      message,
      branch,
      sha
    );
  }

  /**
   * Downloads a file from the remote repository
   */
  private async downloadFile(file: SyncFile): Promise<void> {
    try {
      // Create directory structure if needed
      const dirPath = file.path.substring(0, file.path.lastIndexOf('/'));
      if (dirPath) {
        // Obsidian automatically creates directories when creating files
      }

      // Check if file exists locally
      const existingFile = this.app.vault.getAbstractFileByPath(file.path);
      
      if (existingFile instanceof TFile) {
        // Update existing file
        await this.app.vault.modify(existingFile, file.content);
      } else {
        // Create new file
        await this.app.vault.create(file.path, file.content);
      }
    } catch (error) {
      throw new Error(`Failed to download file ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Deletes a file from local or remote
   */
  private async deleteFile(file: SyncFile): Promise<void> {
    if (file.reason === 'local-delete') {
      // Delete from remote
      const { owner, repo } = this.parseRepoUrl();
      const branch = this.settings.branch;
      
      const remoteFile = await this.githubService.getFile(owner, repo, file.path, branch);
      const message = `Delete ${file.path} via Obsidian Mobile Git Sync`;
      
      await this.githubService.deleteFile(owner, repo, file.path, message, remoteFile.sha, branch);
    } else {
      // Delete from local
      const localFile = this.app.vault.getAbstractFileByPath(file.path);
      if (localFile instanceof TFile) {
        await this.app.vault.delete(localFile);
      }
    }
  }

  /**
   * Applies conflict resolution
   */
  private async applyConflictResolution(conflict: ConflictFile, resolution: ConflictResolution): Promise<void> {
    switch (resolution.action) {
      case 'use-local':
        await this.uploadFile({
          path: conflict.path,
          content: conflict.localContent,
          reason: 'conflict',
          size: conflict.localContent.length
        });
        break;

      case 'use-remote':
        await this.downloadFile({
          path: conflict.path,
          content: conflict.remoteContent,
          reason: 'conflict',
          size: conflict.remoteContent.length
        });
        break;

      case 'merge':
        if (resolution.mergedContent) {
          // Update both local and remote with merged content
          const localFile = this.app.vault.getAbstractFileByPath(conflict.path);
          if (localFile instanceof TFile) {
            await this.app.vault.modify(localFile, resolution.mergedContent);
          }
          
          await this.uploadFile({
            path: conflict.path,
            content: resolution.mergedContent,
            reason: 'conflict',
            size: resolution.mergedContent.length
          });
        }
        break;

      case 'skip':
        // Do nothing
        break;
    }
  }

  /**
   * Parses repository URL to extract owner and repo
   */
  private parseRepoUrl(): { owner: string; repo: string } {
    const match = this.settings.repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) {
      throw new Error('Invalid repository URL format');
    }
    return { owner: match[1], repo: match[2] };
  }

  /**
   * Checks if a file should be excluded from sync
   */
  private shouldExcludeFile(path: string, additionalPatterns: string[] = []): boolean {
    const allPatterns = [...this.settings.excludePatterns, ...additionalPatterns];
    
    return allPatterns.some(pattern => {
      // Simple glob pattern matching
      const regex = new RegExp(
        pattern
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
          .replace(/\./g, '\\.')
      );
      return regex.test(path);
    });
  }

  /**
   * Generates a human-readable sync summary
   */
  private generateSyncSummary(analysis: {
    toUpload: SyncFile[];
    toDownload: SyncFile[];
    conflicts: ConflictFile[];
    toDelete: SyncFile[];
  }): string {
    const parts: string[] = [];
    
    if (analysis.toUpload.length > 0) {
      parts.push(`${analysis.toUpload.length} files to upload`);
    }
    
    if (analysis.toDownload.length > 0) {
      parts.push(`${analysis.toDownload.length} files to download`);
    }
    
    if (analysis.conflicts.length > 0) {
      parts.push(`${analysis.conflicts.length} conflicts to resolve`);
    }
    
    if (analysis.toDelete.length > 0) {
      parts.push(`${analysis.toDelete.length} files to delete`);
    }

    if (parts.length === 0) {
      return 'Everything is up to date';
    }

    return parts.join(', ');
  }

  /**
   * Adds sync result to history
   */
  private addToHistory(result: SyncResult): void {
    this.syncHistory.push(result);
    
    if (this.syncHistory.length > this.maxHistorySize) {
      this.syncHistory = this.syncHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Disposes the service
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.cancelSync();
    this.syncHistory = [];
    this.isDisposed = true;
  }
}