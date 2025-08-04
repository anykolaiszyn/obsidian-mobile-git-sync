/**
 * Status Bar Manager
 * 
 * Manages the status bar display with interactive controls,
 * progress tracking, and visual feedback
 */

import { Plugin, Menu } from 'obsidian';
import { DisposableService } from '../core/container';

export interface StatusBarState {
  status: 'idle' | 'syncing' | 'error' | 'success' | 'offline';
  message: string;
  progress?: {
    current: number;
    total: number;
    operation: string;
  };
  lastSync?: Date;
  pendingChanges?: number;
}

export interface StatusBarOptions {
  showProgress: boolean;
  showLastSync: boolean;
  showPendingChanges: boolean;
  animateChanges: boolean;
  clickAction?: () => void;
  contextMenuActions?: Array<{
    title: string;
    icon?: string;
    action: () => void;
  }>;
}

export class StatusBarManager extends DisposableService {
  private statusBarItem: HTMLElement | null = null;
  private currentState: StatusBarState = {
    status: 'idle',
    message: 'Git Sync Ready'
  };
  private updateInterval: NodeJS.Timeout | null = null;
  private progressAnimationFrame: number | null = null;

  constructor(
    private plugin: Plugin,
    private options: StatusBarOptions = { showProgress: true, showLastSync: true, showPendingChanges: true, animateChanges: true }
  ) {
    super();
    this.initialize();
  }

  /**
   * Initializes the status bar
   */
  private initialize(): void {
    this.statusBarItem = this.plugin.addStatusBarItem();
    this.setupInteractions();
    this.startUpdateLoop();
    this.updateDisplay();
  }

  /**
   * Updates the status bar state
   */
  updateStatus(newState: Partial<StatusBarState>): void {
    this.checkDisposed();

    const previousState = { ...this.currentState };
    this.currentState = { ...this.currentState, ...newState };

    // Animate changes if enabled
    if (this.options.animateChanges && this.statusBarItem) {
      this.animateStateChange(previousState, this.currentState);
    } else {
      this.updateDisplay();
    }

    // Log status changes for debugging
    if (newState.status && newState.status !== previousState.status) {
      console.debug(`Status bar: ${previousState.status} → ${newState.status}`);
    }
  }

  /**
   * Sets the current sync progress
   */
  setProgress(current: number, total: number, operation: string): void {
    this.updateStatus({
      status: 'syncing',
      progress: { current, total, operation },
      message: `${operation}: ${current}/${total}`
    });
  }

  /**
   * Clears the current progress
   */
  clearProgress(): void {
    this.updateStatus({
      progress: undefined
    });
  }

  /**
   * Shows a temporary success message
   */
  showSuccess(message: string, duration: number = 3000): void {
    const originalState = { ...this.currentState };
    
    this.updateStatus({
      status: 'success',
      message
    });

    setTimeout(() => {
      if (this.currentState.status === 'success') {
        this.updateStatus({
          status: originalState.status,
          message: originalState.message
        });
      }
    }, duration);
  }

  /**
   * Shows a temporary error message
   */
  showError(message: string, duration: number = 5000): void {
    const originalState = { ...this.currentState };
    
    this.updateStatus({
      status: 'error',
      message
    });

    setTimeout(() => {
      if (this.currentState.status === 'error') {
        this.updateStatus({
          status: originalState.status,
          message: originalState.message
        });
      }
    }, duration);
  }

  /**
   * Updates the pending changes count
   */
  setPendingChanges(count: number): void {
    this.updateStatus({
      pendingChanges: count
    });
  }

  /**
   * Sets the last sync time
   */
  setLastSync(date: Date): void {
    this.updateStatus({
      lastSync: date
    });
  }

  /**
   * Sets up click and context menu interactions
   */
  private setupInteractions(): void {
    if (!this.statusBarItem) return;

    // Click handler
    this.statusBarItem.onclick = (event) => {
      event.preventDefault();
      if (this.options.clickAction) {
        this.options.clickAction();
      } else {
        this.showDefaultContextMenu(event);
      }
    };

    // Context menu (right-click)
    this.statusBarItem.oncontextmenu = (event) => {
      event.preventDefault();
      this.showContextMenu(event);
    };

    // Hover effects
    this.statusBarItem.addEventListener('mouseenter', () => {
      this.statusBarItem?.addClass('status-bar-hover');
    });

    this.statusBarItem.addEventListener('mouseleave', () => {
      this.statusBarItem?.removeClass('status-bar-hover');
    });
  }

  /**
   * Shows the context menu with available actions
   */
  private showContextMenu(event: MouseEvent): void {
    const menu = new Menu();

    // Add custom actions if provided
    if (this.options.contextMenuActions) {
      this.options.contextMenuActions.forEach(action => {
        menu.addItem(item => {
          item.setTitle(action.title);
          if (action.icon) {
            item.setIcon(action.icon);
          }
          item.onClick(action.action);
        });
      });

      menu.addSeparator();
    }

    // Add default actions
    menu.addItem(item => {
      item.setTitle('Show Sync Status');
      item.setIcon('info');
      item.onClick(() => this.showDetailedStatus());
    });

    menu.addItem(item => {
      item.setTitle('Copy Status Info');
      item.setIcon('copy');
      item.onClick(() => this.copyStatusToClipboard());
    });

    menu.showAtMouseEvent(event);
  }

