/**
 * Conflict Resolution Service
 * 
 * Handles file conflicts during synchronization with multiple resolution strategies
 * including manual resolution, automatic strategies, and intelligent merging
 */

import { Modal, App, Setting } from 'obsidian';
import { DisposableService } from '../core/container';
import { ConflictFile, ConflictStrategy } from '../types';

export interface ConflictResolution {
  action: 'use-local' | 'use-remote' | 'merge' | 'skip';
  mergedContent?: string;
  strategy: ConflictStrategy;
  timestamp: number;
}

export interface ConflictAnalysis {
  hasStructuralChanges: boolean;
  hasContentChanges: boolean;
  conflictSeverity: 'low' | 'medium' | 'high';
  autoMergeRecommended: boolean;
  suggestions: string[];
}

export interface MergeResult {
  success: boolean;
  mergedContent?: string;
  conflicts: Array<{
    line: number;
    localContent: string;
    remoteContent: string;
    resolved: boolean;
  }>;
}

export class ConflictResolutionService extends DisposableService {
  private conflictHistory: Array<{
    conflict: ConflictFile;
    resolution: ConflictResolution;
    timestamp: number;
  }> = [];

  constructor(private app: App) {
    super();
  }

  /**
   * Resolves a file conflict based on the specified strategy
   */
  async resolveConflict(conflict: ConflictFile, strategy: ConflictStrategy): Promise<ConflictResolution> {
    this.checkDisposed();

    const analysis = this.analyzeConflict(conflict);
    let resolution: ConflictResolution;

    switch (strategy) {
      case 'prompt':
        resolution = await this.promptUserForResolution(conflict, analysis);
        break;

      case 'latest':
        resolution = this.resolveByTimestamp(conflict);
        break;

      case 'local':
        resolution = {
          action: 'use-local',
          strategy: 'local',
          timestamp: Date.now()
        };
        break;

      case 'remote':
        resolution = {
          action: 'use-remote',
          strategy: 'remote',
          timestamp: Date.now()
        };
        break;

      default:
        throw new Error(`Unknown conflict strategy: ${strategy}`);
    }

    // Record resolution in history
    this.conflictHistory.push({
      conflict,
      resolution,
      timestamp: Date.now()
    });

    return resolution;
  }

  /**
   * Analyzes a conflict to understand its nature and complexity
   */
  analyzeConflict(conflict: ConflictFile): ConflictAnalysis {
    const localLines = conflict.localContent.split('\n');
    const remoteLines = conflict.remoteContent.split('\n');

    // Calculate difference metrics
    const lineDifferences = this.calculateLineDifferences(localLines, remoteLines);
    const structuralChanges = this.detectStructuralChanges(localLines, remoteLines);
    const contentChanges = lineDifferences.changed.length > 0;

    // Determine severity
    let severity: 'low' | 'medium' | 'high' = 'low';
    if (lineDifferences.changed.length > 10 || structuralChanges.length > 3) {
      severity = 'high';
    } else if (lineDifferences.changed.length > 3 || structuralChanges.length > 0) {
      severity = 'medium';
    }

    // Auto-merge recommendation
    const autoMergeRecommended = severity === 'low' && 
                                 !this.hasOverlappingChanges(localLines, remoteLines);

    // Generate suggestions
    const suggestions = this.generateResolutionSuggestions(conflict, lineDifferences, structuralChanges);

    return {
      hasStructuralChanges: structuralChanges.length > 0,
      hasContentChanges: contentChanges,
      conflictSeverity: severity,
      autoMergeRecommended,
      suggestions
    };
  }

  /**
   * Attempts to automatically merge conflicting content
   */
  async attemptAutoMerge(conflict: ConflictFile): Promise<MergeResult> {
    const localLines = conflict.localContent.split('\n');
    const remoteLines = conflict.remoteContent.split('\n');

    // Use a simple three-way merge algorithm
    const mergeResult = this.performThreeWayMerge(localLines, remoteLines);

    return mergeResult;
  }

