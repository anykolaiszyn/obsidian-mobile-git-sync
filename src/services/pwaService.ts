/**
 * Progressive Web App Service
 * 
 * Provides offline capabilities, service worker management,
 * and enhanced mobile web app features
 */

import { DisposableService } from '../core/container';
import { Logger } from '../utils/logger';

export interface PWACapabilities {
  serviceWorker: boolean;
  offline: boolean;
  backgroundSync: boolean;
  pushNotifications: boolean;
  installPrompt: boolean;
  fileSystemAccess: boolean;
  webShare: boolean;
}

export interface OfflineQueueItem {
  id: string;
  type: 'sync' | 'upload' | 'download' | 'delete';
  data: any;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PWAConfig {
  enableServiceWorker: boolean;
  enableBackgroundSync: boolean;
  enablePushNotifications: boolean;
  offlineStorageQuota: number; // bytes
  maxOfflineItems: number;
  syncRetryDelay: number; // milliseconds
  cacheStrategy: 'cache-first' | 'network-first' | 'stale-while-revalidate';
}

export class PWAService extends DisposableService {
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
  private installPromptEvent: InstallPromptEvent | null = null;
  private offlineQueue: OfflineQueueItem[] = [];
  private isOnline = navigator.onLine;
  private syncInProgress = false;

  private readonly defaultConfig: PWAConfig = {
    enableServiceWorker: true,
    enableBackgroundSync: true,
    enablePushNotifications: false,
    offlineStorageQuota: 50 * 1024 * 1024, // 50MB
    maxOfflineItems: 1000,
    syncRetryDelay: 30000, // 30 seconds
    cacheStrategy: 'stale-while-revalidate'
  };

  constructor(
    private logger: Logger,
    private config: Partial<PWAConfig> = {}
  ) {
    super();
    this.config = { ...this.defaultConfig, ...config };
    this.initialize();
  }

  /**
   * Initializes PWA capabilities
   */
  private async initialize(): Promise<void> {
    try {
      await this.checkCapabilities();
      await this.setupServiceWorker();
      this.setupInstallPrompt();
      this.setupNetworkListeners();
      this.loadOfflineQueue();
      
      this.logger.info('PWA service initialized', {
        component: 'PWAService',
        capabilities: await this.getCapabilities(),
        isOnline: this.isOnline
      });
    } catch (error) {
      this.logger.error('PWA initialization failed', { error });
    }
  }

  /**
   * Gets available PWA capabilities
   */
  async getCapabilities(): Promise<PWACapabilities> {
    return {
      serviceWorker: 'serviceWorker' in navigator,
      offline: 'serviceWorker' in navigator && 'caches' in window,
      backgroundSync: 'serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype,
      pushNotifications: 'serviceWorker' in navigator && 'PushManager' in window,
      installPrompt: this.installPromptEvent !== null,
      fileSystemAccess: 'showOpenFilePicker' in window,
      webShare: 'share' in navigator
    };
  }

  /**
   * Checks if the app can be installed
   */
  canInstall(): boolean {
    return this.installPromptEvent !== null;
  }

  /**
   * Triggers the install prompt
   */
  async promptInstall(): Promise<boolean> {
    if (!this.installPromptEvent) {
      throw new Error('Install prompt not available');
    }

    try {
      await this.installPromptEvent.prompt();
      const choice = await this.installPromptEvent.userChoice;
      
      this.logger.info('Install prompt result', {
        component: 'PWAService',
        outcome: choice.outcome
      });

      this.installPromptEvent = null;
      return choice.outcome === 'accepted';
    } catch (error) {
      this.logger.error('Install prompt failed', { error });
      return false;
    }
  }

  /**
   * Adds an item to the offline queue
   */
  addToOfflineQueue(item: Omit<OfflineQueueItem, 'id' | 'timestamp' | 'retryCount'>): void {
    const queueItem: OfflineQueueItem = {
      id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      retryCount: 0,
      ...item
    };

    this.offlineQueue.push(queueItem);
    
    // Limit queue size
    if (this.offlineQueue.length > this.config.maxOfflineItems!) {
      this.offlineQueue.shift(); // Remove oldest item
    }

    this.saveOfflineQueue();
    
    this.logger.debug('Item added to offline queue', {
      component: 'PWAService',
      type: item.type,
      queueSize: this.offlineQueue.length
    });

    // Try to process immediately if online
    if (this.isOnline) {
      this.processOfflineQueue();
    }
  }

