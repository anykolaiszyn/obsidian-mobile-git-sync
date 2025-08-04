/**
 * Advanced Conflict Resolution Modal
 * 
 * Provides side-by-side diff viewing, three-way merge capabilities,
 * and intelligent conflict resolution with mobile-optimized UI
 */

import { Modal, App, Setting } from 'obsidian';
import { ConflictFile } from '../types';

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  localLine?: string;
  remoteLine?: string;
  lineNumber: number;
  localLineNumber?: number;
  remoteLineNumber?: number;
}

export interface ConflictResolutionResult {
  action: 'use-local' | 'use-remote' | 'merge' | 'skip';
  mergedContent?: string;
  userNotes?: string;
}

export class AdvancedConflictModal extends Modal {
  private diffLines: DiffLine[] = [];
  private mergedContent: string = '';
  private selectedResolution: ConflictResolutionResult['action'] = 'use-local';
  private isMobileView: boolean = false;

  constructor(
    app: App,
    private conflict: ConflictFile,
    private onResolve: (result: ConflictResolutionResult) => void
  ) {
    super(app);
    this.isMobileView = this.checkMobileView();
    this.calculateDiff();
    this.initializeMergedContent();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('conflict-resolution-modal');
    
    if (this.isMobileView) {
      contentEl.addClass('mobile-optimized');
    }

    this.renderHeader();
    this.renderConflictInfo();
    this.renderDiffViewer();
    this.renderResolutionControls();
    this.renderActionButtons();
  }

  /**
   * Renders the modal header
   */
  private renderHeader(): void {
    const headerEl = this.contentEl.createEl('div', { cls: 'conflict-header' });
    
    headerEl.createEl('h2', { 
      text: `Resolve Conflict: ${this.getFileName()}`,
      cls: 'conflict-title'
    });

    // File path breadcrumb
    const pathEl = headerEl.createEl('div', { cls: 'file-path' });
    const pathParts = this.conflict.path.split('/');
    pathParts.forEach((part, index) => {
      if (index > 0) {
        pathEl.createEl('span', { text: ' / ', cls: 'path-separator' });
      }
      pathEl.createEl('span', { 
        text: part,
        cls: index === pathParts.length - 1 ? 'file-name' : 'folder-name'
      });
    });
  }

  /**
   * Renders conflict information and statistics
   */
  private renderConflictInfo(): void {
    const infoEl = this.contentEl.createEl('div', { cls: 'conflict-info' });
    
    const stats = this.calculateConflictStats();
    
    const statsGrid = infoEl.createEl('div', { cls: 'stats-grid' });
    
    this.createStatItem(statsGrid, 'Lines Added', stats.linesAdded, 'added');
    this.createStatItem(statsGrid, 'Lines Removed', stats.linesRemoved, 'removed');
    this.createStatItem(statsGrid, 'Lines Modified', stats.linesModified, 'modified');
    this.createStatItem(statsGrid, 'Conflict Severity', stats.severity, `severity-${stats.severity}`);

    // Timestamps
    if (this.conflict.localMtime && this.conflict.remoteMtime) {
      const timeEl = infoEl.createEl('div', { cls: 'time-info' });
      
      timeEl.createEl('div', { cls: 'time-item' }).innerHTML = `
        <strong>Local:</strong> ${this.formatTimestamp(this.conflict.localMtime)}
      `;
      
      timeEl.createEl('div', { cls: 'time-item' }).innerHTML = `
        <strong>Remote:</strong> ${this.formatTimestamp(this.conflict.remoteMtime)}
      `;
    }

    // AI suggestions (if available)
    const suggestions = this.generateResolutionSuggestions();
    if (suggestions.length > 0) {
      const suggestionsEl = infoEl.createEl('div', { cls: 'ai-suggestions' });
      suggestionsEl.createEl('h4', { text: '💡 Smart Suggestions' });
      
      const suggestionsList = suggestionsEl.createEl('ul');
      suggestions.forEach(suggestion => {
        suggestionsList.createEl('li', { text: suggestion });
      });
    }
  }

  /**
   * Renders the diff viewer with side-by-side or unified view
   */
  private renderDiffViewer(): void {
    const viewerEl = this.contentEl.createEl('div', { cls: 'diff-viewer' });
    
    // View mode selector
    const modeSelector = viewerEl.createEl('div', { cls: 'view-mode-selector' });
    
    const sideBySideBtn = modeSelector.createEl('button', {
      text: 'Side by Side',
      cls: 'view-mode-btn active'
    });
    
    const unifiedBtn = modeSelector.createEl('button', {
      text: 'Unified',
      cls: 'view-mode-btn'
    });

    // Diff container
    const diffContainer = viewerEl.createEl('div', { cls: 'diff-container' });
    
    // Initially render side-by-side
    this.renderSideBySideDiff(diffContainer);

    // Mode switching
    sideBySideBtn.onclick = () => {
      this.setActiveButton(sideBySideBtn, unifiedBtn);
      diffContainer.empty();
      this.renderSideBySideDiff(diffContainer);
    };

    unifiedBtn.onclick = () => {
      this.setActiveButton(unifiedBtn, sideBySideBtn);
      diffContainer.empty();
      this.renderUnifiedDiff(diffContainer);
    };

    // Mobile optimization: start with unified view
    if (this.isMobileView) {
      unifiedBtn.click();
    }
  }

