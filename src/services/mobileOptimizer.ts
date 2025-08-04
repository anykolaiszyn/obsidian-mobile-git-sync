/**
 * Mobile Optimizer Service
 * 
 * Provides battery-aware sync scheduling, data usage controls,
 * and mobile-specific optimizations for the best mobile experience
 */

import { DisposableService } from '../core/container';
import { Logger } from '../utils/logger';

export interface BatteryInfo {
  level: number; // 0-1
  charging: boolean;
  chargingTime?: number;
  dischargingTime?: number;
}

export interface NetworkInfo {
  type: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';
  downlink: number; // Mbps
  rtt: number; // ms
  saveData: boolean;
}

export interface DataUsageWarning {
  type: 'size' | 'count' | 'duration';
  threshold: number;
  currentValue: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface MobileOptimizationSettings {
  batteryAwareSync: boolean;
  lowBatteryThreshold: number; // 0-1
  cellularDataWarning: boolean;
  maxCellularFileSize: number; // bytes
  adaptiveQuality: boolean;
  hapticFeedback: boolean;
  preloadContent: boolean;
  backgroundSync: boolean;
}

export interface OptimizationRecommendation {
  type: 'battery' | 'data' | 'performance' | 'storage';
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  action?: () => Promise<void>;
  dismissed?: boolean;
}

export class MobileOptimizerService extends DisposableService {
  private batteryInfo: BatteryInfo | null = null;
  private networkInfo: NetworkInfo | null = null;
  private dataUsageTracker = new Map<string, number>();
  private batteryUpdateInterval: NodeJS.Timeout | null = null;
  private networkUpdateInterval: NodeJS.Timeout | null = null;
  
  constructor(
    private logger: Logger,
    private settings: MobileOptimizationSettings
  ) {
    super();
    this.initialize();
  }

  /**
   * Initializes mobile optimization features
   */
  private async initialize(): Promise<void> {
    try {
      await this.initializeBatteryMonitoring();
      await this.initializeNetworkMonitoring();
      this.startPeriodicUpdates();
      
      this.logger.info('Mobile optimizer initialized', {
        component: 'MobileOptimizer',
        batterySupported: 'getBattery' in navigator,
        networkSupported: 'connection' in navigator
      });
    } catch (error) {
      this.logger.warn('Mobile optimization features partially unavailable', { error });
    }
  }

  /**
   * Gets optimal sync interval based on battery and network conditions
   */
  getOptimalSyncInterval(): number {
    const baseInterval = 15 * 60 * 1000; // 15 minutes
    let multiplier = 1;

    // Battery considerations
    if (this.batteryInfo && this.settings.batteryAwareSync) {
      if (this.batteryInfo.level < this.settings.lowBatteryThreshold) {
        if (this.batteryInfo.charging) {
          multiplier *= 1.5; // Reduce frequency but not drastically when charging
        } else {
          multiplier *= 4; // Significantly reduce when low battery and not charging
        }
      } else if (this.batteryInfo.level < 0.3 && !this.batteryInfo.charging) {
        multiplier *= 2; // Moderate reduction for medium battery
      }
    }

    // Network considerations
    if (this.networkInfo) {
      if (this.networkInfo.type === 'cellular') {
        multiplier *= 2; // Less frequent on cellular
      }
      
      if (this.networkInfo.saveData) {
        multiplier *= 3; // Respect data saver mode
      }

      if (this.networkInfo.effectiveType === 'slow-2g' || this.networkInfo.effectiveType === '2g') {
        multiplier *= 2; // Reduce on slow connections
      }
    }

    const optimizedInterval = Math.min(baseInterval * multiplier, 4 * 60 * 60 * 1000); // Max 4 hours
    
    this.logger.debug('Calculated optimal sync interval', {
      component: 'MobileOptimizer',
      baseInterval,
      multiplier,
      optimizedInterval,
      batteryLevel: this.batteryInfo?.level,
      networkType: this.networkInfo?.type
    });

    return optimizedInterval;
  }