  /**
   * Processes the offline queue when connection is restored
   */
  async processOfflineQueue(): Promise<void> {
    if (this.syncInProgress || !this.isOnline) {
      return;
    }

    this.syncInProgress = true;
    
    try {
      this.logger.info('Processing offline queue', {
        component: 'PWAService',
        queueSize: this.offlineQueue.length
      });

      const processed: string[] = [];

      for (const item of this.offlineQueue) {
        try {
          await this.processOfflineItem(item);
          processed.push(item.id);
          
          this.logger.debug('Offline item processed', {
            component: 'PWAService',
            itemId: item.id,
            type: item.type
          });
        } catch (error) {
          item.retryCount++;
          
          if (item.retryCount >= item.maxRetries) {
            processed.push(item.id); // Remove failed items
            this.logger.error('Offline item failed permanently', {
              itemId: item.id,
              type: item.type,
              error
            });
          } else {
            this.logger.warn('Offline item retry failed', {
              itemId: item.id,
              type: item.type,
              retryCount: item.retryCount,
              error
            });
          }
        }
      }

      // Remove processed items
      this.offlineQueue = this.offlineQueue.filter(item => !processed.includes(item.id));
      this.saveOfflineQueue();

    } catch (error) {
      this.logger.error('Offline queue processing failed', { error });
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Shares content using Web Share API
   */
  async shareContent(data: { title?: string; text?: string; url?: string; files?: File[] }): Promise<boolean> {
    if (!('share' in navigator)) {
      throw new Error('Web Share API not supported');
    }

    try {
      await navigator.share(data);
      
      this.logger.info('Content shared successfully', {
        component: 'PWAService',
        hasTitle: !!data.title,
        hasText: !!data.text,
        hasUrl: !!data.url,
        fileCount: data.files?.length || 0
      });

      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled sharing
        return false;
      }
      
      this.logger.error('Content sharing failed', { error });
      throw error;
    }
  }

  /**
   * Requests persistent storage
   */
  async requestPersistentStorage(): Promise<boolean> {
    if ('storage' in navigator && 'persist' in navigator.storage) {
      try {
        const persistent = await navigator.storage.persist();
        
        this.logger.info('Persistent storage request', {
          component: 'PWAService',
          granted: persistent
        });

        return persistent;
      } catch (error) {
        this.logger.error('Persistent storage request failed', { error });
        return false;
      }
    }
    
    return false;
  }

  /**
   * Gets storage usage information
   */
  async getStorageUsage(): Promise<{ used: number; quota: number; percentage: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        const used = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const percentage = quota > 0 ? (used / quota) * 100 : 0;

        return { used, quota, percentage };
      } catch (error) {
        this.logger.error('Storage usage check failed', { error });
      }
    }

    return { used: 0, quota: 0, percentage: 0 };
  }

  /**
   * Caches essential resources for offline use
   */
  async cacheEssentialResources(resources: string[]): Promise<void> {
    if (!this.serviceWorkerRegistration) {
      throw new Error('Service Worker not available');
    }

    try {
      const cache = await caches.open('obsidian-git-sync-essentials');
      await cache.addAll(resources);
      
      this.logger.info('Essential resources cached', {
        component: 'PWAService',
        resourceCount: resources.length
      });
    } catch (error) {
      this.logger.error('Resource caching failed', { error });
      throw error;
    }
  }

  /**
   * Cleans up old cached data
   */
  async cleanupCache(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const cacheNames = await caches.keys();
      const cutoff = Date.now() - maxAge;

      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();

        for (const request of requests) {
          const response = await cache.match(request);
          if (response) {
            const dateHeader = response.headers.get('date');
            if (dateHeader) {
              const responseDate = new Date(dateHeader).getTime();
              if (responseDate < cutoff) {
                await cache.delete(request);
              }
            }
          }
        }
      }