  /**
   * Renders side-by-side diff view
   */
  private renderSideBySideDiff(container: HTMLElement): void {
    container.addClass('side-by-side');
    
    const leftPanel = container.createEl('div', { cls: 'diff-panel left-panel' });
    const rightPanel = container.createEl('div', { cls: 'diff-panel right-panel' });

    // Headers
    leftPanel.createEl('div', { cls: 'panel-header', text: 'Local Version' });
    rightPanel.createEl('div', { cls: 'panel-header', text: 'Remote Version' });

    // Line numbers and content
    const leftContent = leftPanel.createEl('div', { cls: 'diff-content' });
    const rightContent = rightPanel.createEl('div', { cls: 'diff-content' });

    this.diffLines.forEach((diffLine, index) => {
      // Left side (local)
      const leftLineEl = leftContent.createEl('div', { 
        cls: `diff-line ${diffLine.type} ${diffLine.localLine ? '' : 'empty-line'}`
      });
      
      if (diffLine.localLineNumber) {
        leftLineEl.createEl('span', { 
          cls: 'line-number',
          text: diffLine.localLineNumber.toString()
        });
      }
      
      leftLineEl.createEl('span', { 
        cls: 'line-content',
        text: diffLine.localLine || ''
      });

      // Right side (remote)
      const rightLineEl = rightContent.createEl('div', { 
        cls: `diff-line ${diffLine.type} ${diffLine.remoteLine ? '' : 'empty-line'}`
      });
      
      if (diffLine.remoteLineNumber) {
        rightLineEl.createEl('span', { 
          cls: 'line-number',
          text: diffLine.remoteLineNumber.toString()
        });
      }
      
      rightLineEl.createEl('span', { 
        cls: 'line-content',
        text: diffLine.remoteLine || ''
      });

      // Sync scrolling
      leftLineEl.addEventListener('mouseenter', () => {
        rightLineEl.addClass('highlighted');
      });
      
      leftLineEl.addEventListener('mouseleave', () => {
        rightLineEl.removeClass('highlighted');
      });
    });
  }

  /**
   * Renders unified diff view
   */
  private renderUnifiedDiff(container: HTMLElement): void {
    container.addClass('unified');
    
    const unifiedContent = container.createEl('div', { cls: 'unified-content' });
    
    this.diffLines.forEach(diffLine => {
      const lineEl = unifiedContent.createEl('div', { 
        cls: `diff-line ${diffLine.type}`
      });

      // Line indicator
      const indicator = lineEl.createEl('span', { cls: 'line-indicator' });
      switch (diffLine.type) {
        case 'added':
          indicator.text = '+';
          break;
        case 'removed':
          indicator.text = '-';
          break;
        case 'modified':
          indicator.text = '~';
          break;
        default:
          indicator.text = ' ';
      }

      // Line content
      const content = diffLine.localLine || diffLine.remoteLine || '';
      lineEl.createEl('span', { 
        cls: 'line-content',
        text: content
      });

      // Show both versions for modified lines
      if (diffLine.type === 'modified' && diffLine.localLine && diffLine.remoteLine) {
        const modifiedContainer = lineEl.createEl('div', { cls: 'modified-versions' });
        
        modifiedContainer.createEl('div', { 
          cls: 'version local-version',
          text: `- ${diffLine.localLine}`
        });
        
        modifiedContainer.createEl('div', { 
          cls: 'version remote-version',
          text: `+ ${diffLine.remoteLine}`
        });
      }
    });
  }