  /**
   * Checks if a sync operation should proceed based on current conditions
   */
  shouldAllowSync(estimatedDataUsage: number): {
    allowed: boolean;
    warnings: DataUsageWarning[];
    recommendations: string[];
  } {
    const warnings: DataUsageWarning[] = [];
    const recommendations: string[] = [];
    let allowed = true;

    // Battery checks
    if (this.batteryInfo && this.settings.batteryAwareSync) {
      if (this.batteryInfo.level < 0.1 && !this.batteryInfo.charging) {
        allowed = false;
        warnings.push({
          type: 'duration',
          threshold: 0.1,
          currentValue: this.batteryInfo.level,
          message: 'Battery critically low. Sync disabled to preserve power.',
          severity: 'critical'
        });
      } else if (this.batteryInfo.level < this.settings.lowBatteryThreshold && !this.batteryInfo.charging) {
        warnings.push({
          type: 'duration',
          threshold: this.settings.lowBatteryThreshold,
          currentValue: this.batteryInfo.level,
          message: 'Low battery detected. Consider charging before large sync operations.',
          severity: 'warning'
        });
        recommendations.push('Connect charger for optimal sync performance');
      }
    }

    // Data usage checks
    if (this.networkInfo) {
      if (this.networkInfo.type === 'cellular' && this.settings.cellularDataWarning) {
        if (estimatedDataUsage > this.settings.maxCellularFileSize) {
          warnings.push({
            type: 'size',
            threshold: this.settings.maxCellularFileSize,
            currentValue: estimatedDataUsage,
            message: `Large sync detected (${this.formatBytes(estimatedDataUsage)}). This will use cellular data.`,
            severity: 'warning'
          });
          recommendations.push('Connect to Wi-Fi for large transfers');
        }
      }

      if (this.networkInfo.saveData) {
        warnings.push({
          type: 'count',
          threshold: 1,
          currentValue: 1,
          message: 'Data Saver mode is enabled. Sync frequency is reduced.',
          severity: 'info'
        });
      }

      if (this.networkInfo.effectiveType === 'slow-2g' || this.networkInfo.effectiveType === '2g') {
        recommendations.push('Slow connection detected. Consider syncing fewer files');
      }
    }

    return { allowed, warnings, recommendations };
  }

  /**
   * Triggers haptic feedback for mobile interactions
   */
  triggerHapticFeedback(type: 'success' | 'error' | 'warning' | 'selection' | 'impact'): void {
    if (!this.settings.hapticFeedback) {
      return;
    }

    try {
      // Modern browsers with Vibration API
      if ('vibrate' in navigator) {
        const patterns = {
          success: [100],
          error: [100, 50, 100, 50, 100],
          warning: [200, 100, 200],
          selection: [50],
          impact: [10]
        };
        
        navigator.vibrate(patterns[type]);
      }

      // iOS Safari with experimental haptic API
      if ('haptic' in navigator && typeof (navigator as any).haptic.impact === 'function') {
        const intensities = {
          success: 'medium',
          error: 'heavy',
          warning: 'medium',
          selection: 'light',
          impact: 'light'
        };
        
        (navigator as any).haptic.impact(intensities[type]);
      }

      this.logger.debug('Haptic feedback triggered', {
        component: 'MobileOptimizer',
        type,
        supported: 'vibrate' in navigator
      });

    } catch (error) {
      this.logger.debug('Haptic feedback failed', { error });
    }
  }

  /**
   * Gets optimization recommendations based on current state
   */
  getOptimizationRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];

    // Battery recommendations
    if (this.batteryInfo) {
      if (this.batteryInfo.level < 0.2 && !this.batteryInfo.charging) {
        recommendations.push({
          type: 'battery',
          priority: 'high',
          title: 'Enable Power Saving Mode',
          description: 'Reduce sync frequency to preserve battery life',
          action: async () => {
            // Enable power saving settings
            this.settings.batteryAwareSync = true;
            this.settings.lowBatteryThreshold = 0.3;
          }
        });
      }

      if (this.batteryInfo.charging && this.batteryInfo.level > 0.8) {
        recommendations.push({
          type: 'performance',
          priority: 'medium',
          title: 'Optimize While Charging',
          description: 'Now is a good time to sync large files',
          action: async () => {
            // Trigger full sync
          }
        });
      }
    }