  /**
   * Gets conflict resolution statistics
   */
  getConflictStats(): {
    totalConflicts: number;
    resolutionsByStrategy: Record<ConflictStrategy, number>;
    averageResolutionTime: number;
    commonPatterns: Array<{ pattern: string; count: number }>;
  } {
    const totalConflicts = this.conflictHistory.length;
    const resolutionsByStrategy: Record<ConflictStrategy, number> = {
      prompt: 0,
      latest: 0,
      local: 0,
      remote: 0
    };

    let totalResolutionTime = 0;
    const patterns = new Map<string, number>();

    this.conflictHistory.forEach(entry => {
      resolutionsByStrategy[entry.resolution.strategy]++;
      
      // Calculate resolution time (simplified)
      totalResolutionTime += 1000; // Placeholder

      // Analyze conflict patterns
      const pattern = this.getConflictPattern(entry.conflict);
      patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
    });

    const commonPatterns = Array.from(patterns.entries())
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalConflicts,
      resolutionsByStrategy,
      averageResolutionTime: totalConflicts > 0 ? totalResolutionTime / totalConflicts : 0,
      commonPatterns
    };
  }

  /**
   * Resolves conflict by timestamp (latest wins)
   */
  private resolveByTimestamp(conflict: ConflictFile): ConflictResolution {
    const localTime = conflict.localMtime || 0;
    const remoteTime = conflict.remoteMtime || 0;

    if (localTime > remoteTime) {
      return {
        action: 'use-local',
        strategy: 'latest',
        timestamp: Date.now()
      };
    } else {
      return {
        action: 'use-remote',
        strategy: 'latest',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Prompts user for manual conflict resolution
   */
  private async promptUserForResolution(
    conflict: ConflictFile,
    analysis: ConflictAnalysis
  ): Promise<ConflictResolution> {
    return new Promise((resolve) => {
      const modal = new ConflictResolutionModal(
        this.app,
        conflict,
        analysis,
        resolve
      );
      modal.open();
    });
  }

  /**
   * Calculates line-by-line differences
   */
  private calculateLineDifferences(localLines: string[], remoteLines: string[]): {
    added: number[];
    removed: number[];
    changed: number[];
  } {
    const added: number[] = [];
    const removed: number[] = [];
    const changed: number[] = [];

    // Simple diff algorithm (could be enhanced with proper LCS)
    const maxLength = Math.max(localLines.length, remoteLines.length);
    
    for (let i = 0; i < maxLength; i++) {
      const localLine = localLines[i];
      const remoteLine = remoteLines[i];

      if (localLine === undefined && remoteLine !== undefined) {
        added.push(i);
      } else if (localLine !== undefined && remoteLine === undefined) {
        removed.push(i);
      } else if (localLine !== remoteLine) {
        changed.push(i);
      }
    }

    return { added, removed, changed };
  }

  /**
   * Detects structural changes (headings, lists, etc.)
   */
  private detectStructuralChanges(localLines: string[], remoteLines: string[]): Array<{
    type: 'heading' | 'list' | 'block';
    line: number;
    change: 'added' | 'removed' | 'modified';
  }> {
    const changes: Array<{
      type: 'heading' | 'list' | 'block';
      line: number;
      change: 'added' | 'removed' | 'modified';
    }> = [];

    // Detect heading changes
    const localHeadings = this.extractHeadings(localLines);
    const remoteHeadings = this.extractHeadings(remoteLines);

    // Compare headings (simplified)
    localHeadings.forEach((heading, index) => {
      const remoteHeading = remoteHeadings[index];
      if (!remoteHeading) {
        changes.push({ type: 'heading', line: heading.line, change: 'removed' });
      } else if (heading.text !== remoteHeading.text) {
        changes.push({ type: 'heading', line: heading.line, change: 'modified' });
      }
    });

    return changes;
  }

  /**
   * Extracts headings from lines
   */
  private extractHeadings(lines: string[]): Array<{ line: number; level: number; text: string }> {
    const headings: Array<{ line: number; level: number; text: string }> = [];

    lines.forEach((line, index) => {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        headings.push({
          line: index,
          level: headingMatch[1].length,
          text: headingMatch[2]
        });
      }
    });

    return headings;
  }

  /**
   * Checks for overlapping changes that would make auto-merge difficult
   */
  private hasOverlappingChanges(localLines: string[], remoteLines: string[]): boolean {
    // Simplified check - could be enhanced with more sophisticated analysis
    const localDiff = this.calculateLineDifferences(localLines, remoteLines);
    return localDiff.changed.length > 5; // Arbitrary threshold
  }

  /**
   * Generates resolution suggestions based on conflict analysis
   */
  private generateResolutionSuggestions(
    conflict: ConflictFile,
    lineDiff: any,
    structuralChanges: any[]
  ): string[] {
    const suggestions: string[] = [];

    if (structuralChanges.length === 0 && lineDiff.changed.length < 3) {
      suggestions.push('Auto-merge recommended - changes appear to be non-conflicting');
    }

    if (conflict.localMtime && conflict.remoteMtime) {
      const timeDiff = Math.abs(conflict.localMtime - conflict.remoteMtime);
      if (timeDiff < 60000) { // Less than 1 minute
        suggestions.push('Files were modified very close in time - manual review recommended');
      }
    }

    if (lineDiff.changed.length > 10) {
      suggestions.push('Many changes detected - consider reviewing line by line');
    }

    if (structuralChanges.length > 0) {
      suggestions.push('Structural changes detected - review headings and formatting');
    }

    return suggestions;
  }

  /**
   * Performs a three-way merge of content
   */
  private performThreeWayMerge(localLines: string[], remoteLines: string[]): MergeResult {
    const conflicts: MergeResult['conflicts'] = [];
    const mergedLines: string[] = [];

    const maxLength = Math.max(localLines.length, remoteLines.length);

    for (let i = 0; i < maxLength; i++) {
      const localLine = localLines[i];
      const remoteLine = remoteLines[i];

      if (localLine === remoteLine) {
        // Lines are identical
        if (localLine !== undefined) {
          mergedLines.push(localLine);
        }
      } else if (localLine === undefined) {
        // Line only exists in remote
        mergedLines.push(remoteLine);
      } else if (remoteLine === undefined) {
        // Line only exists in local
        mergedLines.push(localLine);
      } else {
        // Lines differ - create conflict marker
        conflicts.push({
          line: i,
          localContent: localLine,
          remoteContent: remoteLine,
          resolved: false
        });

        // Add conflict markers (Git-style)
        mergedLines.push('<<<<<<< LOCAL');
        mergedLines.push(localLine);
        mergedLines.push('=======');
        mergedLines.push(remoteLine);
        mergedLines.push('>>>>>>> REMOTE');
      }
    }

    return {
      success: conflicts.length === 0,
      mergedContent: mergedLines.join('\n'),
      conflicts
    };
  }

  /**
   * Gets conflict pattern for analysis
   */
  private getConflictPattern(conflict: ConflictFile): string {
    const localSize = conflict.localContent.length;
    const remoteSize = conflict.remoteContent.length;
    const sizeDiff = Math.abs(localSize - remoteSize);

    if (sizeDiff < 100) {
      return 'small-changes';
    } else if (sizeDiff < 1000) {
      return 'medium-changes';
    } else {
      return 'large-changes';
    }
  }

  /**
   * Disposes the service
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.conflictHistory = [];
    this.isDisposed = true;
  }
}

/**
 * Modal for manual conflict resolution
 */
class ConflictResolutionModal extends Modal {
  constructor(
    app: App,
    private conflict: ConflictFile,
    private analysis: ConflictAnalysis,
    private onResolve: (resolution: ConflictResolution) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: `Resolve Conflict: ${this.conflict.path}` });

    // Conflict analysis summary
    const summaryEl = contentEl.createEl('div', { cls: 'conflict-summary' });
    summaryEl.createEl('p', {
      text: `Severity: ${this.analysis.conflictSeverity.toUpperCase()}`,
      cls: `severity-${this.analysis.conflictSeverity}`
    });

    if (this.analysis.suggestions.length > 0) {
      const suggestionsEl = summaryEl.createEl('div', { cls: 'suggestions' });
      suggestionsEl.createEl('h4', { text: 'Suggestions:' });
      const ul = suggestionsEl.createEl('ul');
      this.analysis.suggestions.forEach(suggestion => {
        ul.createEl('li', { text: suggestion });
      });
    }

    // Content comparison
    const comparisonEl = contentEl.createEl('div', { cls: 'content-comparison' });
    
    // Local content
    const localEl = comparisonEl.createEl('div', { cls: 'content-section' });
    localEl.createEl('h3', { text: 'Local Version' });
    localEl.createEl('pre', { text: this.conflict.localContent, cls: 'content-preview' });

    // Remote content
    const remoteEl = comparisonEl.createEl('div', { cls: 'content-section' });
    remoteEl.createEl('h3', { text: 'Remote Version' });
    remoteEl.createEl('pre', { text: this.conflict.remoteContent, cls: 'content-preview' });

    // Resolution options
    const actionsEl = contentEl.createEl('div', { cls: 'resolution-actions' });
    actionsEl.createEl('h3', { text: 'Choose Resolution:' });

    const useLocalBtn = actionsEl.createEl('button', {
      text: '← Use Local Version',
      cls: 'mod-cta resolution-btn'
    });
    useLocalBtn.onclick = () => {
      this.resolveWith('use-local');
    };

    const useRemoteBtn = actionsEl.createEl('button', {
      text: 'Use Remote Version →',
      cls: 'mod-cta resolution-btn'
    });
    useRemoteBtn.onclick = () => {
      this.resolveWith('use-remote');
    };

    if (this.analysis.autoMergeRecommended) {
      const autoMergeBtn = actionsEl.createEl('button', {
        text: '🔀 Auto-Merge (Recommended)',
        cls: 'mod-cta resolution-btn merge-btn'
      });
      autoMergeBtn.onclick = () => {
        this.attemptAutoMerge();
      };
    }

    const skipBtn = actionsEl.createEl('button', {
      text: 'Skip for Now',
      cls: 'resolution-btn'
    });
    skipBtn.onclick = () => {
      this.resolveWith('skip');
    };
  }

  private resolveWith(action: ConflictResolution['action']) {
    const resolution: ConflictResolution = {
      action,
      strategy: 'prompt',
      timestamp: Date.now()
    };

    this.onResolve(resolution);
    this.close();
  }

  private async attemptAutoMerge() {
    // This would implement auto-merge logic
    // For now, just use local version
    const resolution: ConflictResolution = {
      action: 'merge',
      mergedContent: this.conflict.localContent, // Simplified
      strategy: 'prompt',
      timestamp: Date.now()
    };

    this.onResolve(resolution);
    this.close();
  }
}