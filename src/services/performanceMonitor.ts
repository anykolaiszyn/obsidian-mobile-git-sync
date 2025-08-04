/**
 * Performance Monitoring Service
 * 
 * Provides comprehensive performance tracking, metrics collection,
 * and optimization recommendations for the sync system
 */

import { DisposableService } from '../core/container';
import { Logger } from '../utils/logger';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  category: 'latency' | 'throughput' | 'memory' | 'cpu' | 'network' | 'user';
  metadata?: Record<string, any>;
}

export interface PerformanceMark {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export interface PerformanceReport {
  timeRange: { start: number; end: number };
  summary: {
    avgLatency: number;
    totalOperations: number;
    successRate: number;
    peakMemoryUsage: number;
    avgThroughput: number;
  };
  metrics: PerformanceMetric[];
  trends: PerformanceTrend[];
  recommendations: PerformanceRecommendation[];
  alerts: PerformanceAlert[];
}

export interface PerformanceTrend {
  metric: string;
  direction: 'improving' | 'degrading' | 'stable';
  changePercent: number;
  confidence: number;
  timeWindow: number;
}

export interface PerformanceRecommendation {
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  action?: () => Promise<void>;
}

export interface PerformanceAlert {
  id: string;
  level: 'warning' | 'critical';
  metric: string;
  threshold: number;
  currentValue: number;
  message: string;
  timestamp: number;
  resolved: boolean;
}

export interface PerformanceThresholds {
  latency: { warning: number; critical: number };
  memory: { warning: number; critical: number };
  cpu: { warning: number; critical: number };
  successRate: { warning: number; critical: number };
  throughput: { warning: number; critical: number };
}

export class PerformanceMonitor extends DisposableService {
  private metrics: PerformanceMetric[] = [];
  private marks = new Map<string, PerformanceMark>();
  private activeOperations = new Map<string, number>();
  private alerts: PerformanceAlert[] = [];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private performanceObserver: PerformanceObserver | null = null;

  private readonly thresholds: PerformanceThresholds = {
    latency: { warning: 5000, critical: 10000 },        // ms
    memory: { warning: 80, critical: 95 },              // percentage
    cpu: { warning: 70, critical: 90 },                 // percentage
    successRate: { warning: 95, critical: 85 },         // percentage
    throughput: { warning: 100, critical: 50 }          // operations/min
  };

  private readonly maxMetrics = 10000;
  private readonly cleanupInterval = 5 * 60 * 1000; // 5 minutes

  constructor(private logger: Logger) {
    super();
    this.initialize();
  }

  /**
   * Records a performance metric
   */
  recordMetric(
    name: string,
    value: number,
    unit: string,
    category: PerformanceMetric['category'],
    metadata?: Record<string, any>
  ): void {
    this.checkDisposed();

    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      category,
      metadata
    };

    this.metrics.push(metric);
    this.checkThresholds(metric);
    
    // Limit metrics storage
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    this.logger.debug('Performance metric recorded', {
      component: 'PerformanceMonitor',
      metric: { name, value, unit, category }
    });
  }

  /**
   * Starts a performance measurement
   */
  startMeasurement(name: string, metadata?: Record<string, any>): string {
    const markId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const mark: PerformanceMark = {
      name,
      startTime: performance.now(),
      metadata
    };

    this.marks.set(markId, mark);
    this.activeOperations.set(name, (this.activeOperations.get(name) || 0) + 1);

    // Use Performance API if available
    if ('performance' in window && 'mark' in performance) {
      try {
        performance.mark(`${markId}_start`);
      } catch (error) {
        // Ignore performance API errors
      }
    }

    return markId;
  }