      this.logger.info('Cache cleanup completed', {
        component: 'PWAService',
        cacheCount: cacheNames.length
      });
    } catch (error) {
      this.logger.error('Cache cleanup failed', { error });
    }
  }

  /**
   * Checks PWA capabilities on initialization
   */
  private async checkCapabilities(): Promise<void> {
    const capabilities = await this.getCapabilities();
    
    if (!capabilities.serviceWorker) {
      this.logger.warn('Service Worker not supported', { component: 'PWAService' });
    }

    if (!capabilities.offline) {
      this.logger.warn('Offline capabilities not available', { component: 'PWAService' });
    }
  }

  /**
   * Sets up the service worker
   */
  private async setupServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator) || !this.config.enableServiceWorker) {
      return;
    }

    try {
      this.serviceWorkerRegistration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      // Listen for updates
      this.serviceWorkerRegistration.addEventListener('updatefound', () => {
        this.logger.info('Service Worker update found', { component: 'PWAService' });
      });

      // Setup background sync if supported
      if (this.config.enableBackgroundSync && 'sync' in window.ServiceWorkerRegistration.prototype) {
        this.setupBackgroundSync();
      }

      this.logger.info('Service Worker registered', {
        component: 'PWAService',
        scope: this.serviceWorkerRegistration.scope
      });
    } catch (error) {
      this.logger.error('Service Worker registration failed', { error });
    }
  }

  /**
   * Sets up background sync
   */
  private setupBackgroundSync(): void {
    if (!this.serviceWorkerRegistration) {
      return;
    }

    // Register background sync
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data.type === 'BACKGROUND_SYNC') {
        this.processOfflineQueue();
      }
    });
  }

  /**
   * Sets up install prompt handling
   */
  private setupInstallPrompt(): void {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installPromptEvent = event as InstallPromptEvent;
      
      this.logger.info('Install prompt ready', { component: 'PWAService' });
    });

    window.addEventListener('appinstalled', () => {
      this.installPromptEvent = null;
      this.logger.info('App installed successfully', { component: 'PWAService' });
    });
  }

  /**
   * Sets up network status listeners
   */
  private setupNetworkListeners(): void {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.logger.info('Connection restored', { component: 'PWAService' });
      
      // Process offline queue when connection is restored
      setTimeout(() => this.processOfflineQueue(), 1000);
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.logger.info('Connection lost', { component: 'PWAService' });
    });
  }

  /**
   * Processes a single offline queue item
   */
  private async processOfflineItem(item: OfflineQueueItem): Promise<void> {
    // This would delegate to the appropriate service based on item type
    switch (item.type) {
      case 'sync':
        // Delegate to sync service
        break;
      case 'upload':
        // Delegate to upload service
        break;
      case 'download':
        // Delegate to download service
        break;
      case 'delete':
        // Delegate to delete service
        break;
      default:
        throw new Error(`Unknown offline item type: ${item.type}`);
    }
  }

  /**
   * Loads offline queue from storage
   */
  private loadOfflineQueue(): void {
    try {
      const stored = localStorage.getItem('obsidian-git-sync-offline-queue');
      if (stored) {
        this.offlineQueue = JSON.parse(stored);
        this.logger.debug('Offline queue loaded', {
          component: 'PWAService',
          queueSize: this.offlineQueue.length
        });
      }
    } catch (error) {
      this.logger.error('Failed to load offline queue', { error });
      this.offlineQueue = [];
    }
  }

  /**
   * Saves offline queue to storage
   */
  private saveOfflineQueue(): void {
    try {
      localStorage.setItem('obsidian-git-sync-offline-queue', JSON.stringify(this.offlineQueue));
    } catch (error) {
      this.logger.error('Failed to save offline queue', { error });
    }
  }

  /**
   * Gets network connection status
   */
  isOffline(): boolean {
    return !this.isOnline;
  }

  /**
   * Gets offline queue status
   */
  getOfflineQueueStatus(): {
    size: number;
    types: Record<string, number>;
    oldestItem?: Date;
    newestItem?: Date;
  } {
    const types: Record<string, number> = {};
    let oldestTimestamp = Infinity;
    let newestTimestamp = 0;

    this.offlineQueue.forEach(item => {
      types[item.type] = (types[item.type] || 0) + 1;
      oldestTimestamp = Math.min(oldestTimestamp, item.timestamp);
      newestTimestamp = Math.max(newestTimestamp, item.timestamp);
    });

    return {
      size: this.offlineQueue.length,
      types,
      oldestItem: oldestTimestamp < Infinity ? new Date(oldestTimestamp) : undefined,
      newestItem: newestTimestamp > 0 ? new Date(newestTimestamp) : undefined
    };
  }

  /**
   * Disposes the PWA service
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.saveOfflineQueue();
    
    if (this.serviceWorkerRegistration) {
      // Don't unregister service worker as it should persist
    }

    this.isDisposed = true;
  }
}