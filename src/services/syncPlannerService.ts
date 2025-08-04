/**
 * Intelligent Sync Planning Service
 * 
 * Provides comprehensive sync planning with risk assessment,
 * conflict prediction, and optimization recommendations
 */

import { DisposableService } from '../core/container';
import { Logger } from '../utils/logger';
import { SyncFile, ConflictFile } from '../types';

export interface SyncPlan {
  id: string;
  timestamp: number;
  totalFiles: number;
  estimatedDuration: number;
  estimatedDataUsage: number;
  riskAssessment: RiskAssessment;
  operations: SyncOperation[];
  recommendations: SyncRecommendation[];
  conflicts: PredictedConflict[];
  optimizations: SyncOptimization[];
}

export interface SyncOperation {
  id: string;
  type: 'upload' | 'download' | 'delete' | 'merge';
  file: SyncFile;
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedTime: number;
  estimatedSize: number;
  dependencies: string[];
  risks: OperationRisk[];
}

export interface RiskAssessment {
  overall: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactor[];
  score: number; // 0-100
  recommendations: string[];
  canProceed: boolean;
  requiresConfirmation: boolean;
}

export interface RiskFactor {
  type: 'size' | 'conflicts' | 'network' | 'battery' | 'storage' | 'history' | 'complexity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  impact: string;
  mitigation?: string;
  weight: number;
}

export interface PredictedConflict {
  file: SyncFile;
  probability: number; // 0-1
  reasons: string[];
  suggestedResolution: 'local' | 'remote' | 'merge' | 'manual';
  confidence: number; // 0-1
}

export interface SyncRecommendation {
  type: 'optimization' | 'timing' | 'strategy' | 'preparation';
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  action?: () => Promise<void>;
  impact: string;
}

export interface SyncOptimization {
  type: 'batching' | 'compression' | 'ordering' | 'parallelization' | 'caching';
  description: string;
  estimatedImprovement: {
    time?: number; // percentage
    data?: number; // percentage
    battery?: number; // percentage
  };
  complexity: 'low' | 'medium' | 'high';
}

export interface OperationRisk {
  type: 'data_loss' | 'corruption' | 'conflict' | 'timeout' | 'quota' | 'permission';
  probability: number; // 0-1
  impact: string;
  mitigation: string;
}

export interface SyncContext {
  networkType: 'wifi' | 'cellular' | 'offline';
  batteryLevel: number;
  storageAvailable: number;
  lastSyncTime?: Date;
  conflictHistory: ConflictFile[];
  syncPatterns: SyncPattern[];
  userPreferences: SyncPreferences;
}

export interface SyncPattern {
  filePattern: string;
  frequency: number;
  averageSize: number;
  conflictRate: number;
  lastModified: Date;
}

export interface SyncPreferences {
  preferWiFi: boolean;
  batteryThreshold: number;
  maxFileSize: number;
  autoResolveConflicts: boolean;
  backupBeforeSync: boolean;
  parallelOperations: number;
}

export class SyncPlannerService extends DisposableService {
  private syncHistory: SyncPlan[] = [];
  private conflictPatterns = new Map<string, number>();
  private performanceMetrics = new Map<string, number[]>();

  constructor(
    private logger: Logger,
    private mobileOptimizer?: any // MobileOptimizerService reference
  ) {
    super();
    this.loadHistoryData();
  }

  /**
   * Creates a comprehensive sync plan with risk assessment
   */
  async createSyncPlan(
    localFiles: Map<string, SyncFile>,
    remoteFiles: Map<string, SyncFile>,
    context: SyncContext
  ): Promise<SyncPlan> {
    this.checkDisposed();

    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.logger.info('Creating sync plan', {
      component: 'SyncPlannerService',
      planId,
      localFiles: localFiles.size,
      remoteFiles: remoteFiles.size
    });

    // Analyze file differences
    const operations = await this.analyzeOperations(localFiles, remoteFiles, context);
    
    // Predict conflicts
    const conflicts = await this.predictConflicts(operations, context);
    
    // Assess risks
    const riskAssessment = this.assessRisks(operations, conflicts, context);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(operations, riskAssessment, context);
    
    // Identify optimizations
    const optimizations = this.identifyOptimizations(operations, context);
    
    // Calculate estimates
    const estimates = this.calculateEstimates(operations, context);

    const plan: SyncPlan = {
      id: planId,
      timestamp: Date.now(),
      totalFiles: operations.length,
      estimatedDuration: estimates.duration,
      estimatedDataUsage: estimates.dataUsage,
      riskAssessment,
      operations,
      recommendations,
      conflicts,
      optimizations
    };

    // Store plan in history
    this.syncHistory.push(plan);
    this.pruneHistory();

    this.logger.debug('Sync plan created', {
      component: 'SyncPlannerService',
      planId,
      riskLevel: riskAssessment.overall,
      operations: operations.length,
      conflicts: conflicts.length,
      recommendations: recommendations.length
    });

    return plan;
  }