  /**
   * Shows default context menu when no click action is set
   */
  private showDefaultContextMenu(event: MouseEvent): void {
    this.showContextMenu(event);
  }

  /**
   * Updates the visual display of the status bar
   */
  private updateDisplay(): void {
    if (!this.statusBarItem) return;

    const { status, message, progress, lastSync, pendingChanges } = this.currentState;

    // Clear previous content
    this.statusBarItem.empty();

    // Create main container
    const container = this.statusBarItem.createEl('div', { cls: 'git-sync-status' });

    // Status indicator
    const indicator = container.createEl('span', { 
      cls: `status-indicator status-${status}`,
      attr: { 'aria-label': `Sync status: ${status}` }
    });

    // Add status icon
    const icon = this.getStatusIcon(status);
    if (icon) {
      indicator.createEl('span', { cls: `status-icon ${icon}` });
    }

    // Main message
    const messageEl = container.createEl('span', { 
      text: message,
      cls: 'status-message'
    });

    // Progress bar (if showing progress)
    if (progress && this.options.showProgress) {
      const progressContainer = container.createEl('div', { cls: 'progress-container' });
      const progressBar = progressContainer.createEl('div', { cls: 'progress-bar' });
      const progressFill = progressBar.createEl('div', { cls: 'progress-fill' });
      
      const percentage = Math.round((progress.current / progress.total) * 100);
      progressFill.style.width = `${percentage}%`;
      
      progressContainer.createEl('span', { 
        text: `${percentage}%`,
        cls: 'progress-text'
      });
    }

    // Additional info
    const infoEl = container.createEl('div', { cls: 'status-info' });

    // Pending changes
    if (pendingChanges !== undefined && pendingChanges > 0 && this.options.showPendingChanges) {
      infoEl.createEl('span', {
        text: `${pendingChanges} pending`,
        cls: 'pending-changes',
        attr: { 'title': `${pendingChanges} files waiting to sync` }
      });
    }

    // Last sync time
    if (lastSync && this.options.showLastSync) {
      const timeAgo = this.formatTimeAgo(lastSync);
      infoEl.createEl('span', {
        text: timeAgo,
        cls: 'last-sync',
        attr: { 'title': `Last sync: ${lastSync.toLocaleString()}` }
      });
    }

    // Apply CSS classes for styling
    container.addClass(`status-${status}`);
    
    // Add accessibility attributes
    this.statusBarItem.setAttribute('role', 'status');
    this.statusBarItem.setAttribute('aria-live', 'polite');
    this.statusBarItem.setAttribute('tabindex', '0');
  }

  /**
   * Animates state changes
   */
  private animateStateChange(previousState: StatusBarState, newState: StatusBarState): void {
    if (!this.statusBarItem) return;

    // Cancel any existing animation
    if (this.progressAnimationFrame) {
      cancelAnimationFrame(this.progressAnimationFrame);
    }

    // Add transition class
    this.statusBarItem.addClass('status-transitioning');

    // Animate the change
    this.progressAnimationFrame = requestAnimationFrame(() => {
      this.updateDisplay();
      
      setTimeout(() => {
        this.statusBarItem?.removeClass('status-transitioning');
        this.progressAnimationFrame = null;
      }, 300); // Match CSS transition duration
    });
  }

  /**
   * Gets the appropriate icon for a status
   */
  private getStatusIcon(status: StatusBarState['status']): string {
    switch (status) {
      case 'idle': return 'circle';
      case 'syncing': return 'refresh-cw';
      case 'success': return 'check-circle';
      case 'error': return 'alert-circle';
      case 'offline': return 'wifi-off';
      default: return 'circle';
    }
  }

  /**
   * Formats time ago in a human-readable format
   */
  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }

  /**
   * Shows detailed status information in a modal
   */
  private showDetailedStatus(): void {
    // This would open a detailed status modal
    // Implementation depends on the modal system
    console.info('Detailed status:', this.currentState);
  }

  /**
   * Copies current status information to clipboard
   */
  private async copyStatusToClipboard(): Promise<void> {
    const statusInfo = {
      status: this.currentState.status,
      message: this.currentState.message,
      lastSync: this.currentState.lastSync?.toISOString(),
      pendingChanges: this.currentState.pendingChanges,
      timestamp: new Date().toISOString()
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(statusInfo, null, 2));
      this.showSuccess('Status copied to clipboard');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      this.showError('Failed to copy status');
    }
  }

  /**
   * Starts the update loop for dynamic content
   */
  private startUpdateLoop(): void {
    this.updateInterval = setInterval(() => {
      // Update relative timestamps
      if (this.currentState.lastSync && this.options.showLastSync) {
        this.updateDisplay();
      }
    }, 60000); // Update every minute
  }

  /**
   * Stops the update loop
   */
  private stopUpdateLoop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Gets current status state (for external access)
   */
  getCurrentState(): Readonly<StatusBarState> {
    return { ...this.currentState };
  }

  /**
   * Updates configuration options
   */
  updateOptions(newOptions: Partial<StatusBarOptions>): void {
    this.options = { ...this.options, ...newOptions };
    this.updateDisplay();
  }

  /**
   * Disposes the status bar manager
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.stopUpdateLoop();
    
    if (this.progressAnimationFrame) {
      cancelAnimationFrame(this.progressAnimationFrame);
    }

    if (this.statusBarItem) {
      this.statusBarItem.remove();
      this.statusBarItem = null;
    }

    this.isDisposed = true;
  }
}