  /**
   * Renders resolution controls
   */
  private renderResolutionControls(): void {
    const controlsEl = this.contentEl.createEl('div', { cls: 'resolution-controls' });
    
    controlsEl.createEl('h3', { text: 'Resolution Options' });

    // Quick resolution buttons
    const quickActions = controlsEl.createEl('div', { cls: 'quick-actions' });
    
    this.createResolutionButton(quickActions, 'use-local', '← Use Local', 'Keep your local changes');
    this.createResolutionButton(quickActions, 'use-remote', 'Use Remote →', 'Accept remote changes');
    
    // Advanced options
    const advancedEl = controlsEl.createEl('details', { cls: 'advanced-options' });
    advancedEl.createEl('summary', { text: 'Advanced Options' });

    // Manual merge option
    const mergeSection = advancedEl.createEl('div', { cls: 'merge-section' });
    
    const mergeButton = mergeSection.createEl('button', {
      text: '🔀 Manual Merge',
      cls: 'merge-button'
    });
    
    mergeButton.onclick = () => {
      this.enableManualMerge();
    };

    // Merge preview
    const mergePreview = mergeSection.createEl('div', { cls: 'merge-preview hidden' });
    mergePreview.createEl('h4', { text: 'Merged Content Preview' });
    
    const mergeTextarea = mergePreview.createEl('textarea', {
      cls: 'merge-textarea',
      value: this.mergedContent
    });

    mergeTextarea.addEventListener('input', () => {
      this.mergedContent = mergeTextarea.value;
    });

    // Notes section
    const notesSection = advancedEl.createEl('div', { cls: 'notes-section' });
    notesSection.createEl('label', { text: 'Resolution Notes (optional):' });
    
    const notesTextarea = notesSection.createEl('textarea', {
      cls: 'notes-textarea',
      placeholder: 'Add notes about this resolution for future reference...'
    });
  }

  /**
   * Renders action buttons
   */
  private renderActionButtons(): void {
    const actionsEl = this.contentEl.createEl('div', { cls: 'modal-actions' });
    
    // Primary action
    const resolveBtn = actionsEl.createEl('button', {
      text: 'Resolve Conflict',
      cls: 'mod-cta resolve-btn'
    });
    
    resolveBtn.onclick = () => {
      this.resolveConflict();
    };

    // Secondary actions
    const skipBtn = actionsEl.createEl('button', {
      text: 'Skip for Now',
      cls: 'skip-btn'
    });
    
    skipBtn.onclick = () => {
      this.resolveWith('skip');
    };

    const cancelBtn = actionsEl.createEl('button', {
      text: 'Cancel',
      cls: 'cancel-btn'
    });
    
    cancelBtn.onclick = () => {
      this.close();
    };

    // Mobile optimization: stack buttons vertically
    if (this.isMobileView) {
      actionsEl.addClass('mobile-actions');
    }
  }

  /**
   * Creates a resolution button
   */
  private createResolutionButton(
    container: HTMLElement,
    action: ConflictResolutionResult['action'],
    text: string,
    description: string
  ): void {
    const buttonContainer = container.createEl('div', { cls: 'resolution-option' });
    
    const button = buttonContainer.createEl('button', {
      text,
      cls: `resolution-btn ${action === this.selectedResolution ? 'selected' : ''}`
    });
    
    buttonContainer.createEl('p', { 
      text: description,
      cls: 'resolution-description'
    });

    button.onclick = () => {
      this.selectedResolution = action;
      this.updateSelectedButton();
    };
  }

  /**
   * Creates a stat item for the info panel
   */
  private createStatItem(
    container: HTMLElement,
    label: string,
    value: string | number,
    className: string
  ): void {
    const statEl = container.createEl('div', { cls: `stat-item ${className}` });
    statEl.createEl('div', { text: value.toString(), cls: 'stat-value' });
    statEl.createEl('div', { text: label, cls: 'stat-label' });
  }

  /**
   * Enables manual merge mode
   */
  private enableManualMerge(): void {
    this.selectedResolution = 'merge';
    
    const mergePreview = this.contentEl.querySelector('.merge-preview') as HTMLElement;
    mergePreview?.removeClass('hidden');
    
    this.updateSelectedButton();
  }

  /**
   * Updates the selected resolution button
   */
  private updateSelectedButton(): void {
    const buttons = this.contentEl.querySelectorAll('.resolution-btn');
    buttons.forEach(btn => btn.removeClass('selected'));
    
    const selectedBtn = this.contentEl.querySelector(`.resolution-btn.${this.selectedResolution}`);
    selectedBtn?.addClass('selected');
  }

  /**
   * Sets active button in mode selector
   */
  private setActiveButton(active: HTMLElement, inactive: HTMLElement): void {
    active.addClass('active');
    inactive.removeClass('active');
  }

  /**
   * Resolves the conflict with the selected option
   */
  private resolveConflict(): void {
    const notesTextarea = this.contentEl.querySelector('.notes-textarea') as HTMLTextAreaElement;
    const userNotes = notesTextarea?.value;

    const result: ConflictResolutionResult = {
      action: this.selectedResolution,
      userNotes
    };

    if (this.selectedResolution === 'merge') {
      result.mergedContent = this.mergedContent;
    }

    this.onResolve(result);
    this.close();
  }

  /**
   * Resolves with a specific action
   */
  private resolveWith(action: ConflictResolutionResult['action']): void {
    this.onResolve({ action });
    this.close();
  }

