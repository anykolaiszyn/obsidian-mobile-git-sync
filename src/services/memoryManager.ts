/**
 * Memory Management System
 * 
 * Provides intelligent memory monitoring, garbage collection,
 * and resource optimization for mobile devices
 */

import { DisposableService } from '../core/container';
import { Logger } from '../utils/logger';

export interface MemoryStats {
  used: number;
  total: number;
  available: number;
  percentage: number;
  jsHeapSizeLimit?: number;
  jsHeapSizeUsed?: number;
  jsHeapSizeTotalUsed?: number;
}

export interface MemoryThresholds {
  warning: number; // percentage
  critical: number; // percentage
  cleanup: number; // percentage
  emergency: number; // percentage
}

export interface CacheEntry {
  key: string;
  data: any;
  size: number;
  lastAccessed: number;
  accessCount: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  ttl?: number; // time to live in milliseconds
}

export interface MemoryPressureEvent {
  level: 'low' | 'moderate' | 'critical';
  currentUsage: number;
  threshold: number;
  recommendations: string[];
}

export type MemoryPressureHandler = (event: MemoryPressureEvent) => Promise<void> | void;

export class MemoryManager extends DisposableService {
  private cache = new Map<string, CacheEntry>();
  private pressureHandlers = new Set<MemoryPressureHandler>();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastCleanup = 0;
  private performanceObserver: PerformanceObserver | null = null;

  private readonly thresholds: MemoryThresholds = {
    warning: 70,   // 70% memory usage triggers warning
    critical: 85,  // 85% triggers aggressive cleanup
    cleanup: 80,   // 80% triggers regular cleanup
    emergency: 95  // 95% triggers emergency procedures
  };

  private readonly maxCacheSize = 50 * 1024 * 1024; // 50MB max cache
  private readonly cleanupInterval = 30000; // 30 seconds
  private readonly monitoringFrequency = 5000; // 5 seconds

  constructor(private logger: Logger) {
    super();
    this.initialize();
  }

  /**
   * Gets current memory statistics
   */
  getMemoryStats(): MemoryStats {
    const stats: MemoryStats = {
      used: 0,
      total: 0,
      available: 0,
      percentage: 0
    };

    // Try to get memory info from performance API
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      stats.jsHeapSizeLimit = memory.jsHeapSizeLimit;
      stats.jsHeapSizeUsed = memory.usedJSHeapSize;
      stats.jsHeapSizeTotalUsed = memory.totalJSHeapSize;
      
      stats.used = memory.usedJSHeapSize;
      stats.total = memory.jsHeapSizeLimit;
      stats.available = stats.total - stats.used;
      stats.percentage = (stats.used / stats.total) * 100;
    } else {
      // Fallback estimation
      stats.used = this.estimateMemoryUsage();
      stats.total = this.estimateMemoryLimit();
      stats.available = stats.total - stats.used;
      stats.percentage = (stats.used / stats.total) * 100;
    }

