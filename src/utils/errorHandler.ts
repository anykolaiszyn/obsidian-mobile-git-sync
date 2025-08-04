/**
 * Intelligent Error Handler and Recovery System
 * 
 * Provides centralized error handling with user-friendly messages,
 * automatic recovery suggestions, and intelligent retry logic
 */

import { Notice, Modal, App } from 'obsidian';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ErrorCategory = 
  | 'network' 
  | 'authentication' 
  | 'permission' 
  | 'configuration' 
  | 'conflict' 
  | 'storage' 
  | 'validation' 
  | 'unknown';

export interface ErrorContext {
  operation: string;
  filePath?: string;
  details?: any;
  timestamp: number;
  userAgent?: string;
  networkStatus?: string;
}

export interface RecoveryAction {
  type: 'retry' | 'configure' | 'resolve' | 'ignore' | 'manual';
  title: string;
  description: string;
  action?: () => Promise<void>;
  autoExecute?: boolean;
  priority: number;
}

export interface ErrorAnalysis {
  category: ErrorCategory;
  severity: ErrorSeverity;
  isRecoverable: boolean;
  userMessage: string;
  technicalDetails: string;
  recoveryActions: RecoveryAction[];
  preventionTips?: string[];
}

export class IntelligentErrorHandler {
  private errorHistory: Array<{ error: Error; context: ErrorContext; timestamp: number }> = [];
  private readonly maxHistorySize = 100;

  constructor(private app: App) {}

  /**
   * Main error handling entry point
   */
  async handleError(error: Error, context: ErrorContext): Promise<void> {
    // Record error in history
    this.recordError(error, context);

    // Analyze the error
    const analysis = this.analyzeError(error, context);

    // Log technical details
    console.error(`[${analysis.category}] ${context.operation}:`, {
      error: error.message,
      context,
      analysis
    });

    // Show user-friendly notification
    this.showUserNotification(analysis);

    // Execute automatic recovery if applicable
    await this.executeAutoRecovery(analysis);

    // Show recovery modal for manual actions
    if (analysis.recoveryActions.some(action => !action.autoExecute)) {
      await this.showRecoveryModal(analysis, error, context);
    }
  }