    // Network recommendations
    if (this.networkInfo) {
      if (this.networkInfo.type === 'cellular' && !this.settings.cellularDataWarning) {
        recommendations.push({
          type: 'data',
          priority: 'medium',
          title: 'Enable Cellular Data Warnings',
          description: 'Get notified before large transfers on cellular',
          action: async () => {
            this.settings.cellularDataWarning = true;
          }
        });
      }

      if (this.networkInfo.type === 'wifi' && this.networkInfo.downlink > 10) {
        recommendations.push({
          type: 'performance',
          priority: 'low',
          title: 'Fast Connection Detected',
          description: 'Consider enabling background sync for better experience',
          action: async () => {
            this.settings.backgroundSync = true;
          }
        });
      }
    }

    // Storage recommendations
    const dataUsage = this.getTotalDataUsage();
    if (dataUsage > 100 * 1024 * 1024) { // 100MB
      recommendations.push({
        type: 'storage',
        priority: 'low',
        title: 'High Data Usage Detected',
        description: 'Review sync patterns to optimize data usage',
        action: async () => {
          // Open data usage analytics
        }
      });
    }

    return recommendations;
  }

  /**
   * Estimates data usage for a sync operation
   */
  estimateDataUsage(fileCount: number, averageFileSize: number): {
    totalSize: number;
    transferSize: number; // Accounting for compression, headers, etc.
    estimatedDuration: number;
  } {
    const totalSize = fileCount * averageFileSize;
    
    // Account for HTTP overhead, compression, metadata
    const transferSize = Math.ceil(totalSize * 1.2); // 20% overhead
    
    // Estimate duration based on network speed
    let estimatedDuration = 30000; // Default 30 seconds
    
    if (this.networkInfo) {
      const speedMbps = this.networkInfo.downlink || 1;
      const speedBps = speedMbps * 1024 * 1024 / 8; // Convert to bytes per second
      estimatedDuration = Math.max((transferSize / speedBps) * 1000, 5000); // Min 5 seconds
    }

    return {
      totalSize,
      transferSize,
      estimatedDuration
    };
  }

  /**
   * Tracks data usage for analytics
   */
  trackDataUsage(operation: string, bytes: number): void {
    const today = new Date().toISOString().split('T')[0];
    const key = `${today}-${operation}`;
    
    const current = this.dataUsageTracker.get(key) || 0;
    this.dataUsageTracker.set(key, current + bytes);

    this.logger.debug('Data usage tracked', {
      component: 'MobileOptimizer',
      operation,
      bytes,
      total: current + bytes
    });
  }

  /**
   * Gets data usage analytics
   */
  getDataUsageAnalytics(): {
    today: number;
    thisWeek: number;
    thisMonth: number;
    byOperation: Record<string, number>;
  } {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let todayUsage = 0;
    let weekUsage = 0;
    let monthUsage = 0;
    const byOperation: Record<string, number> = {};

    for (const [key, bytes] of this.dataUsageTracker) {
      const [date, operation] = key.split('-');
      
      if (date === today) {
        todayUsage += bytes;
      }
      
      if (date >= weekAgo) {
        weekUsage += bytes;
      }
      
      if (date >= monthAgo) {
        monthUsage += bytes;
      }

      byOperation[operation] = (byOperation[operation] || 0) + bytes;
    }

    return {
      today: todayUsage,
      thisWeek: weekUsage,
      thisMonth: monthUsage,
      byOperation
    };
  }

  /**
   * Initializes battery monitoring
   */
  private async initializeBatteryMonitoring(): Promise<void> {
    if ('getBattery' in navigator) {
      try {
        const battery = await (navigator as any).getBattery();
        
        this.updateBatteryInfo(battery);
        
        // Listen for battery events
        battery.addEventListener('chargingchange', () => this.updateBatteryInfo(battery));
        battery.addEventListener('levelchange', () => this.updateBatteryInfo(battery));
        battery.addEventListener('chargingtimechange', () => this.updateBatteryInfo(battery));
        battery.addEventListener('dischargingtimechange', () => this.updateBatteryInfo(battery));
        
      } catch (error) {
        this.logger.debug('Battery API not available', { error });
      }
    }
  }

  /**
   * Initializes network monitoring
   */
  private async initializeNetworkMonitoring(): Promise<void> {
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      
      this.updateNetworkInfo(connection);
      
      // Listen for network changes
      connection.addEventListener('change', () => this.updateNetworkInfo(connection));
    }
  }

  /**
   * Updates battery information
   */
  private updateBatteryInfo(battery: any): void {
    this.batteryInfo = {
      level: battery.level,
      charging: battery.charging,
      chargingTime: battery.chargingTime === Infinity ? undefined : battery.chargingTime,
      dischargingTime: battery.dischargingTime === Infinity ? undefined : battery.dischargingTime
    };

    this.logger.debug('Battery info updated', {
      component: 'MobileOptimizer',
      batteryInfo: this.batteryInfo
    });
  }

  /**
   * Updates network information
   */
  private updateNetworkInfo(connection: any): void {
    this.networkInfo = {
      type: this.mapConnectionType(connection.type),
      effectiveType: connection.effectiveType || 'unknown',
      downlink: connection.downlink || 0,
      rtt: connection.rtt || 0,
      saveData: connection.saveData || false
    };

    this.logger.debug('Network info updated', {
      component: 'MobileOptimizer',
      networkInfo: this.networkInfo
    });
  }

  /**
   * Maps connection type to standard values
   */
  private mapConnectionType(type: string): NetworkInfo['type'] {
    switch (type) {
      case 'wifi':
      case 'ethernet':
        return type;
      case 'cellular':
      case '2g':
      case '3g':
      case '4g':
      case '5g':
        return 'cellular';
      default:
        return 'unknown';
    }
  }

  /**
   * Starts periodic updates for dynamic information
   */
  private startPeriodicUpdates(): void {
    // Update battery info every minute
    this.batteryUpdateInterval = setInterval(() => {
      if ('getBattery' in navigator) {
        (navigator as any).getBattery().then((battery: any) => {
          this.updateBatteryInfo(battery);
        });
      }
    }, 60000);

    // Clean up old data usage entries
    setInterval(() => {
      this.cleanupDataUsageHistory();
    }, 24 * 60 * 60 * 1000); // Daily cleanup
  }

  /**
   * Cleans up old data usage history
   */
  private cleanupDataUsageHistory(): void {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    for (const key of this.dataUsageTracker.keys()) {
      const date = key.split('-')[0];
      if (date < thirtyDaysAgo) {
        this.dataUsageTracker.delete(key);
      }
    }
  }

  /**
   * Gets total data usage across all operations
   */
  private getTotalDataUsage(): number {
    let total = 0;
    for (const bytes of this.dataUsageTracker.values()) {
      total += bytes;
    }
    return total;
  }

  /**
   * Formats bytes in human-readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Gets current mobile optimization status
   */
  getOptimizationStatus(): {
    batteryOptimal: boolean;
    networkOptimal: boolean;
    dataUsageNormal: boolean;
    recommendations: OptimizationRecommendation[];
  } {
    const batteryOptimal = !this.batteryInfo || 
      this.batteryInfo.level > this.settings.lowBatteryThreshold || 
      this.batteryInfo.charging;
      
    const networkOptimal = !this.networkInfo || 
      this.networkInfo.type === 'wifi' || 
      (this.networkInfo.type === 'cellular' && this.networkInfo.effectiveType === '4g');
      
    const dataUsageNormal = this.getTotalDataUsage() < 500 * 1024 * 1024; // 500MB

    return {
      batteryOptimal,
      networkOptimal,
      dataUsageNormal,
      recommendations: this.getOptimizationRecommendations()
    };
  }

  /**
   * Disposes the mobile optimizer
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    if (this.batteryUpdateInterval) {
      clearInterval(this.batteryUpdateInterval);
    }

    if (this.networkUpdateInterval) {
      clearInterval(this.networkUpdateInterval);
    }

    this.dataUsageTracker.clear();
    this.batteryInfo = null;
    this.networkInfo = null;
    
    this.isDisposed = true;
  }
}