    return stats;
  }

  /**
   * Caches data with intelligent eviction
   */
  cacheData(
    key: string,
    data: any,
    options: {
      priority?: CacheEntry['priority'];
      ttl?: number;
      size?: number;
    } = {}
  ): void {
    const size = options.size || this.calculateDataSize(data);
    const entry: CacheEntry = {
      key,
      data,
      size,
      lastAccessed: Date.now(),
      accessCount: 1,
      priority: options.priority || 'medium',
      ttl: options.ttl
    };

    // Check if we need to make space
    this.ensureCacheSpace(size);

    this.cache.set(key, entry);
    
    this.logger.debug('Data cached', {
      component: 'MemoryManager',
      key,
      size,
      priority: entry.priority,
      cacheSize: this.getCacheSize()
    });
  }

  /**
   * Retrieves cached data
   */
  getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check TTL
    if (entry.ttl && Date.now() - entry.lastAccessed > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Update access statistics
    entry.lastAccessed = Date.now();
    entry.accessCount++;

    return entry.data as T;
  }

  /**
   * Removes data from cache
   */
  evict(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key);
      this.logger.debug('Cache entry evicted', {
        component: 'MemoryManager',
        key,
        size: entry.size
      });
      return true;
    }
    return false;
  }

  /**
   * Clears cache based on criteria
   */
  clearCache(criteria: {
    priority?: CacheEntry['priority'];
    olderThan?: number; // milliseconds
    lessAccessedThan?: number;
  } = {}): number {
    let clearedCount = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache) {
      let shouldClear = false;

      if (criteria.priority && entry.priority === criteria.priority) {
        shouldClear = true;
      }

      if (criteria.olderThan && (now - entry.lastAccessed) > criteria.olderThan) {
        shouldClear = true;
      }

      if (criteria.lessAccessedThan && entry.accessCount < criteria.lessAccessedThan) {
        shouldClear = true;
      }

      if (shouldClear) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    this.logger.info('Cache cleared', {
      component: 'MemoryManager',
      clearedCount,
      criteria,
      remainingEntries: this.cache.size
    });

    return clearedCount;
  }

  /**
   * Registers a memory pressure handler
   */
  onMemoryPressure(handler: MemoryPressureHandler): void {
    this.pressureHandlers.add(handler);
  }

  /**
   * Unregisters a memory pressure handler
   */
  offMemoryPressure(handler: MemoryPressureHandler): void {
    this.pressureHandlers.delete(handler);
  }

  /**
   * Forces garbage collection if available
   */
  forceGC(): boolean {
    if ('gc' in window && typeof (window as any).gc === 'function') {
      try {
        (window as any).gc();
        this.logger.debug('Forced garbage collection', {
          component: 'MemoryManager'
        });
        return true;
      } catch (error) {
        this.logger.warn('Failed to force garbage collection', { error });
      }
    }
    return false;
  }

  /**
   * Optimizes memory usage
   */
  async optimizeMemory(): Promise<{
    beforeStats: MemoryStats;
    afterStats: MemoryStats;
    actions: string[];
  }> {
    const beforeStats = this.getMemoryStats();
    const actions: string[] = [];

    this.logger.info('Starting memory optimization', {
      component: 'MemoryManager',
      beforeStats
    });

    // 1. Clear expired cache entries
    const expiredCleared = this.clearExpiredEntries();
    if (expiredCleared > 0) {
      actions.push(`Cleared ${expiredCleared} expired cache entries`);
    }

    // 2. Clear low-priority cached data
    const lowPriorityCleared = this.clearCache({ priority: 'low' });
    if (lowPriorityCleared > 0) {
      actions.push(`Cleared ${lowPriorityCleared} low-priority cache entries`);
    }

    // 3. Clear old cache entries
    const oldEntriesCleared = this.clearCache({ 
      olderThan: 10 * 60 * 1000 // 10 minutes
    });
    if (oldEntriesCleared > 0) {
      actions.push(`Cleared ${oldEntriesCleared} old cache entries`);
    }

    // 4. Force garbage collection
    if (this.forceGC()) {
      actions.push('Forced garbage collection');
    }

    // 5. Clear rarely accessed entries if still under pressure
    const currentStats = this.getMemoryStats();
    if (currentStats.percentage > this.thresholds.warning) {
      const rarelyAccessedCleared = this.clearCache({ 
        lessAccessedThan: 2 
      });
      if (rarelyAccessedCleared > 0) {
        actions.push(`Cleared ${rarelyAccessedCleared} rarely accessed entries`);
      }
    }

    const afterStats = this.getMemoryStats();

    this.logger.info('Memory optimization completed', {
      component: 'MemoryManager',
      beforeStats,
      afterStats,
      actions,
      improvement: beforeStats.percentage - afterStats.percentage
    });

    return { beforeStats, afterStats, actions };
  }

  /**
   * Gets cache statistics
   */
  getCacheStats(): {
    totalEntries: number;
    totalSize: number;
    sizeByPriority: Record<CacheEntry['priority'], number>;
    oldestEntry?: Date;
    newestEntry?: Date;
    averageAccessCount: number;
  } {
    let totalSize = 0;
    let totalAccessCount = 0;
    let oldestTimestamp = Infinity;
    let newestTimestamp = 0;

    const sizeByPriority: Record<CacheEntry['priority'], number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };

    for (const entry of this.cache.values()) {
      totalSize += entry.size;
      totalAccessCount += entry.accessCount;
      sizeByPriority[entry.priority] += entry.size;
      
      oldestTimestamp = Math.min(oldestTimestamp, entry.lastAccessed);
      newestTimestamp = Math.max(newestTimestamp, entry.lastAccessed);
    }

    return {
      totalEntries: this.cache.size,
      totalSize,
      sizeByPriority,
      oldestEntry: oldestTimestamp < Infinity ? new Date(oldestTimestamp) : undefined,
      newestEntry: newestTimestamp > 0 ? new Date(newestTimestamp) : undefined,
      averageAccessCount: this.cache.size > 0 ? totalAccessCount / this.cache.size : 0
    };
  }

  /**
   * Initializes memory monitoring
   */
  private initialize(): void {
    this.startMonitoring();
    this.setupPerformanceObserver();
    this.scheduleRegularCleanup();

    this.logger.info('Memory manager initialized', {
      component: 'MemoryManager',
      thresholds: this.thresholds,
      maxCacheSize: this.maxCacheSize
    });
  }

  /**
   * Starts memory monitoring
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const stats = this.getMemoryStats();
      
      this.checkMemoryPressure(stats);
      
      // Log memory stats periodically
      if (stats.percentage > this.thresholds.warning) {
        this.logger.warn('High memory usage detected', {
          component: 'MemoryManager',
          stats
        });
      }
    }, this.monitoringFrequency);
  }

  /**
   * Sets up performance observer for memory events
   */
  private setupPerformanceObserver(): void {
    if ('PerformanceObserver' in window) {
      try {
        this.performanceObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          for (const entry of entries) {
            if (entry.entryType === 'measure' && entry.name.includes('memory')) {
              this.logger.debug('Memory performance entry', {
                component: 'MemoryManager',
                entry: {
                  name: entry.name,
                  duration: entry.duration,
                  startTime: entry.startTime
                }
              });
            }
          }
        });

        this.performanceObserver.observe({ entryTypes: ['measure', 'navigation'] });
      } catch (error) {
        this.logger.debug('Performance observer setup failed', { error });
      }
    }
  }

  /**
   * Schedules regular cleanup
   */
  private scheduleRegularCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      if (now - this.lastCleanup > this.cleanupInterval) {
        this.performRegularCleanup();
        this.lastCleanup = now;
      }
    }, this.cleanupInterval);
  }

  /**
   * Performs regular cleanup
   */
  private performRegularCleanup(): void {
    const expiredCleared = this.clearExpiredEntries();
    
    if (expiredCleared > 0) {
      this.logger.debug('Regular cleanup completed', {
        component: 'MemoryManager',
        expiredCleared
      });
    }
  }

  /**
   * Checks for memory pressure and triggers handlers
   */
  private async checkMemoryPressure(stats: MemoryStats): Promise<void> {
    let pressureLevel: MemoryPressureEvent['level'] | null = null;
    let threshold = 0;

    if (stats.percentage >= this.thresholds.emergency) {
      pressureLevel = 'critical';
      threshold = this.thresholds.emergency;
    } else if (stats.percentage >= this.thresholds.critical) {
      pressureLevel = 'critical';
      threshold = this.thresholds.critical;
    } else if (stats.percentage >= this.thresholds.warning) {
      pressureLevel = 'moderate';
      threshold = this.thresholds.warning;
    }

    if (pressureLevel) {
      const event: MemoryPressureEvent = {
        level: pressureLevel,
        currentUsage: stats.percentage,
        threshold,
        recommendations: this.generateRecommendations(stats)
      };

      // Trigger handlers
      for (const handler of this.pressureHandlers) {
        try {
          await handler(event);
        } catch (error) {
          this.logger.error('Memory pressure handler failed', { error });
        }
      }

      // Auto-optimize on critical pressure
      if (pressureLevel === 'critical') {
        await this.optimizeMemory();
      }
    }
  }

  /**
   * Generates memory optimization recommendations
   */
  private generateRecommendations(stats: MemoryStats): string[] {
    const recommendations: string[] = [];
    
    if (stats.percentage > this.thresholds.critical) {
      recommendations.push('Clear all non-critical cached data');
      recommendations.push('Reduce concurrent operations');
      recommendations.push('Force garbage collection');
    }
    
    if (stats.percentage > this.thresholds.warning) {
      recommendations.push('Clear expired cache entries');
      recommendations.push('Reduce cache retention time');
      recommendations.push('Process data in smaller chunks');
    }

    const cacheStats = this.getCacheStats();
    if (cacheStats.totalSize > this.maxCacheSize * 0.8) {
      recommendations.push('Clear low-priority cached data');
    }

    return recommendations;
  }

  /**
   * Ensures sufficient cache space
   */
  private ensureCacheSpace(requiredSize: number): void {
    const currentSize = this.getCacheSize();
    
    if (currentSize + requiredSize > this.maxCacheSize) {
      const needToFree = (currentSize + requiredSize) - this.maxCacheSize;
      this.evictLRU(needToFree);
    }
  }

  /**
   * Evicts least recently used cache entries
   */
  private evictLRU(sizeToFree: number): void {
    const entries = Array.from(this.cache.entries()).sort((a, b) => {
      // Sort by last accessed time (oldest first)
      return a[1].lastAccessed - b[1].lastAccessed;
    });

    let freedSize = 0;
    let evictedCount = 0;

    for (const [key, entry] of entries) {
      if (freedSize >= sizeToFree) break;
      
      // Don't evict critical priority items unless absolutely necessary
      if (entry.priority === 'critical' && freedSize < sizeToFree * 0.8) {
        continue;
      }

      this.cache.delete(key);
      freedSize += entry.size;
      evictedCount++;
    }

    this.logger.debug('LRU eviction completed', {
      component: 'MemoryManager',
      evictedCount,
      freedSize,
      requiredSize: sizeToFree
    });
  }

  /**
   * Clears expired cache entries
   */
  private clearExpiredEntries(): number {
    const now = Date.now();
    let clearedCount = 0;

    for (const [key, entry] of this.cache) {
      if (entry.ttl && (now - entry.lastAccessed) > entry.ttl) {
        this.cache.delete(key);
        clearedCount++;
      }
    }

    return clearedCount;
  }

  /**
   * Calculates total cache size
   */
  private getCacheSize(): number {
    let totalSize = 0;
    for (const entry of this.cache.values()) {
      totalSize += entry.size;
    }
    return totalSize;
  }

  /**
   * Estimates data size in bytes
   */
  private calculateDataSize(data: any): number {
    try {
      const jsonString = JSON.stringify(data);
      return new Blob([jsonString]).size;
    } catch {
      // Fallback estimation
      return 1024; // 1KB default
    }
  }

  /**
   * Estimates current memory usage (fallback)
   */
  private estimateMemoryUsage(): number {
    const cacheSize = this.getCacheSize();
    const estimatedOtherUsage = 20 * 1024 * 1024; // 20MB estimated for other data
    return cacheSize + estimatedOtherUsage;
  }

  /**
   * Estimates memory limit (fallback)
   */
  private estimateMemoryLimit(): number {
    // Conservative estimate for mobile devices
    return 100 * 1024 * 1024; // 100MB
  }

  /**
   * Disposes the memory manager
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

    this.cache.clear();
    this.pressureHandlers.clear();
    
    this.isDisposed = true;
  }
}