  /**
   * Ends a performance measurement
   */
  endMeasurement(markId: string, metadata?: Record<string, any>): number | null {
    const mark = this.marks.get(markId);
    if (!mark) {
      this.logger.warn('Performance mark not found', {
        component: 'PerformanceMonitor',
        markId
      });
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - mark.startTime;

    mark.endTime = endTime;
    mark.duration = duration;
    if (metadata) {
      mark.metadata = { ...mark.metadata, ...metadata };
    }

    // Record as metric
    this.recordMetric(
      mark.name,
      duration,
      'ms',
      'latency',
      { ...mark.metadata, markId }
    );

    // Update active operations
    const currentCount = this.activeOperations.get(mark.name) || 0;
    if (currentCount <= 1) {
      this.activeOperations.delete(mark.name);
    } else {
      this.activeOperations.set(mark.name, currentCount - 1);
    }

    // Use Performance API if available
    if ('performance' in window && 'measure' in performance) {
      try {
        performance.mark(`${markId}_end`);
        performance.measure(markId, `${markId}_start`, `${markId}_end`);
      } catch (error) {
        // Ignore performance API errors
      }
    }

    this.marks.delete(markId);

    this.logger.debug('Performance measurement completed', {
      component: 'PerformanceMonitor',
      name: mark.name,
      duration,
      markId
    });

    return duration;
  }

  /**
   * Measures the execution time of an async function
   */
  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<{ result: T; duration: number }> {
    const markId = this.startMeasurement(name, metadata);
    
    try {
      const result = await fn();
      const duration = this.endMeasurement(markId, { success: true }) || 0;
      return { result, duration };
    } catch (error) {
      const duration = this.endMeasurement(markId, { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      }) || 0;
      throw error;
    }
  }

  /**
   * Measures the execution time of a sync function
   */
  measureSync<T>(
    name: string,
    fn: () => T,
    metadata?: Record<string, any>
  ): { result: T; duration: number } {
    const markId = this.startMeasurement(name, metadata);
    
    try {
      const result = fn();
      const duration = this.endMeasurement(markId, { success: true }) || 0;
      return { result, duration };
    } catch (error) {
      const duration = this.endMeasurement(markId, { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      }) || 0;
      throw error;
    }
  }

  /**
   * Records resource usage metrics
   */
  recordResourceUsage(): void {
    try {
      // Memory usage
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        this.recordMetric('jsHeapUsed', memory.usedJSHeapSize, 'bytes', 'memory');
        this.recordMetric('jsHeapTotal', memory.totalJSHeapSize, 'bytes', 'memory');
        this.recordMetric('jsHeapLimit', memory.jsHeapSizeLimit, 'bytes', 'memory');
        
        const memoryPercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
        this.recordMetric('memoryUsagePercent', memoryPercent, '%', 'memory');
      }

      // Connection information
      if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        this.recordMetric('networkDownlink', connection.downlink || 0, 'Mbps', 'network');
        this.recordMetric('networkRTT', connection.rtt || 0, 'ms', 'network');
        this.recordMetric('networkEffectiveType', this.mapNetworkType(connection.effectiveType), 'score', 'network');
      }

      // Battery information
      if ('getBattery' in navigator) {
        (navigator as any).getBattery().then((battery: any) => {
          this.recordMetric('batteryLevel', battery.level * 100, '%', 'user');
          this.recordMetric('batteryCharging', battery.charging ? 1 : 0, 'boolean', 'user');
        }).catch(() => {
          // Ignore battery API errors
        });
      }

      // Storage quota
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        navigator.storage.estimate().then(estimate => {
          if (estimate.quota && estimate.usage) {
            const storagePercent = (estimate.usage / estimate.quota) * 100;
            this.recordMetric('storageUsed', estimate.usage, 'bytes', 'user');
            this.recordMetric('storageQuota', estimate.quota, 'bytes', 'user');
            this.recordMetric('storageUsagePercent', storagePercent, '%', 'user');
          }
        }).catch(() => {
          // Ignore storage API errors
        });
      }

    } catch (error) {
      this.logger.debug('Resource usage recording failed', { error });
    }
  }

  /**
   * Generates a comprehensive performance report
   */
  generateReport(timeRange?: { start: number; end: number }): PerformanceReport {
    const end = timeRange?.end || Date.now();
    const start = timeRange?.start || (end - 24 * 60 * 60 * 1000); // 24 hours ago

    const relevantMetrics = this.metrics.filter(m => 
      m.timestamp >= start && m.timestamp <= end
    );

    const summary = this.calculateSummary(relevantMetrics);
    const trends = this.analyzeTrends(relevantMetrics);
    const recommendations = this.generateRecommendations(relevantMetrics, trends);
    const activeAlerts = this.alerts.filter(a => !a.resolved);

    return {
      timeRange: { start, end },
      summary,
      metrics: relevantMetrics,
      trends,
      recommendations,
      alerts: activeAlerts
    };
  }

  /**
   * Gets current performance statistics
   */
  getCurrentStats(): {
    activeOperations: number;
    totalMetrics: number;
    activeAlerts: number;
    averageLatency: number;
    memoryUsage: number;
    successRate: number;
  } {
    const recentMetrics = this.metrics.filter(m => 
      Date.now() - m.timestamp < 5 * 60 * 1000 // Last 5 minutes
    );

    const latencyMetrics = recentMetrics.filter(m => m.category === 'latency');
    const memoryMetrics = recentMetrics.filter(m => m.name === 'memoryUsagePercent');
    const successMetrics = recentMetrics.filter(m => m.name.includes('success'));

    return {
      activeOperations: Array.from(this.activeOperations.values()).reduce((sum, count) => sum + count, 0),
      totalMetrics: this.metrics.length,
      activeAlerts: this.alerts.filter(a => !a.resolved).length,
      averageLatency: this.calculateAverage(latencyMetrics.map(m => m.value)),
      memoryUsage: memoryMetrics.length > 0 ? memoryMetrics[memoryMetrics.length - 1].value : 0,
      successRate: this.calculateSuccessRate(successMetrics)
    };
  }

  /**
   * Clears old metrics and alerts
   */
  cleanup(): void {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
    
    const initialMetricCount = this.metrics.length;
    this.metrics = this.metrics.filter(m => m.timestamp > cutoff);
    
    const initialAlertCount = this.alerts.length;
    this.alerts = this.alerts.filter(a => a.timestamp > cutoff);

    // Clear old marks
    for (const [markId, mark] of this.marks) {
      if (mark.startTime < cutoff) {
        this.marks.delete(markId);
      }
    }

    this.logger.info('Performance data cleanup completed', {
      component: 'PerformanceMonitor',
      metricsRemoved: initialMetricCount - this.metrics.length,
      alertsRemoved: initialAlertCount - this.alerts.length
    });
  }

  /**
   * Private methods
   */
  private initialize(): void {
    this.setupPerformanceObserver();
    this.startResourceMonitoring();
    this.scheduleCleanup();

    this.logger.info('Performance monitor initialized', {
      component: 'PerformanceMonitor',
      thresholds: this.thresholds
    });
  }

  private setupPerformanceObserver(): void {
    if ('PerformanceObserver' in window) {
      try {
        this.performanceObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          
          for (const entry of entries) {
            if (entry.entryType === 'measure') {
              this.recordMetric(
                entry.name,
                entry.duration,
                'ms',
                'latency',
                { entryType: entry.entryType }
              );
            } else if (entry.entryType === 'navigation') {
              const navEntry = entry as PerformanceNavigationTiming;
              const navigationStart = (navEntry as any).navigationStart || navEntry.startTime;
              this.recordMetric('pageLoadTime', navEntry.loadEventEnd - navigationStart, 'ms', 'user');
              this.recordMetric('domContentLoaded', navEntry.domContentLoadedEventEnd - navigationStart, 'ms', 'user');
            }
          }
        });

        this.performanceObserver.observe({ 
          entryTypes: ['measure', 'navigation', 'resource'] 
        });

      } catch (error) {
        this.logger.debug('Performance Observer setup failed', { error });
      }
    }
  }

  private startResourceMonitoring(): void {
    // Record initial resource usage
    this.recordResourceUsage();

    // Monitor resources periodically
    this.monitoringInterval = setInterval(() => {
      this.recordResourceUsage();
    }, 30000); // Every 30 seconds
  }

  private scheduleCleanup(): void {
    setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  private checkThresholds(metric: PerformanceMetric): void {
    const alerts: PerformanceAlert[] = [];

    // Check latency thresholds
    if (metric.category === 'latency') {
      if (metric.value > this.thresholds.latency.critical) {
        alerts.push(this.createAlert('critical', metric.name, metric.value, this.thresholds.latency.critical, 
          `Critical latency detected: ${metric.value}ms`));
      } else if (metric.value > this.thresholds.latency.warning) {
        alerts.push(this.createAlert('warning', metric.name, metric.value, this.thresholds.latency.warning,
          `High latency detected: ${metric.value}ms`));
      }
    }

    // Check memory thresholds
    if (metric.name === 'memoryUsagePercent') {
      if (metric.value > this.thresholds.memory.critical) {
        alerts.push(this.createAlert('critical', metric.name, metric.value, this.thresholds.memory.critical,
          `Critical memory usage: ${metric.value.toFixed(1)}%`));
      } else if (metric.value > this.thresholds.memory.warning) {
        alerts.push(this.createAlert('warning', metric.name, metric.value, this.thresholds.memory.warning,
          `High memory usage: ${metric.value.toFixed(1)}%`));
      }
    }

    // Add alerts
    alerts.forEach(alert => {
      this.alerts.push(alert);
      this.logger.warn('Performance alert triggered', {
        component: 'PerformanceMonitor',
        alert
      });
    });
  }

  private createAlert(
    level: 'warning' | 'critical',
    metric: string,
    currentValue: number,
    threshold: number,
    message: string
  ): PerformanceAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      level,
      metric,
      threshold,
      currentValue,
      message,
      timestamp: Date.now(),
      resolved: false
    };
  }

  private calculateSummary(metrics: PerformanceMetric[]): PerformanceReport['summary'] {
    const latencyMetrics = metrics.filter(m => m.category === 'latency');
    const operationMetrics = metrics.filter(m => m.name.includes('operation'));
    const memoryMetrics = metrics.filter(m => m.name === 'memoryUsagePercent');
    const throughputMetrics = metrics.filter(m => m.category === 'throughput');

    return {
      avgLatency: this.calculateAverage(latencyMetrics.map(m => m.value)),
      totalOperations: operationMetrics.length,
      successRate: this.calculateSuccessRate(operationMetrics),
      peakMemoryUsage: Math.max(...memoryMetrics.map(m => m.value), 0),
      avgThroughput: this.calculateAverage(throughputMetrics.map(m => m.value))
    };
  }

  private analyzeTrends(metrics: PerformanceMetric[]): PerformanceTrend[] {
    const trends: PerformanceTrend[] = [];
    const metricGroups = new Map<string, PerformanceMetric[]>();

    // Group metrics by name
    metrics.forEach(metric => {
      const key = `${metric.name}_${metric.category}`;
      if (!metricGroups.has(key)) {
        metricGroups.set(key, []);
      }
      metricGroups.get(key)!.push(metric);
    });

    // Analyze trends for each metric group
    metricGroups.forEach((groupMetrics, key) => {
      if (groupMetrics.length < 10) return; // Need sufficient data points

      const sortedMetrics = groupMetrics.sort((a, b) => a.timestamp - b.timestamp);
      const midpoint = Math.floor(sortedMetrics.length / 2);
      
      const firstHalf = sortedMetrics.slice(0, midpoint);
      const secondHalf = sortedMetrics.slice(midpoint);

      const firstAvg = this.calculateAverage(firstHalf.map(m => m.value));
      const secondAvg = this.calculateAverage(secondHalf.map(m => m.value));

      const changePercent = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
      const direction = Math.abs(changePercent) < 5 ? 'stable' : 
                       changePercent > 0 ? 'degrading' : 'improving';

      trends.push({
        metric: key,
        direction,
        changePercent: Math.abs(changePercent),
        confidence: Math.min(groupMetrics.length / 100, 1), // More data = higher confidence
        timeWindow: sortedMetrics[sortedMetrics.length - 1].timestamp - sortedMetrics[0].timestamp
      });
    });

    return trends;
  }

  private generateRecommendations(
    metrics: PerformanceMetric[],
    trends: PerformanceTrend[]
  ): PerformanceRecommendation[] {
    const recommendations: PerformanceRecommendation[] = [];

    // High latency recommendation
    const latencyMetrics = metrics.filter(m => m.category === 'latency');
    const avgLatency = this.calculateAverage(latencyMetrics.map(m => m.value));
    
    if (avgLatency > this.thresholds.latency.warning) {
      recommendations.push({
        priority: avgLatency > this.thresholds.latency.critical ? 'critical' : 'high',
        category: 'performance',
        title: 'Optimize High Latency Operations',
        description: `Average latency is ${avgLatency.toFixed(0)}ms, which exceeds acceptable thresholds.`,
        impact: 'Reduce user-perceived delays and improve responsiveness',
        effort: 'medium'
      });
    }

    // Memory usage recommendation
    const memoryMetrics = metrics.filter(m => m.name === 'memoryUsagePercent');
    const avgMemory = this.calculateAverage(memoryMetrics.map(m => m.value));
    
    if (avgMemory > this.thresholds.memory.warning) {
      recommendations.push({
        priority: avgMemory > this.thresholds.memory.critical ? 'critical' : 'high',
        category: 'memory',
        title: 'Optimize Memory Usage',
        description: `Memory usage averaging ${avgMemory.toFixed(1)}% may cause performance issues.`,
        impact: 'Prevent browser crashes and improve stability',
        effort: 'high'
      });
    }

    // Trend-based recommendations
    trends.forEach(trend => {
      if (trend.direction === 'degrading' && trend.changePercent > 20) {
        recommendations.push({
          priority: trend.changePercent > 50 ? 'high' : 'medium',
          category: 'trend',
          title: `Address Degrading ${trend.metric}`,
          description: `${trend.metric} has degraded by ${trend.changePercent.toFixed(1)}% over the observed period.`,
          impact: 'Prevent further performance degradation',
          effort: 'medium'
        });
      }
    });

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateSuccessRate(metrics: PerformanceMetric[]): number {
    if (metrics.length === 0) return 100;
    
    const successCount = metrics.filter(m => 
      m.metadata?.success === true || m.name.includes('success')
    ).length;
    
    return (successCount / metrics.length) * 100;
  }

  private mapNetworkType(effectiveType: string): number {
    const typeMap: Record<string, number> = {
      'slow-2g': 1,
      '2g': 2,
      '3g': 3,
      '4g': 4
    };
    return typeMap[effectiveType] || 0;
  }

  /**
   * Disposes the performance monitor
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }

    this.metrics = [];
    this.marks.clear();
    this.activeOperations.clear();
    this.alerts = [];
    
    this.isDisposed = true;
  }
}