  /**
   * Calculates diff between local and remote content
   */
  private calculateDiff(): void {
    const localLines = this.conflict.localContent.split('\n');
    const remoteLines = this.conflict.remoteContent.split('\n');

    // Simple diff algorithm (could be enhanced with Myers' algorithm)
    this.diffLines = this.performSimpleDiff(localLines, remoteLines);
  }

  /**
   * Performs a simple line-by-line diff
   */
  private performSimpleDiff(localLines: string[], remoteLines: string[]): DiffLine[] {
    const diff: DiffLine[] = [];
    const maxLength = Math.max(localLines.length, remoteLines.length);

    for (let i = 0; i < maxLength; i++) {
      const localLine = localLines[i];
      const remoteLine = remoteLines[i];

      if (localLine === remoteLine) {
        // Lines are identical
        if (localLine !== undefined) {
          diff.push({
            type: 'unchanged',
            localLine,
            remoteLine,
            lineNumber: i + 1,
            localLineNumber: i + 1,
            remoteLineNumber: i + 1
          });
        }
      } else if (localLine === undefined) {
        // Line only in remote
        diff.push({
          type: 'added',
          remoteLine,
          lineNumber: i + 1,
          remoteLineNumber: i + 1
        });
      } else if (remoteLine === undefined) {
        // Line only in local
        diff.push({
          type: 'removed',
          localLine,
          lineNumber: i + 1,
          localLineNumber: i + 1
        });
      } else {
        // Lines differ
        diff.push({
          type: 'modified',
          localLine,
          remoteLine,
          lineNumber: i + 1,
          localLineNumber: i + 1,
          remoteLineNumber: i + 1
        });
      }
    }

    return diff;
  }

  /**
   * Initializes merged content with a basic merge attempt
   */
  private initializeMergedContent(): void {
    // Simple merge attempt - could be enhanced with proper three-way merge
    const localLines = this.conflict.localContent.split('\n');
    const remoteLines = this.conflict.remoteContent.split('\n');
    const merged: string[] = [];

    const maxLength = Math.max(localLines.length, remoteLines.length);

    for (let i = 0; i < maxLength; i++) {
      const localLine = localLines[i];
      const remoteLine = remoteLines[i];

      if (localLine === remoteLine) {
        if (localLine !== undefined) {
          merged.push(localLine);
        }
      } else if (localLine === undefined) {
        merged.push(remoteLine);
      } else if (remoteLine === undefined) {
        merged.push(localLine);
      } else {
        // Conflict - add markers
        merged.push('<<<<<<< LOCAL');
        merged.push(localLine);
        merged.push('=======');
        merged.push(remoteLine);
        merged.push('>>>>>>> REMOTE');
      }
    }

    this.mergedContent = merged.join('\n');
  }

  /**
   * Calculates conflict statistics
   */
  private calculateConflictStats(): {
    linesAdded: number;
    linesRemoved: number;
    linesModified: number;
    severity: 'low' | 'medium' | 'high';
  } {
    let linesAdded = 0;
    let linesRemoved = 0;
    let linesModified = 0;

    this.diffLines.forEach(line => {
      switch (line.type) {
        case 'added':
          linesAdded++;
          break;
        case 'removed':
          linesRemoved++;
          break;
        case 'modified':
          linesModified++;
          break;
      }
    });

    const totalChanges = linesAdded + linesRemoved + linesModified;
    let severity: 'low' | 'medium' | 'high' = 'low';

    if (totalChanges > 20) {
      severity = 'high';
    } else if (totalChanges > 5) {
      severity = 'medium';
    }

    return { linesAdded, linesRemoved, linesModified, severity };
  }

  /**
   * Generates AI-powered resolution suggestions
   */
  private generateResolutionSuggestions(): string[] {
    const suggestions: string[] = [];
    const stats = this.calculateConflictStats();

    if (stats.linesAdded > stats.linesRemoved) {
      suggestions.push('Remote version has more additions - consider accepting remote changes');
    }

    if (stats.linesModified > 10) {
      suggestions.push('Many lines modified - manual review recommended');
    }

    if (this.conflict.localMtime && this.conflict.remoteMtime) {
      const timeDiff = Math.abs(this.conflict.localMtime - this.conflict.remoteMtime);
      if (timeDiff < 60000) { // Less than 1 minute
        suggestions.push('Files modified very close in time - potential race condition');
      }
    }

    if (stats.severity === 'low') {
      suggestions.push('Low complexity conflict - auto-merge may be suitable');
    }

    return suggestions;
  }

  /**
   * Checks if we're in mobile view
   */
  private checkMobileView(): boolean {
    return window.innerWidth < 768 || 'ontouchstart' in window;
  }

  /**
   * Gets filename from path
   */
  private getFileName(): string {
    return this.conflict.path.split('/').pop() || this.conflict.path;
  }

  /**
   * Formats timestamp for display
   */
  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
    
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }
}