  /**
   * Analyzes an error and determines recovery strategy
   */
  private analyzeError(error: Error, context: ErrorContext): ErrorAnalysis {
    const message = error.message.toLowerCase();

    // Authentication errors
    if (message.includes('401') || message.includes('unauthorized') || message.includes('token')) {
      return {
        category: 'authentication',
        severity: 'high',
        isRecoverable: true,
        userMessage: 'GitHub authentication failed',
        technicalDetails: `Token validation failed: ${error.message}`,
        recoveryActions: [
          {
            type: 'configure',
            title: 'Update GitHub Token',
            description: 'Your GitHub token may be expired or invalid',
            priority: 1,
            action: async () => {
              // Open settings to token configuration
              (this.app as any).setting.open();
              (this.app as any).setting.openTabById('mobile-git-sync');
            }
          },
          {
            type: 'retry',
            title: 'Test Connection',
            description: 'Retry the operation after updating your token',
            priority: 2
          }
        ],
        preventionTips: [
          'Use a token with "repo" permissions',
          'Check token expiration date',
          'Ensure token is for the correct GitHub account'
        ]
      };
    }

    // Network errors
    if (message.includes('fetch') || message.includes('network') || message.includes('timeout')) {
      const isOffline = !navigator.onLine;
      return {
        category: 'network',
        severity: isOffline ? 'medium' : 'high',
        isRecoverable: true,
        userMessage: isOffline ? 'No internet connection' : 'Network error occurred',
        technicalDetails: `Network request failed: ${error.message}`,
        recoveryActions: [
          {
            type: 'retry',
            title: 'Retry Operation',
            description: isOffline ? 'Retry when internet connection is restored' : 'Retry the failed operation',
            priority: 1,
            autoExecute: !isOffline
          },
          ...(isOffline ? [{
            type: 'manual' as const,
            title: 'Check Connection',
            description: 'Verify your internet connection and try again',
            priority: 2
          }] : [])
        ],
        preventionTips: [
          'Enable auto-sync to handle temporary network issues',
          'Check firewall settings if on corporate network'
        ]
      };
    }

    // Rate limit errors
    if (message.includes('rate limit') || message.includes('403')) {
      return {
        category: 'permission',
        severity: 'medium',
        isRecoverable: true,
        userMessage: 'GitHub rate limit reached',
        technicalDetails: `API rate limit exceeded: ${error.message}`,
        recoveryActions: [
          {
            type: 'retry',
            title: 'Wait and Retry',
            description: 'Wait for rate limit to reset (usually 1 hour)',
            priority: 1
          },
          {
            type: 'manual',
            title: 'Reduce Sync Frequency',
            description: 'Increase auto-sync interval to avoid rate limits',
            priority: 2
          }
        ],
        preventionTips: [
          'Increase auto-sync interval',
          'Use authenticated requests (provide GitHub token)',
          'Avoid manual sync operations too frequently'
        ]
      };
    }

    // File conflicts
    if (message.includes('conflict') || message.includes('merge')) {
      return {
        category: 'conflict',
        severity: 'medium',
        isRecoverable: true,
        userMessage: 'File conflicts detected',
        technicalDetails: `Sync conflict in ${context.filePath}: ${error.message}`,
        recoveryActions: [
          {
            type: 'resolve',
            title: 'Resolve Conflicts',
            description: 'Open conflict resolution interface',
            priority: 1,
            action: async () => {
              // This would open the conflict resolution modal
              new Notice('Opening conflict resolution...', 2000);
            }
          },
          {
            type: 'manual',
            title: 'Choose Strategy',
            description: 'Select automatic conflict resolution strategy',
            priority: 2
          }
        ],
        preventionTips: [
          'Sync frequently to minimize conflicts',
          'Use Smart Sync for automatic conflict resolution',
          'Coordinate with collaborators on file editing'
        ]
      };
    }

    // Configuration errors
    if (message.includes('config') || message.includes('setting') || message.includes('repository')) {
      return {
        category: 'configuration',
        severity: 'high',
        isRecoverable: true,
        userMessage: 'Configuration issue detected',
        technicalDetails: `Configuration error: ${error.message}`,
        recoveryActions: [
          {
            type: 'configure',
            title: 'Open Settings',
            description: 'Review and update plugin configuration',
            priority: 1,
            action: async () => {
              (this.app as any).setting.open();
              (this.app as any).setting.openTabById('mobile-git-sync');
            }
          },
          {
            type: 'manual',
            title: 'Validate Settings',
            description: 'Check repository URL, branch, and token',
            priority: 2
          }
        ],
        preventionTips: [
          'Verify repository URL format',
          'Ensure branch exists on remote',
          'Test connection after configuration changes'
        ]
      };
    }

    // Storage errors
    if (message.includes('storage') || message.includes('file') || message.includes('permission')) {
      return {
        category: 'storage',
        severity: 'high',
        isRecoverable: false,
        userMessage: 'Storage access issue',
        technicalDetails: `Storage error: ${error.message}`,
        recoveryActions: [
          {
            type: 'manual',
            title: 'Check Permissions',
            description: 'Verify Obsidian has file system access',
            priority: 1
          },
          {
            type: 'manual',
            title: 'Free Up Space',
            description: 'Ensure sufficient storage space is available',
            priority: 2
          }
        ],
        preventionTips: [
          'Regularly clean up old files',
          'Monitor available storage space',
          'Check folder permissions'
        ]
      };
    }

    // Default: unknown error
    return {
      category: 'unknown',
      severity: 'medium',
      isRecoverable: false,
      userMessage: 'An unexpected error occurred',
      technicalDetails: `Unknown error: ${error.message}`,
      recoveryActions: [
        {
          type: 'retry',
          title: 'Retry Operation',
          description: 'Try the operation again',
          priority: 1
        },
        {
          type: 'manual',
          title: 'Report Issue',
          description: 'Report this issue to the plugin developer',
          priority: 3
        }
      ]
    };
  }

  /**
   * Shows user-friendly notification based on error severity
   */
  private showUserNotification(analysis: ErrorAnalysis): void {
    const duration = analysis.severity === 'critical' ? 8000 : 
                     analysis.severity === 'high' ? 5000 : 3000;

    new Notice(
      `${analysis.userMessage}. ${analysis.recoveryActions.length > 0 ? 'Click for recovery options.' : ''}`,
      duration
    );
  }

  /**
   * Executes automatic recovery actions
   */
  private async executeAutoRecovery(analysis: ErrorAnalysis): Promise<void> {
    const autoActions = analysis.recoveryActions.filter(action => action.autoExecute);
    
    for (const action of autoActions) {
      try {
        if (action.action) {
          await action.action();
        }
      } catch (recoveryError) {
        console.error('Auto-recovery action failed:', recoveryError);
      }
    }
  }