  /**
   * Validates a sync plan before execution
   */
  async validateSyncPlan(plan: SyncPlan, currentContext: SyncContext): Promise<{
    valid: boolean;
    issues: string[];
    updatedPlan?: SyncPlan;
  }> {
    const issues: string[] = [];
    
    // Check if conditions have changed significantly
    if (currentContext.batteryLevel < currentContext.userPreferences.batteryThreshold) {
      issues.push('Battery level below threshold');
    }
    
    if (currentContext.networkType === 'offline') {
      issues.push('Network connection unavailable');
    }
    
    if (currentContext.storageAvailable < plan.estimatedDataUsage * 1.2) {
      issues.push('Insufficient storage space');
    }
    
    // Check for plan staleness
    const planAge = Date.now() - plan.timestamp;
    if (planAge > 5 * 60 * 1000) { // 5 minutes
      issues.push('Plan is stale and should be regenerated');
    }
    
    // Validate operations
    for (const operation of plan.operations) {
      if (operation.risks.some(risk => risk.probability > 0.8 && risk.type === 'data_loss')) {
        issues.push(`High data loss risk for ${operation.file.path}`);
      }
    }
    
    const valid = issues.length === 0;
    
    this.logger.debug('Sync plan validation', {
      component: 'SyncPlannerService',
      planId: plan.id,
      valid,
      issues: issues.length
    });
    
    return { valid, issues };
  }

  /**
   * Optimizes the execution order of sync operations
   */
  optimizeExecutionOrder(operations: SyncOperation[]): SyncOperation[] {
    // Sort by priority, dependencies, and risk
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    
    return operations.sort((a, b) => {
      // Primary: Priority
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Secondary: Dependencies (operations with no dependencies first)
      const depDiff = a.dependencies.length - b.dependencies.length;
      if (depDiff !== 0) return depDiff;
      
      // Tertiary: Risk (lower risk first)
      const riskA = a.risks.reduce((sum, risk) => sum + risk.probability, 0);
      const riskB = b.risks.reduce((sum, risk) => sum + risk.probability, 0);
      const riskDiff = riskA - riskB;
      if (riskDiff !== 0) return riskDiff;
      
      // Quaternary: Size (smaller files first for quick wins)
      return a.estimatedSize - b.estimatedSize;
    });
  }

