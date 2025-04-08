// content-sync.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, from, throwError } from 'rxjs';
import { catchError, map, tap, retry } from 'rxjs/operators';
import { LogService } from './log.service';
import { Playlist } from './../models/playlist.model';

// Interface to track cached content
interface CachedContent {
  url: string;
  localUrl: string;
  size: number;
  timestamp: number;
  type: string;
  blob?: Blob; // Store the actual blob to recreate object URLs when needed
}

@Injectable({
  providedIn: 'root'
})
export class ContentSyncService {
  private readonly DB_NAME = 'digital-signage-cache';
  private readonly CONTENT_STORE = 'content';
  private readonly PLAYLIST_STORE = 'playlists';
  private readonly MAX_CACHE_SIZE = 1024 * 1024 * 500; // 500 MB cache limit
  private db: IDBDatabase | null = null;
  private cacheSizeBytes = 0;
  private isInitialized = false;
  private blobCache: Map<string, string> = new Map(); // Track active blob URLs
  private initPromise: Promise<boolean> | null = null;

  constructor(
    private http: HttpClient,
    private logService: LogService
  ) {
    this.initPromise = this.initDatabase();
  }

  /**
   * Initialize the IndexedDB database
   */
  private initDatabase(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(this.DB_NAME, 2); // Version 2 schema

        request.onerror = (event) => {
          this.logService.error('Database error: ' + (event.target as any).errorCode);
          reject(new Error('Failed to open database'));
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          
          // Create or update content store
          if (!db.objectStoreNames.contains(this.CONTENT_STORE)) {
            const contentStore = db.createObjectStore(this.CONTENT_STORE, { keyPath: 'url' });
            contentStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
          
          // Create or update playlists store
          if (!db.objectStoreNames.contains(this.PLAYLIST_STORE)) {
            const playlistStore = db.createObjectStore(this.PLAYLIST_STORE, { keyPath: 'id' });
            playlistStore.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          this.isInitialized = true;
          this.calculateCacheSize();
          this.logService.info('Content cache database initialized');
          resolve(true);
        };
      } catch (error) {
        this.logService.error('Fatal error initializing database: ' + error);
        reject(error);
      }
    });
  }

  /**
   * Ensure database is initialized before proceeding with operations
   */
  private ensureInitialized(): Promise<boolean> {
    if (this.isInitialized) {
      return Promise.resolve(true);
    }
    return this.initPromise || Promise.resolve(false);
  }

  /**
   * Calculate the current size of the cache
   */
  private calculateCacheSize(): void {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction([this.CONTENT_STORE], 'readonly');
      const store = transaction.objectStore(this.CONTENT_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const allContent = request.result as CachedContent[];
        this.cacheSizeBytes = allContent.reduce((total, item) => total + item.size, 0);
        this.logService.info(`Cache size: ${(this.cacheSizeBytes / (1024 * 1024)).toFixed(2)} MB`);

        // If cache is approaching size limit, trim oldest content
        if (this.cacheSizeBytes > this.MAX_CACHE_SIZE * 0.9) {
          this.trimCache();
        }
      };

      request.onerror = (event) => {
        this.logService.error(`Error calculating cache size: ${(event.target as any).error}`);
      };
    } catch (error) {
      this.logService.error(`Exception calculating cache size: ${error}`);
    }
  }

  /**
   * Get the local URL for a content item, downloading it if not cached
   */
  getLocalContentUrl(originalUrl: string): Observable<string> {
    // If originalUrl is empty or invalid, return an observable that emits the original URL
    if (!originalUrl || typeof originalUrl !== 'string') {
      return of(originalUrl || '');
    }

    // Return a new observable that will check cache and download if needed
    return new Observable<string>(observer => {
      this.ensureInitialized().then(initialized => {
        if (!initialized || !this.db) {
          observer.next(originalUrl);
          observer.complete();
          return;
        }

        try {
          // Check if we already have an active blob URL for this content
          if (this.blobCache.has(originalUrl)) {
            observer.next(this.blobCache.get(originalUrl)!);
            observer.complete();
            return;
          }

          // Check IndexedDB cache
          const transaction = this.db.transaction([this.CONTENT_STORE], 'readonly');
          const store = transaction.objectStore(this.CONTENT_STORE);
          const request = store.get(originalUrl);

          request.onsuccess = () => {
            const cachedContent = request.result as CachedContent;
            
            if (cachedContent) {
              // Content is in cache
              this.logService.debug(`Content found in cache: ${originalUrl}`);
              
              // If the cached blob is available, create a new blob URL
              if (cachedContent.blob) {
                try {
                  // Create a new blob URL from the stored blob
                  const newLocalUrl = URL.createObjectURL(cachedContent.blob);
                  
                  // Update the cache entry with the new URL
                  this.updateCachedUrl(originalUrl, newLocalUrl);
                  
                  // Track this blob URL
                  this.blobCache.set(originalUrl, newLocalUrl);
                  
                  observer.next(newLocalUrl);
                  observer.complete();
                } catch (error) {
                  this.logService.error(`Error creating blob URL: ${error}`);
                  // Fall back to original URL on error
                  observer.next(originalUrl);
                  observer.complete();
                }
              } else {
                // If we don't have the blob stored (old cache format), download again
                this.downloadContent(originalUrl).subscribe(
                  localUrl => {
                    observer.next(localUrl);
                    observer.complete();
                  },
                  error => {
                    this.logService.error(`Failed to download content: ${error.message}`);
                    observer.next(originalUrl); // Fall back to original URL
                    observer.complete();
                  }
                );
              }
            } else {
              // Content not in cache, download it
              this.downloadContent(originalUrl).subscribe(
                localUrl => {
                  observer.next(localUrl);
                  observer.complete();
                },
                error => {
                  this.logService.error(`Failed to download content: ${error.message}`);
                  observer.next(originalUrl); // Fall back to original URL
                  observer.complete();
                }
              );
            }
          };

          request.onerror = (event) => {
            this.logService.error(`Error checking cache: ${(event.target as any).error}`);
            observer.next(originalUrl); // Fall back to original URL
            observer.complete();
          };
        } catch (error) {
          this.logService.error(`Exception in getLocalContentUrl: ${error}`);
          observer.next(originalUrl); // Fall back to original URL
          observer.complete();
        }
      }).catch(error => {
        this.logService.error(`Database initialization failed: ${error}`);
        observer.next(originalUrl); // Fall back to original URL
        observer.complete();
      });
    });
  }

  /**
   * Update the cached URL for a content item
   */
  private updateCachedUrl(url: string, newLocalUrl: string): void {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction([this.CONTENT_STORE], 'readwrite');
      const store = transaction.objectStore(this.CONTENT_STORE);
      
      const request = store.get(url);
      
      request.onsuccess = () => {
        const cachedContent = request.result as CachedContent;
        if (cachedContent) {
          // Release the old blob URL if it exists and is different
          if (cachedContent.localUrl && 
              cachedContent.localUrl !== newLocalUrl && 
              cachedContent.localUrl.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(cachedContent.localUrl);
            } catch (e) {
              // Ignore errors when revoking old URLs
            }
          }
          
          // Update with new URL
          cachedContent.localUrl = newLocalUrl;
          store.put(cachedContent);
        }
      };

      request.onerror = (event) => {
        this.logService.error(`Error updating cached URL: ${(event.target as any).error}`);
      };
    } catch (error) {
      this.logService.error(`Exception updating cached URL: ${error}`);
    }
  }

  /**
   * Preload content without waiting for the result
   */
  preloadContent(url: string): void {
    if (!url || typeof url !== 'string') {
      return;
    }

    this.getLocalContentUrl(url).subscribe(
      () => {
        // Content is now cached
        this.logService.debug(`Content preloaded: ${url}`);
      },
      error => {
        this.logService.error(`Failed to preload content: ${error.message}`);
      }
    );
  }

  /**
   * Download content and store in IndexedDB
   */
  private downloadContent(url: string): Observable<string> {
    if (!url || typeof url !== 'string') {
      return throwError('Invalid URL provided');
    }

    return this.http.get(url, { responseType: 'blob' }).pipe(
      retry(2), // Retry failed downloads up to 2 times
      tap(blob => {
        this.logService.info(`Downloaded content: ${url}, size: ${blob.size} bytes`);
      }),
      map(blob => {
        // Store the blob in IndexedDB
        const localUrl = URL.createObjectURL(blob);
        this.storeContent(url, localUrl, blob);
        
        // Track this blob URL
        this.blobCache.set(url, localUrl);
        
        return localUrl;
      }),
      catchError(error => {
        this.logService.error(`Error downloading content: ${error.message}`);
        throw error;
      })
    );
  }

  /**
   * Store a content blob in IndexedDB
   */
  private storeContent(url: string, localUrl: string, blob: Blob): void {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction([this.CONTENT_STORE], 'readwrite');
      const store = transaction.objectStore(this.CONTENT_STORE);
      
      const contentEntry: CachedContent = {
        url,
        localUrl,
        size: blob.size,
        timestamp: Date.now(),
        type: blob.type,
        blob: blob // Store the actual blob for future use
      };
      
      store.put(contentEntry);
      
      transaction.oncomplete = () => {
        this.logService.debug(`Content stored in cache: ${url}`);
        // Update cache size
        this.cacheSizeBytes += blob.size;
        
        // If cache is too large, trim it
        if (this.cacheSizeBytes > this.MAX_CACHE_SIZE) {
          this.trimCache();
        }
      };
      
      transaction.onerror = (event) => {
        this.logService.error(`Error storing content in cache: ${(event.target as any).error}`);
      };
    } catch (error) {
      this.logService.error(`Exception storing content in cache: ${error}`);
    }
  }

  /**
   * Delete the oldest content from cache to make room for new content
   */
  private trimCache(): void {
    if (!this.db) return;

    try {
      this.logService.info('Trimming content cache...');
      
      const transaction = this.db.transaction([this.CONTENT_STORE], 'readwrite');
      const store = transaction.objectStore(this.CONTENT_STORE);
      const index = store.index('timestamp');
      
      // Get all content sorted by timestamp
      const request = index.openCursor();
      let deletedSize = 0;
      const targetSize = this.MAX_CACHE_SIZE * 0.7; // Trim to 70% of max
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
        
        if (cursor && this.cacheSizeBytes - deletedSize > targetSize) {
          const content = cursor.value as CachedContent;
          
          try {
            // Delete from store
            store.delete(content.url);
            deletedSize += content.size;
            
            // Release the blob URL and remove from tracking map
            if (content.localUrl && content.localUrl.startsWith('blob:')) {
              try {
                URL.revokeObjectURL(content.localUrl);
              } catch (e) {
                // Ignore errors when revoking URLs
              }
            }
            
            this.blobCache.delete(content.url);
            this.logService.debug(`Removed from cache: ${content.url}`);
          } catch (e) {
            // Log but continue with the next item
            this.logService.error(`Error removing item from cache: ${e}`);
          }
          
          cursor.continue();
        } else {
          this.cacheSizeBytes -= deletedSize;
          this.logService.info(`Trimmed ${(deletedSize / (1024 * 1024)).toFixed(2)} MB from cache`);
        }
      };

      request.onerror = (event) => {
        this.logService.error(`Error trimming cache: ${(event.target as any).error}`);
      };
    } catch (error) {
      this.logService.error(`Exception trimming cache: ${error}`);
    }
  }

  /**
   * Cache a playlist for offline use
   */
  cachePlaylist(playlist: Playlist): void {
    if (!this.db || !playlist) return;

    this.ensureInitialized().then(initialized => {
      if (!initialized) return;

      try {
        const transaction = this.db!.transaction([this.PLAYLIST_STORE], 'readwrite');
        const store = transaction.objectStore(this.PLAYLIST_STORE);
        
        // Add timestamp for cache management
        const playlistEntry = {
          ...playlist,
          timestamp: Date.now()
        };
        
        store.put(playlistEntry);
        
        transaction.oncomplete = () => {
          this.logService.info(`Playlist cached: ${playlist.id} - ${playlist.name}`);
          
          // Preload all content for this playlist
          if (playlist.items?.length) {
            playlist.items.forEach(item => {
              if (item.content?.url) {
                this.preloadContent(item.content.url);
              }
              if (item.content?.thumbnail) {
                this.preloadContent(item.content.thumbnail);
              }
            });
          }
        };

        transaction.onerror = (event) => {
          this.logService.error(`Error caching playlist: ${(event.target as any).error}`);
        };
      } catch (error) {
        this.logService.error(`Exception caching playlist: ${error}`);
      }
    });
  }

  /**
   * Get a cached playlist by ID
   */
  getCachedPlaylist(id: string): Observable<Playlist | null> {
    if (!id) {
      return of(null);
    }

    return new Observable<Playlist | null>(observer => {
      this.ensureInitialized().then(initialized => {
        if (!initialized || !this.db) {
          observer.next(null);
          observer.complete();
          return;
        }

        try {
          const transaction = this.db!.transaction([this.PLAYLIST_STORE], 'readonly');
          const store = transaction.objectStore(this.PLAYLIST_STORE);
          const request = store.get(id);
          
          request.onsuccess = () => {
            if (request.result) {
              const playlist = request.result as Playlist;
              observer.next(playlist);
            } else {
              observer.next(null);
            }
            observer.complete();
          };
          
          request.onerror = (event) => {
            this.logService.error(`Error getting cached playlist: ${(event.target as any).error}`);
            observer.next(null);
            observer.complete();
          };
        } catch (error) {
          this.logService.error(`Exception getting cached playlist: ${error}`);
          observer.next(null);
          observer.complete();
        }
      }).catch(error => {
        this.logService.error(`Database initialization failed when getting playlist: ${error}`);
        observer.next(null);
        observer.complete();
      });
    });
  }

  /**
   * Get the fallback playlist for offline use
   */
  getFallbackPlaylist(): Observable<Playlist | null> {
    // Try to get a playlist from local assets as a fallback
    return this.http.get<Playlist>(`/assets/fallback/fallback-playlist.json`).pipe(
      catchError(() => {
        // If local file doesn't exist, check cache for newest playlist
        if (!this.db) {
          return of(null);
        }
        
        return from(new Promise<Playlist | null>((resolve) => {
          this.ensureInitialized().then(initialized => {
            if (!initialized) {
              resolve(null);
              return;
            }

            try {
              const transaction = this.db!.transaction([this.PLAYLIST_STORE], 'readonly');
              const store = transaction.objectStore(this.PLAYLIST_STORE);
              const index = store.index('timestamp');
              const request = index.openCursor(null, 'prev'); // Get newest first
              
              request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                  resolve(cursor.value as Playlist);
                } else {
                  resolve(null);
                }
              };
              
              request.onerror = () => {
                this.logService.error('Error getting fallback playlist from cache');
                resolve(null);
              };
            } catch (error) {
              this.logService.error(`Exception getting fallback playlist: ${error}`);
              resolve(null);
            }
          }).catch(() => {
            resolve(null);
          });
        }));
      })
    );
  }

  /**
   * Clear all cached content and playlists
   */
  clearCache(): Observable<boolean> {
    if (!this.db) {
      return of(false);
    }

    return new Observable<boolean>(observer => {
      this.ensureInitialized().then(initialized => {
        if (!initialized) {
          observer.next(false);
          observer.complete();
          return;
        }

        try {
          // First get all content to revoke blob URLs
          let transaction = this.db!.transaction([this.CONTENT_STORE], 'readonly');
          const contentStore = transaction.objectStore(this.CONTENT_STORE);
          const getAllRequest = contentStore.getAll();
          
          getAllRequest.onsuccess = () => {
            const allContent = getAllRequest.result as CachedContent[];
            
            // Revoke all blob URLs
            allContent.forEach(content => {
              try {
                if (content.localUrl && content.localUrl.startsWith('blob:')) {
                  URL.revokeObjectURL(content.localUrl);
                }
                this.blobCache.delete(content.url);
              } catch (e) {
                // Ignore errors when revoking URLs
              }
            });
            
            // Now clear both stores
            transaction = this.db!.transaction([this.CONTENT_STORE, this.PLAYLIST_STORE], 'readwrite');
            const contentStore2 = transaction.objectStore(this.CONTENT_STORE);
            const playlistStore = transaction.objectStore(this.PLAYLIST_STORE);
            
            const clearContentRequest = contentStore2.clear();
            clearContentRequest.onsuccess = () => {
              const clearPlaylistRequest = playlistStore.clear();
              clearPlaylistRequest.onsuccess = () => {
                this.logService.info('Cache cleared successfully');
                this.cacheSizeBytes = 0;
                observer.next(true);
                observer.complete();
              };
              
              clearPlaylistRequest.onerror = (event) => {
                this.logService.error(`Error clearing playlist cache: ${(event.target as any).error}`);
                observer.next(false);
                observer.complete();
              };
            };
            
            clearContentRequest.onerror = (event) => {
              this.logService.error(`Error clearing content cache: ${(event.target as any).error}`);
              observer.next(false);
              observer.complete();
            };
          };
          
          getAllRequest.onerror = (event) => {
            this.logService.error(`Error getting cached content for cleanup: ${(event.target as any).error}`);
            observer.next(false);
            observer.complete();
          };
        } catch (error) {
          this.logService.error(`Exception clearing cache: ${error}`);
          observer.next(false);
          observer.complete();
        }
      }).catch(error => {
        this.logService.error(`Database initialization failed when clearing cache: ${error}`);
        observer.next(false);
        observer.complete();
      });
    });
  }

  /**
   * Get the current cache size in bytes
   */
  getCacheSize(): number {
    return this.cacheSizeBytes;
  }

  /**
   * Get all cached playlists
   */
  getAllCachedPlaylists(): Observable<Playlist[]> {
    return new Observable<Playlist[]>(observer => {
      this.ensureInitialized().then(initialized => {
        if (!initialized || !this.db) {
          observer.next([]);
          observer.complete();
          return;
        }

        try {
          const transaction = this.db!.transaction([this.PLAYLIST_STORE], 'readonly');
          const store = transaction.objectStore(this.PLAYLIST_STORE);
          const request = store.getAll();
          
          request.onsuccess = () => {
            observer.next(request.result as Playlist[]);
            observer.complete();
          };
          
          request.onerror = (event) => {
            this.logService.error(`Error getting all cached playlists: ${(event.target as any).error}`);
            observer.next([]);
            observer.complete();
          };
        } catch (error) {
          this.logService.error(`Exception getting all cached playlists: ${error}`);
          observer.next([]);
          observer.complete();
        }
      }).catch(error => {
        this.logService.error(`Database initialization failed when getting all playlists: ${error}`);
        observer.next([]);
        observer.complete();
      });
    });
  }

  /**
   * Delete a specific cached item
   */
  deleteFromCache(url: string): Observable<boolean> {
    if (!this.db) {
      return of(false);
    }

    return new Observable<boolean>(observer => {
      this.ensureInitialized().then(initialized => {
        if (!initialized) {
          observer.next(false);
          observer.complete();
          return;
        }

        try {
          const transaction = this.db!.transaction([this.CONTENT_STORE], 'readwrite');
          const store = transaction.objectStore(this.CONTENT_STORE);
          
          // First get the item to know its size
          const getRequest = store.get(url);
          
          getRequest.onsuccess = () => {
            const cachedContent = getRequest.result as CachedContent;
            
            if (cachedContent) {
              // Release the blob URL
              try {
                if (cachedContent.localUrl && cachedContent.localUrl.startsWith('blob:')) {
                  URL.revokeObjectURL(cachedContent.localUrl);
                }
                this.blobCache.delete(url);
              } catch (e) {
                // Ignore errors when revoking URLs
              }
              
              // Delete from store
              const deleteRequest = store.delete(url);
              
              deleteRequest.onsuccess = () => {
                // Update cache size
                this.cacheSizeBytes -= cachedContent.size;
                this.logService.debug(`Deleted from cache: ${url}`);
                observer.next(true);
                observer.complete();
              };
              
              deleteRequest.onerror = (event) => {
                this.logService.error(`Error deleting from cache: ${(event.target as any).error}`);
                observer.next(false);
                observer.complete();
              };
            } else {
              // Item not found
              this.logService.debug(`Item not found in cache: ${url}`);
              observer.next(false);
              observer.complete();
            }
          };
          
          getRequest.onerror = (event) => {
            this.logService.error(`Error getting item from cache: ${(event.target as any).error}`);
            observer.next(false);
            observer.complete();
          };
        } catch (error) {
          this.logService.error(`Exception deleting from cache: ${error}`);
          observer.next(false);
          observer.complete();
        }
      }).catch(error => {
        this.logService.error(`Database initialization failed when deleting from cache: ${error}`);
        observer.next(false);
        observer.complete();
      });
    });
  }

  /**
   * Delete a cached playlist
   */
  deleteCachedPlaylist(id: string): Observable<boolean> {
    if (!this.db) {
      return of(false);
    }

    return new Observable<boolean>(observer => {
      this.ensureInitialized().then(initialized => {
        if (!initialized) {
          observer.next(false);
          observer.complete();
          return;
        }

        try {
          const transaction = this.db!.transaction([this.PLAYLIST_STORE], 'readwrite');
          const store = transaction.objectStore(this.PLAYLIST_STORE);
          
          const deleteRequest = store.delete(id);
          
          deleteRequest.onsuccess = () => {
            this.logService.debug(`Deleted playlist from cache: ${id}`);
            observer.next(true);
            observer.complete();
          };
          
          deleteRequest.onerror = (event) => {
            this.logService.error(`Error deleting playlist from cache: ${(event.target as any).error}`);
            observer.next(false);
            observer.complete();
          };
        } catch (error) {
          this.logService.error(`Exception deleting playlist from cache: ${error}`);
          observer.next(false);
          observer.complete();
        }
      }).catch(error => {
        this.logService.error(`Database initialization failed when deleting playlist: ${error}`);
        observer.next(false);
        observer.complete();
      });
    });
  }

  

  /**
   * Get statistics about the cache
   */
  getCacheStats(): Observable<{
    totalSize: number;
    itemCount: number;
    playlistCount: number;
    oldestItem: Date | null;
    newestItem: Date | null;
  }> {
    if (!this.db) {
      return of({
        totalSize: 0,
        itemCount: 0,
        playlistCount: 0,
        oldestItem: null,
        newestItem: null
      });
    }

    return new Observable(observer => {
      this.ensureInitialized().then(initialized => {
        if (!initialized) {
          observer.next({
            totalSize: 0,
            itemCount: 0,
            playlistCount: 0,
            oldestItem: null,
            newestItem: null
          });
          observer.complete();
          return;
        }

        try {
          // Get content stats
          const contentTransaction = this.db!.transaction([this.CONTENT_STORE], 'readonly');
          const contentStore = contentTransaction.objectStore(this.CONTENT_STORE);
          const contentRequest = contentStore.getAll();
          
          contentRequest.onsuccess = () => {
            const contentItems = contentRequest.result as CachedContent[];
            
            // Get playlist stats
            const playlistTransaction = this.db!.transaction([this.PLAYLIST_STORE], 'readonly');
            const playlistStore = playlistTransaction.objectStore(this.PLAYLIST_STORE);
            const playlistRequest = playlistStore.count();
            
            playlistRequest.onsuccess = () => {
              const playlistCount = playlistRequest.result;
              
              // Calculate stats
              const totalSize = contentItems.reduce((total, item) => total + item.size, 0);
              const timestamps = contentItems.map(item => item.timestamp);
              
              const stats = {
                totalSize,
                itemCount: contentItems.length,
                playlistCount,
                oldestItem: timestamps.length ? new Date(Math.min(...timestamps)) : null,
                newestItem: timestamps.length ? new Date(Math.max(...timestamps)) : null
              };
              
              observer.next(stats);
              observer.complete();
            };
            
            playlistRequest.onerror = (event) => {
              this.logService.error(`Error getting playlist count: ${(event.target as any).error}`);
              observer.error('Failed to get cache statistics');
            };
          };
          
          contentRequest.onerror = (event) => {
            this.logService.error(`Error getting content items: ${(event.target as any).error}`);
            observer.error('Failed to get cache statistics');
          };
        } catch (error) {
          this.logService.error(`Exception getting cache statistics: ${error}`);
          observer.error('Failed to get cache statistics');
        }
      }).catch(error => {
        this.logService.error(`Database initialization failed when getting cache stats: ${error}`);
        observer.error('Failed to get cache statistics');
      });
    });
  }

  /**
   * Clean up resources when the service is destroyed
   */
  ngOnDestroy(): void {
    // Revoke all blob URLs to prevent memory leaks
    for (const url of this.blobCache.values()) {
      try {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        // Ignore errors when revoking URLs
      }
    }
    this.blobCache.clear();
    
    // Close the database connection
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {
        // Ignore errors when closing database
      }
    }
  }
}