  /**
   * Shows recovery modal with manual action options
   */
  private async showRecoveryModal(analysis: ErrorAnalysis, originalError: Error, context: ErrorContext): Promise<void> {
    return new Promise((resolve) => {
      const modal = new ErrorRecoveryModal(
        this.app,
        analysis,
        originalError,
        context,
        resolve
      );
      modal.open();
    });
  }

  /**
   * Records error in history for pattern analysis
   */
  private recordError(error: Error, context: ErrorContext): void {
    this.errorHistory.push({
      error,
      context,
      timestamp: Date.now()
    });

    // Trim history to prevent memory issues
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Gets error patterns and statistics
   */
  getErrorStatistics(): {
    totalErrors: number;
    categoryCounts: Record<ErrorCategory, number>;
    recentErrors: number;
    commonErrors: Array<{ message: string; count: number }>;
  } {
    const now = Date.now();
    const recentThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    const categoryCounts: Record<ErrorCategory, number> = {
      network: 0,
      authentication: 0,
      permission: 0,
      configuration: 0,
      conflict: 0,
      storage: 0,
      validation: 0,
      unknown: 0
    };

    const errorMessages: Record<string, number> = {};
    let recentErrors = 0;

    for (const entry of this.errorHistory) {
      // Count by category (would need to re-analyze)
      const analysis = this.analyzeError(entry.error, entry.context);
      categoryCounts[analysis.category]++;

      // Count recent errors
      if (now - entry.timestamp < recentThreshold) {
        recentErrors++;
      }

      // Count error messages
      errorMessages[entry.error.message] = (errorMessages[entry.error.message] || 0) + 1;
    }

    // Get most common errors
    const commonErrors = Object.entries(errorMessages)
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalErrors: this.errorHistory.length,
      categoryCounts,
      recentErrors,
      commonErrors
    };
  }

  /**
   * Clears error history
   */
  clearErrorHistory(): void {
    this.errorHistory = [];
  }
}

/**
 * Modal for displaying error recovery options
 */
class ErrorRecoveryModal extends Modal {
  constructor(
    app: App,
    private analysis: ErrorAnalysis,
    private error: Error,
    private context: ErrorContext,
    private onCloseCallback: () => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Error Recovery' });
    
    // Error summary
    const summaryEl = contentEl.createEl('div', { cls: 'error-summary' });
    summaryEl.createEl('p', { 
      text: this.analysis.userMessage,
      cls: `error-severity-${this.analysis.severity}`
    });

    if (this.context.filePath) {
      summaryEl.createEl('p', { 
        text: `File: ${this.context.filePath}`,
        cls: 'error-file-path'
      });
    }

    // Recovery actions
    if (this.analysis.recoveryActions.length > 0) {
      contentEl.createEl('h3', { text: 'Recovery Options' });
      
      const actionsEl = contentEl.createEl('div', { cls: 'recovery-actions' });
      
      this.analysis.recoveryActions
        .filter(action => !action.autoExecute)
        .sort((a, b) => a.priority - b.priority)
        .forEach(action => {
          const actionEl = actionsEl.createEl('div', { cls: 'recovery-action' });
          
          const button = actionEl.createEl('button', {
            text: action.title,
            cls: 'mod-cta'
          });
          
          actionEl.createEl('p', { 
            text: action.description,
            cls: 'recovery-description'
          });

          button.onclick = async () => {
            try {
              if (action.action) {
                await action.action();
              }
              this.close();
            } catch (actionError) {
              new Notice(`Recovery action failed: ${actionError instanceof Error ? actionError.message : String(actionError)}`, 3000);
            }
          };
        });
    }

    // Prevention tips
    if (this.analysis.preventionTips && this.analysis.preventionTips.length > 0) {
      contentEl.createEl('h3', { text: 'Prevention Tips' });
      const tipsEl = contentEl.createEl('ul', { cls: 'prevention-tips' });
      
      this.analysis.preventionTips.forEach(tip => {
        tipsEl.createEl('li', { text: tip });
      });
    }

    // Technical details (collapsible)
    const detailsEl = contentEl.createEl('details', { cls: 'technical-details' });
    detailsEl.createEl('summary', { text: 'Technical Details' });
    detailsEl.createEl('pre', { text: this.analysis.technicalDetails });

    // Close button
    const footerEl = contentEl.createEl('div', { cls: 'modal-button-container' });
    const closeBtn = footerEl.createEl('button', { text: 'Close' });
    closeBtn.onclick = () => this.close();
  }

  onClose() {
    this.onCloseCallback();
  }
}