  /**
   * Gets sync planning statistics
   */
  getPlanningStatistics(): {
    totalPlans: number;
    averageRiskScore: number;
    commonRiskFactors: Array<{ type: string; frequency: number }>;
    successRate: number;
    averageDuration: number;
    conflictPredictionAccuracy: number;
  } {
    const totalPlans = this.syncHistory.length;
    
    if (totalPlans === 0) {
      return {
        totalPlans: 0,
        averageRiskScore: 0,
        commonRiskFactors: [],
        successRate: 0,
        averageDuration: 0,
        conflictPredictionAccuracy: 0
      };
    }
    
    const avgRiskScore = this.syncHistory.reduce((sum, plan) => 
      sum + plan.riskAssessment.score, 0) / totalPlans;
    
    const riskFactorCounts = new Map<string, number>();
    this.syncHistory.forEach(plan => {
      plan.riskAssessment.factors.forEach(factor => {
        riskFactorCounts.set(factor.type, (riskFactorCounts.get(factor.type) || 0) + 1);
      });
    });
    
    const commonRiskFactors = Array.from(riskFactorCounts.entries())
      .map(([type, frequency]) => ({ type, frequency: frequency / totalPlans }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);
    
    const avgDuration = this.syncHistory.reduce((sum, plan) => 
      sum + plan.estimatedDuration, 0) / totalPlans;
    
    return {
      totalPlans,
      averageRiskScore: avgRiskScore,
      commonRiskFactors,
      successRate: 0.85, // Would be calculated from actual execution results
      averageDuration: avgDuration,
      conflictPredictionAccuracy: 0.78 // Would be calculated from conflict outcomes
    };
  }

  /**
   * Analyzes operations needed for sync
   */
  private async analyzeOperations(
    localFiles: Map<string, SyncFile>,
    remoteFiles: Map<string, SyncFile>,
    context: SyncContext
  ): Promise<SyncOperation[]> {
    const operations: SyncOperation[] = [];
    const allPaths = new Set([...localFiles.keys(), ...remoteFiles.keys()]);

    for (const path of allPaths) {
      const localFile = localFiles.get(path);
      const remoteFile = remoteFiles.get(path);
      
      const operation = this.determineOperation(localFile, remoteFile, path, context);
      if (operation) {
        operations.push(operation);
      }
    }

    return operations;
  }

  /**
   * Determines the sync operation for a file
   */
  private determineOperation(
    localFile: SyncFile | undefined,
    remoteFile: SyncFile | undefined,
    path: string,
    context: SyncContext
  ): SyncOperation | null {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (!localFile && remoteFile) {
      // Download remote file
      return {
        id: operationId,
        type: 'download',
        file: remoteFile,
        priority: this.calculatePriority(remoteFile, 'download', context),
        estimatedTime: this.estimateOperationTime(remoteFile, 'download', context),
        estimatedSize: remoteFile.size,
        dependencies: [],
        risks: this.assessOperationRisks(remoteFile, 'download', context)
      };
    }
    
    if (localFile && !remoteFile) {
      // Upload local file
      return {
        id: operationId,
        type: 'upload',
        file: localFile,
        priority: this.calculatePriority(localFile, 'upload', context),
        estimatedTime: this.estimateOperationTime(localFile, 'upload', context),
        estimatedSize: localFile.size,
        dependencies: [],
        risks: this.assessOperationRisks(localFile, 'upload', context)
      };
    }
    
    if (localFile && remoteFile) {
      // Compare and determine action
      if (localFile.hash !== remoteFile.hash) {
        const operation = this.resolveFileConflict(localFile, remoteFile, context);
        return {
          id: operationId,
          ...operation,
          estimatedTime: this.estimateOperationTime(operation.file, operation.type, context),
          estimatedSize: operation.file.size,
          dependencies: [],
          risks: this.assessOperationRisks(operation.file, operation.type, context)
        };
      }
    }
    
    return null;
  }

  /**
   * Resolves file conflicts based on modification time and user preferences
   */
  private resolveFileConflict(
    localFile: SyncFile,
    remoteFile: SyncFile,
    context: SyncContext
  ): Pick<SyncOperation, 'type' | 'file' | 'priority'> {
    // Simple resolution based on modification time
    const localNewer = localFile.mtime > remoteFile.mtime;
    
    if (context.userPreferences.autoResolveConflicts) {
      return {
        type: localNewer ? 'upload' : 'download',
        file: localNewer ? localFile : remoteFile,
        priority: 'high'
      };
    }
    
    return {
      type: 'merge',
      file: localFile, // Will need both files for merging
      priority: 'critical'
    };
  }

  /**
   * Predicts potential conflicts
   */
  private async predictConflicts(
    operations: SyncOperation[],
    context: SyncContext
  ): Promise<PredictedConflict[]> {
    const conflicts: PredictedConflict[] = [];
    
    for (const operation of operations) {
      const conflictProb = this.calculateConflictProbability(operation, context);
      
      if (conflictProb > 0.3) { // Threshold for significant conflict risk
        conflicts.push({
          file: operation.file,
          probability: conflictProb,
          reasons: this.getConflictReasons(operation, context),
          suggestedResolution: this.suggestConflictResolution(operation, context),
          confidence: this.calculatePredictionConfidence(operation, context)
        });
      }
    }
    
    return conflicts;
  }

  /**
   * Calculates conflict probability for an operation
   */
  private calculateConflictProbability(operation: SyncOperation, context: SyncContext): number {
    let probability = 0;
    
    // Historical conflict rate for this file pattern
    const pattern = this.getFilePattern(operation.file.path);
    const historicalRate = this.conflictPatterns.get(pattern) || 0.1;
    probability += historicalRate * 0.4;
    
    // File modification frequency
    if (operation.file.mtime && Date.now() - operation.file.mtime < 24 * 60 * 60 * 1000) {
      probability += 0.3; // Recently modified files are more likely to conflict
    }
    
    // File size (larger files have higher conflict probability)
    if (operation.file.size > 10 * 1024 * 1024) { // 10MB
      probability += 0.2;
    }
    
    // Network conditions
    if (context.networkType === 'cellular') {
      probability += 0.1; // Higher chance of interruption
    }
    
    return Math.min(probability, 1);
  }

  /**
   * Gets reasons for potential conflicts
   */
  private getConflictReasons(operation: SyncOperation, context: SyncContext): string[] {
    const reasons: string[] = [];
    
    if (operation.file.mtime && Date.now() - operation.file.mtime < 60 * 60 * 1000) {
      reasons.push('File recently modified');
    }
    
    if (operation.file.size > 50 * 1024 * 1024) { // 50MB
      reasons.push('Large file size increases sync complexity');
    }
    
    const pattern = this.getFilePattern(operation.file.path);
    if (this.conflictPatterns.get(pattern) && this.conflictPatterns.get(pattern)! > 0.5) {
      reasons.push('File type has high historical conflict rate');
    }
    
    if (context.networkType !== 'wifi') {
      reasons.push('Unstable network connection');
    }
    
    return reasons;
  }

  /**
   * Suggests conflict resolution strategy
   */
  private suggestConflictResolution(
    operation: SyncOperation,
    context: SyncContext
  ): 'local' | 'remote' | 'merge' | 'manual' {
    if (context.userPreferences.autoResolveConflicts) {
      return operation.file.mtime > Date.now() - 24 * 60 * 60 * 1000 ? 'local' : 'remote';
    }
    
    if (operation.file.path.endsWith('.md') || operation.file.path.endsWith('.txt')) {
      return 'merge'; // Text files can often be merged
    }
    
    return 'manual';
  }

  /**
   * Calculates prediction confidence
   */
  private calculatePredictionConfidence(operation: SyncOperation, context: SyncContext): number {
    let confidence = 0.5; // Base confidence
    
    const pattern = this.getFilePattern(operation.file.path);
    const historicalData = this.conflictPatterns.get(pattern);
    
    if (historicalData !== undefined) {
      confidence += 0.3; // Have historical data
    }
    
    if (context.syncPatterns.some(p => p.filePattern === pattern)) {
      confidence += 0.2; // Have sync patterns
    }
    
    return Math.min(confidence, 1);
  }

  /**
   * Assesses risks for the entire sync operation
   */
  private assessRisks(
    operations: SyncOperation[],
    conflicts: PredictedConflict[],
    context: SyncContext
  ): RiskAssessment {
    const factors: RiskFactor[] = [];
    
    // Data size risk
    const totalSize = operations.reduce((sum, op) => sum + op.estimatedSize, 0);
    if (totalSize > 100 * 1024 * 1024) { // 100MB
      factors.push({
        type: 'size',
        severity: totalSize > 500 * 1024 * 1024 ? 'critical' : 'medium',
        description: 'Large data transfer',
        impact: 'Increased time, data usage, and failure risk',
        mitigation: 'Consider syncing in smaller batches',
        weight: 0.3
      });
    }
    
    // Conflict risk
    if (conflicts.length > 0) {
      const avgProbability = conflicts.reduce((sum, c) => sum + c.probability, 0) / conflicts.length;
      factors.push({
        type: 'conflicts',
        severity: avgProbability > 0.7 ? 'high' : 'medium',
        description: `${conflicts.length} potential conflicts detected`,
        impact: 'Manual intervention may be required',
        mitigation: 'Review conflicts before proceeding',
        weight: 0.4
      });
    }
    
    // Network risk
    if (context.networkType === 'cellular') {
      factors.push({
        type: 'network',
        severity: 'medium',
        description: 'Using cellular network',
        impact: 'Higher cost and interruption risk',
        mitigation: 'Wait for Wi-Fi connection',
        weight: 0.2
      });
    }
    
    // Battery risk
    if (context.batteryLevel < 0.3) {
      factors.push({
        type: 'battery',
        severity: context.batteryLevel < 0.1 ? 'critical' : 'medium',
        description: 'Low battery level',
        impact: 'Sync may be interrupted',
        mitigation: 'Connect to power source',
        weight: 0.3
      });
    }
    
    // Storage risk
    const requiredSpace = totalSize * 1.5; // Buffer for temporary files
    if (requiredSpace > context.storageAvailable) {
      factors.push({
        type: 'storage',
        severity: 'critical',
        description: 'Insufficient storage space',
        impact: 'Sync will fail',
        mitigation: 'Free up storage space',
        weight: 0.5
      });
    }
    
    // Calculate overall risk score
    const score = this.calculateRiskScore(factors);
    const overall = this.determineOverallRisk(score);
    
    return {
      overall,
      factors,
      score,
      recommendations: factors.filter(f => f.mitigation).map(f => f.mitigation!),
      canProceed: overall !== 'critical' && !factors.some(f => f.type === 'storage' && f.severity === 'critical'),
      requiresConfirmation: overall === 'high' || conflicts.length > 5
    };
  }

  /**
   * Calculates weighted risk score
   */
  private calculateRiskScore(factors: RiskFactor[]): number {
    if (factors.length === 0) return 0;
    
    const severityScores = { low: 25, medium: 50, high: 75, critical: 100 };
    
    const weightedScore = factors.reduce((sum, factor) => {
      return sum + (severityScores[factor.severity] * factor.weight);
    }, 0);
    
    const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
    
    return totalWeight > 0 ? Math.min(weightedScore / totalWeight, 100) : 0;
  }

  /**
   * Determines overall risk level from score
   */
  private determineOverallRisk(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }

  /**
   * Generates sync recommendations
   */
  private generateRecommendations(
    operations: SyncOperation[],
    riskAssessment: RiskAssessment,
    context: SyncContext
  ): SyncRecommendation[] {
    const recommendations: SyncRecommendation[] = [];
    
    // Network recommendations
    if (context.networkType === 'cellular' && operations.some(op => op.estimatedSize > 10 * 1024 * 1024)) {
      recommendations.push({
        type: 'timing',
        priority: 'high',
        title: 'Wait for Wi-Fi',
        description: 'Large files detected. Consider waiting for a Wi-Fi connection to avoid cellular data charges.',
        impact: 'Reduced data costs and better reliability'
      });
    }
    
    // Battery recommendations
    if (context.batteryLevel < 0.3) {
      recommendations.push({
        type: 'preparation',
        priority: 'medium',
        title: 'Connect to Power',
        description: 'Low battery detected. Connect to a power source before starting sync.',
        impact: 'Prevents sync interruption due to battery depletion'
      });
    }
    
    // Optimization recommendations
    if (operations.length > 50) {
      recommendations.push({
        type: 'optimization',
        priority: 'medium',
        title: 'Batch Processing',
        description: 'Many files to sync. Consider processing in smaller batches for better reliability.',
        impact: 'Improved success rate and easier error recovery'
      });
    }
    
    // Conflict recommendations
    if (riskAssessment.factors.some(f => f.type === 'conflicts' && f.severity === 'high')) {
      recommendations.push({
        type: 'strategy',
        priority: 'high',
        title: 'Review Conflicts',
        description: 'High conflict probability detected. Review potentially conflicting files before proceeding.',
        impact: 'Reduced manual intervention during sync'
      });
    }
    
    return recommendations;
  }

  /**
   * Identifies optimization opportunities
   */
  private identifyOptimizations(
    operations: SyncOperation[],
    context: SyncContext
  ): SyncOptimization[] {
    const optimizations: SyncOptimization[] = [];
    
    // Batching optimization
    if (operations.length > 20) {
      optimizations.push({
        type: 'batching',
        description: 'Group small files together for more efficient processing',
        estimatedImprovement: { time: 15, data: 5 },
        complexity: 'low'
      });
    }
    
    // Compression optimization
    const compressibleFiles = operations.filter(op => 
      op.file.path.endsWith('.md') || op.file.path.endsWith('.txt') ||
      op.file.path.endsWith('.json') || op.file.path.endsWith('.js')
    );
    
    if (compressibleFiles.length > 0) {
      optimizations.push({
        type: 'compression',
        description: 'Compress text files to reduce transfer size',
        estimatedImprovement: { data: 30, time: 10 },
        complexity: 'medium'
      });
    }
    
    // Parallelization optimization
    if (operations.length > 10 && context.networkType === 'wifi') {
      optimizations.push({
        type: 'parallelization',
        description: 'Process multiple files simultaneously on fast connections',
        estimatedImprovement: { time: 40 },
        complexity: 'high'
      });
    }
    
    return optimizations;
  }

  /**
   * Calculates time and data estimates
   */
  private calculateEstimates(
    operations: SyncOperation[],
    context: SyncContext
  ): { duration: number; dataUsage: number } {
    const totalSize = operations.reduce((sum, op) => sum + op.estimatedSize, 0);
    const totalTime = operations.reduce((sum, op) => sum + op.estimatedTime, 0);
    
    // Add overhead for HTTP requests, processing, etc.
    const duration = Math.ceil(totalTime * 1.2); // 20% overhead
    const dataUsage = Math.ceil(totalSize * 1.1); // 10% overhead for headers, retries
    
    return { duration, dataUsage };
  }

  /**
   * Helper methods
   */
  private calculatePriority(
    file: SyncFile,
    operation: 'upload' | 'download' | 'delete' | 'merge',
    context: SyncContext
  ): 'critical' | 'high' | 'medium' | 'low' {
    if (operation === 'merge') return 'critical';
    
    const isRecent = file.mtime && Date.now() - file.mtime < 24 * 60 * 60 * 1000;
    const isImportant = file.path.includes('important') || file.path.endsWith('.md');
    
    if (isRecent && isImportant) return 'high';
    if (isRecent || isImportant) return 'medium';
    return 'low';
  }

  private estimateOperationTime(
    file: SyncFile,
    operation: 'upload' | 'download' | 'delete' | 'merge',
    context: SyncContext
  ): number {
    const baseTime = 1000; // 1 second base
    const sizeMultiplier = file.size / (1024 * 1024); // Per MB
    
    let networkMultiplier = 1;
    if (context.networkType === 'cellular') networkMultiplier = 2;
    
    return Math.ceil(baseTime + (sizeMultiplier * 2000 * networkMultiplier));
  }

  private assessOperationRisks(
    file: SyncFile,
    operation: 'upload' | 'download' | 'delete' | 'merge',
    context: SyncContext
  ): OperationRisk[] {
    const risks: OperationRisk[] = [];
    
    if (file.size > 100 * 1024 * 1024) { // 100MB
      risks.push({
        type: 'timeout',
        probability: 0.3,
        impact: 'Operation may timeout on large files',
        mitigation: 'Implement resumable transfers'
      });
    }
    
    if (operation === 'merge') {
      risks.push({
        type: 'corruption',
        probability: 0.1,
        impact: 'Manual merge may introduce errors',
        mitigation: 'Create backup before merging'
      });
    }
    
    return risks;
  }

  private getFilePattern(path: string): string {
    const extension = path.split('.').pop() || 'unknown';
    const isInFolder = path.includes('/');
    return `${extension}_${isInFolder ? 'folder' : 'root'}`;
  }

  private loadHistoryData(): void {
    try {
      const stored = localStorage.getItem('obsidian-git-sync-planner-history');
      if (stored) {
        const data = JSON.parse(stored);
        this.syncHistory = data.history || [];
        this.conflictPatterns = new Map(data.conflictPatterns || []);
        this.performanceMetrics = new Map(data.performanceMetrics || []);
      }
    } catch (error) {
      this.logger.error('Failed to load planner history', { error });
    }
  }

  private pruneHistory(): void {
    // Keep only last 100 plans
    if (this.syncHistory.length > 100) {
      this.syncHistory = this.syncHistory.slice(-100);
    }
    
    // Save to storage
    try {
      const data = {
        history: this.syncHistory,
        conflictPatterns: Array.from(this.conflictPatterns.entries()),
        performanceMetrics: Array.from(this.performanceMetrics.entries())
      };
      localStorage.setItem('obsidian-git-sync-planner-history', JSON.stringify(data));
    } catch (error) {
      this.logger.error('Failed to save planner history', { error });
    }
  }

  /**
   * Disposes the sync planner service
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.pruneHistory(); // Save final state
    this.syncHistory = [];
    this.conflictPatterns.clear();
    this.performanceMetrics.clear();
    
    this.isDisposed = true;
  }
}