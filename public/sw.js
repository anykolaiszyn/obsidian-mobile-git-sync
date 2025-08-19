/**
 * Service Worker for Mobile Git Sync Plugin
 * Provides offline functionality and background sync
 */

const CACHE_NAME = 'obsidian-mobile-git-sync-v1';
const OFFLINE_URL = '/offline.html';

// Files to cache for offline functionality
const STATIC_CACHE = [
  '/main.js',
  '/styles.css',
  '/manifest.json'
];

// Install event - cache static resources
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching static resources');
        return cache.addAll(STATIC_CACHE);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.log('Cache installation failed:', err))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker activated');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', event => {
  // Only handle http/https requests
  if (event.request.url.startsWith('http')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Clone the response as it can only be consumed once
          const responseClone = response.clone();
          
          // Only cache successful responses
          if (response.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          
          return response;
        })
        .catch(() => {
          // Network failed, try to serve from cache
          return caches.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              
              // If no cache, return offline page for navigation requests
              if (event.request.mode === 'navigate') {
                return caches.match(OFFLINE_URL);
              }
              
              // For other requests, return a basic response
              return new Response('Offline', {
                status: 503,
                statusText: 'Service Unavailable'
              });
            });
        })
    );
  }
});

// Background sync event
self.addEventListener('sync', event => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'git-sync-background') {
    event.waitUntil(
      performBackgroundSync()
    );
  }
});

// Perform background sync
async function performBackgroundSync() {
  try {
    console.log('Performing background sync...');
    
    // Notify the main app that background sync is starting
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'BACKGROUND_SYNC_START'
      });
    });
    
    // The actual sync logic will be handled by the main application
    // This service worker just coordinates the background task
    
    console.log('Background sync completed');
    return Promise.resolve();
    
  } catch (error) {
    console.error('Background sync failed:', error);
    return Promise.reject(error);
  }
}

// Message event - handle messages from main thread
self.addEventListener('message', event => {
  console.log('Service Worker received message:', event.data);
  
  if (event.data && event.data.type) {
    switch (event.data.type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
        
      case 'CACHE_URLS':
        if (event.data.urls) {
          caches.open(CACHE_NAME).then(cache => {
            cache.addAll(event.data.urls);
          });
        }
        break;
        
      case 'CLEAR_CACHE':
        caches.delete(CACHE_NAME);
        break;
    }
  }
});