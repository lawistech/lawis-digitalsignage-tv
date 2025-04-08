// playback.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, Subject, timer } from 'rxjs';
import { catchError, map, switchMap, take, tap } from 'rxjs/operators';
import { ContentSyncService } from './content-sync.service';
import { LogService } from './log.service';
import { SupabaseApiService } from './supabase-api.service';
import { PlayerState } from '../models/player-state.model';
import { Playlist, PlaylistItem } from '../models/playlist.model';
import { environment } from '../../../environments/environment';
import { supabase } from './supabase.config';
import { ScheduleService } from './schedule.service';

interface PlaylistScheduleItem {
  playlist_id: string;
  start_time: string;
  end_time: string;
  priority: number;
  days_of_week?: string[]; // Make this optional
}

@Injectable({
  providedIn: 'root'
})
export class PlaybackService {
  // Expose Observables for the player component to subscribe to
  currentItem$ = new BehaviorSubject<PlaylistItem | null>(null);
  nextItem$ = new BehaviorSubject<PlaylistItem | null>(null);
  isTransitioning$ = new BehaviorSubject<boolean>(false);
  playbackError$ = new BehaviorSubject<string | null>(null);
  
  // Player state information
  private playerStateSubject = new BehaviorSubject<PlayerState>({
    isPlaying: false,
    isOnline: true,
    currentPlaylistId: null,
    currentPlaylistName: '',
    currentItemIndex: 0,
    totalItems: 0,
    lastUpdated: new Date()
  });
  playerState$ = this.playerStateSubject.asObservable();
  
  // Internal state
  private currentPlaylist: Playlist | null = null;
  private currentIndex = 0;
  private isPlaying = false;
  private autoAdvance = true;
  private retryCount = 0;
  private maxRetries = 3;
  private currentTransitionTimeout: any = null;
  private realtimeChannel: any = null;
  
  constructor(
    private supabaseApi: SupabaseApiService,
    private contentSyncService: ContentSyncService,
    private logService: LogService,
    private scheduleService: ScheduleService 
  ) {
    // Set up subscription to device screen ID from local storage
    this.setup();
  }
  
  private setup(): void {
    // Get the device ID from local storage
    const deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      this.logService.error('No device ID found in local storage');
      this.playbackError$.next('Device not registered. Please register this device first.');
      return;
    }
    
    // Subscribe to real-time updates for this screen
    this.setupRealtimeSubscription(deviceId);
    
    // Also subscribe to playlist changes
    this.setupPlaylistSubscription();
  }
  
  // In playback.service.ts
  private setupRealtimeSubscription(deviceId: string): void {
    // First, unsubscribe from any existing channel
    if (this.realtimeChannel) {
      this.realtimeChannel.unsubscribe();
    }
    
    // Create a new subscription
    this.realtimeChannel = supabase
      .channel('screens_channel')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'screens',
          filter: `id=eq.${deviceId}`
        },
        (payload: { new: any; old: any }) => {
          // Handle screen updates
          this.logService.info('Received screen update from server');
          
          const newData = payload.new;
          const oldData = payload.old;
          
          // Check if the schedule has changed
          if (JSON.stringify(newData.schedule) !== JSON.stringify(oldData.schedule)) {
            this.logService.info('Screen schedule has been updated');
            
            // Trigger an immediate schedule check
            this.checkScheduleImmediately();
          }
          
          // Check if the playlist has changed
          if (newData.current_playlist !== oldData.current_playlist) {
            this.logService.info(`Playlist changed from ${oldData.current_playlist} to ${newData.current_playlist}`);
            
            // Load the new playlist immediately
            if (newData.current_playlist) {
              this.loadPlaylist(newData.current_playlist);
            }
          }
        }
      )
      .subscribe();
      
    // Log successful subscription
    this.logService.info(`Subscribed to real-time updates for screen ID: ${deviceId}`);
  }

  // Add this method to check schedules immediately on demand
  private checkScheduleImmediately(): void {
    if (!this.scheduleService) return;
    
    this.logService.info('Performing immediate schedule check');
    this.scheduleService.checkSchedule().subscribe(
      (changed: boolean) => { // Add explicit type for 'changed'
        if (changed) {
          this.logService.info('Schedule change detected, reloading playlist');
          this.reloadPlaylist();
        }
      },
      (error: any) => { // Add explicit type for 'error'
        this.logService.error(`Error in immediate schedule check: ${error.message}`);
      }
    );
  }
  
  // Subscribe to changes in playlists (for content updates)
  private setupPlaylistSubscription(): void {
    supabase
      .channel('playlists_channel')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'playlists'
        },
        (payload: { new: any; old: any; eventType: string }) => {
          // Only process if we have a current playlist
          if (!this.currentPlaylist) return;
          
          // Handle different event types
          if (payload.eventType === 'UPDATE' && 
              payload.new.id === this.currentPlaylist.id) {
            
            this.logService.info(`Current playlist updated: ${payload.new.name}`);
            
            // Reload the current playlist to get updated content
            this.loadPlaylist(payload.new.id);
          }
        }
      )
      .subscribe();
      
    // Also subscribe to playlist_items changes
    supabase
      .channel('playlist_items_channel')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for all events
          schema: 'public',
          table: 'playlist_items'
        },
        (payload: { new: any; old: any; eventType: string }) => {
          // Only process if we have a current playlist
          if (!this.currentPlaylist) return;
          
          // For item changes, we need to check if it's part of our current playlist
          if (payload.new && payload.new.playlist_id === this.currentPlaylist.id) {
            this.logService.info(`Playlist item changed for current playlist`);
            
            // Reload the current playlist to get updated items
            this.loadPlaylist(this.currentPlaylist.id);
          } else if (payload.old && payload.old.playlist_id === this.currentPlaylist.id) {
            // Item was removed or reassigned from our playlist
            this.logService.info(`Playlist item removed from current playlist`);
            
            // Reload the current playlist
            this.loadPlaylist(this.currentPlaylist.id);
          }
        }
      )
      .subscribe();
      
    this.logService.info('Subscribed to real-time updates for playlists and playlist items');
  }
  
  // Start playback process
  // In playback.service.ts
  startPlayback(): void {
    // First check if we already have a device ID
    const deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      this.logService.error('Device not registered. Cannot start playback.');
      this.playbackError$.next('Device not registered');
      return;
    }
    
    // Get screen info from Supabase to determine which playlist to play
    this.supabaseApi.getScreenById(deviceId).pipe(
      switchMap(screen => {
        if (!screen) {
          return of({ playlistId: null });
        }

        // Priority 1: Check schedule for current time
        if (screen.schedule && screen.schedule.upcoming && screen.schedule.upcoming.length > 0) {
          const now = new Date();
          const currentTime = now.toTimeString().slice(0, 5); // Format: "HH:MM"
          const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
          
          // Sort schedules by priority first, then start_time
          const sortedSchedules = [...screen.schedule.upcoming].sort((a: PlaylistScheduleItem, b: PlaylistScheduleItem) => {
            // First sort by priority (lower number = higher priority)
            if (a.priority !== b.priority) {
              return a.priority - b.priority;
            }
            // Then sort by start_time
            return a.start_time.localeCompare(b.start_time);
          });
          
          // Find currently active schedule
          // In playback.service.ts, modify the schedule check code:
          const activeSchedule = sortedSchedules.find((schedule: PlaylistScheduleItem) => {
            const days = schedule.days_of_week || 
                        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            
            return days.includes(currentDay) && 
                   currentTime >= schedule.start_time && 
                   currentTime <= schedule.end_time;
          });
          
          if (activeSchedule) {
            this.logService.info(`Found active schedule for playlist: ${activeSchedule.playlist_id}`);
            return of({ playlistId: activeSchedule.playlist_id });
          }
        }
        
        // Priority 2: Use current_playlist assigned to the screen
        if (screen.current_playlist) {
          this.logService.info(`Using screen's current playlist: ${screen.current_playlist}`);
          return of({ playlistId: screen.current_playlist });
        }
        
        // Priority 3: Check area_screens for a playlist
        return this.supabaseApi.getScreenArea(deviceId).pipe(
          map(area => {
            if (area && area.current_playlist) {
              this.logService.info(`Using area's playlist: ${area.current_playlist}`);
              return { playlistId: area.current_playlist };
            }
            return { playlistId: null };
          })
        );
      }),
      catchError(error => {
        this.logService.error(`Error fetching screen info: ${error.message}`);
        this.playbackError$.next('Could not fetch screen information');
        return of({ playlistId: null });
      })
    ).subscribe(result => {
      if (result.playlistId) {
        this.loadPlaylist(result.playlistId);
      } else {
        this.playbackError$.next('No playlist assigned to this screen');
      }
    });
  }
  
  // Load a playlist by ID
  // In playback.service.ts
  loadPlaylist(playlistId: string): void {
    if (!playlistId) {
      this.logService.error('No playlist ID provided');
      this.playbackError$.next('No playlist ID provided');
      return;
    }
    
    this.logService.info(`Loading playlist: ${playlistId}`);
    
    // Cancel any pending transitions
    this.clearTransition();
    
    // Mark as loading in player state
    this.updatePlayerState({
      isPlaying: false,
      currentPlaylistId: playlistId,
      currentPlaylistName: 'Loading...',
      currentItemIndex: 0,
      totalItems: 0
    });
    
    // First check if playlist is already in cache
    this.contentSyncService.getCachedPlaylist(playlistId).pipe(
      switchMap(cachedPlaylist => {
        if (cachedPlaylist) {
          // We have it cached, but still fetch fresh version in background
          this.logService.info(`Using cached playlist: ${playlistId}`);
          
          // Start playing immediately from cache
          this.processPlaylist(cachedPlaylist);
          
          // Also fetch fresh version in background
          return this.supabaseApi.getPlaylistById(playlistId).pipe(
            tap(freshPlaylist => {
              if (freshPlaylist) {
                // Update cache for next time
                this.contentSyncService.cachePlaylist(freshPlaylist);
                
                // If we're already playing, don't disrupt playback
                // Just log that we have updated the cache
                this.logService.info(`Updated cached playlist: ${playlistId}`);
              }
            }),
            catchError(error => {
              // Just log error, already playing from cache
              this.logService.warn(`Failed to update playlist cache: ${error.message}`);
              return of(null);
            })
          );
        }
        
        // Not in cache, need to fetch from API
        return this.supabaseApi.getPlaylistById(playlistId).pipe(
          tap(playlist => {
            if (playlist) {
              // Cache the playlist for offline use
              this.contentSyncService.cachePlaylist(playlist);
              // Process and play
              this.processPlaylist(playlist);
            }
          }),
          catchError(error => {
            this.logService.error(`Error loading playlist: ${error.message}`);
            this.playbackError$.next(`Failed to load playlist: ${error.message}`);
            
            // Try to load a cached version if available
            return this.contentSyncService.getCachedPlaylist(playlistId).pipe(
              tap(fallbackPlaylist => {
                if (fallbackPlaylist) {
                  this.logService.info(`Loaded fallback playlist from cache: ${playlistId}`);
                  this.processPlaylist(fallbackPlaylist);
                } else {
                  // If all fails, show error and try to load any fallback
                  this.loadFallbackContent();
                }
              }),
              catchError(() => {
                // If all fails, return null
                this.loadFallbackContent();
                return of(null);
              })
            );
          })
        );
      })
    ).subscribe();
  }

  // New helper method to process playlists
  private processPlaylist(playlist: Playlist): void {
    if (playlist && playlist.items && playlist.items.length > 0) {
      this.currentPlaylist = playlist;
      this.currentIndex = 0;
      this.playbackError$.next(null);
      
      // Start preloading all content
      this.preloadAllContent(playlist);
      
      // Update player state
      this.updatePlayerState({
        isPlaying: true,
        currentPlaylistId: playlist.id,
        currentPlaylistName: playlist.name,
        currentItemIndex: 0,
        totalItems: playlist.items.length
      });
      
      // Start playing
      this.playCurrentItem();
    } else {
      this.logService.error('Playlist is empty or could not be loaded');
      this.playbackError$.next('Playlist is empty or could not be loaded');
      
      // Try to load a fallback playlist
      this.loadFallbackContent();
    }
  }

  // New method to preload all content in a playlist
  private preloadAllContent(playlist: Playlist): void {
    if (!playlist || !playlist.items || playlist.items.length === 0) return;
    
    this.logService.info(`Preloading ${playlist.items.length} items from playlist`);
    
    // Start preloading all items in the background
    for (const item of playlist.items) {
      if (item.content?.url) {
        this.contentSyncService.preloadContent(item.content.url);
      }
      if (item.content?.thumbnail) {
        this.contentSyncService.preloadContent(item.content.thumbnail);
      }
    }
  }
  
  // Reload the current playlist
  reloadPlaylist(): void {
    if (this.currentPlaylist) {
      this.loadPlaylist(this.currentPlaylist.id);
    } else {
      this.startPlayback(); // Start fresh
    }
  }
  
  // Play the current item
  private playCurrentItem(): void {
    if (!this.currentPlaylist || !this.currentPlaylist.items.length) {
      this.logService.error('No playlist or empty playlist');
      return;
    }
    
    const item = this.currentPlaylist.items[this.currentIndex];
    
    // Preload the next item
    this.preloadNextItem();
    
    // Add this check to make sure the transition is completed
    this.isTransitioning$.next(false);
    
    // Set the current item
    this.currentItem$.next(null); // First set to null to force Angular change detection
    setTimeout(() => {
      this.currentItem$.next(item); // Then set the new item in next tick
    }, 0);
    
    // Update player state
    this.updatePlayerState({
      isPlaying: true,
      currentItemIndex: this.currentIndex
    });
    
    this.logService.info(`Playing item: ${item.name} (${this.currentIndex + 1}/${this.currentPlaylist.items.length})`);
  }
  
  // Preload the next item
  private preloadNextItem(): void {
    if (!this.currentPlaylist || !this.currentPlaylist.items.length) {
      return;
    }
    
    // Determine the next index
    const nextIndex = (this.currentIndex + 1) % this.currentPlaylist.items.length;
    const nextItem = this.currentPlaylist.items[nextIndex];
    
    // Set the next item for preloading
    this.nextItem$.next(nextItem);
    
    // Preload the content
    if (nextItem) {
      this.contentSyncService.preloadContent(nextItem.content.url);
      if (nextItem.content.thumbnail) {
        this.contentSyncService.preloadContent(nextItem.content.thumbnail);
      }
    }
  }
  
  // Clear any pending transition timeouts
  private clearTransition(): void {
    if (this.currentTransitionTimeout) {
      clearTimeout(this.currentTransitionTimeout);
      this.currentTransitionTimeout = null;
    }
    this.isTransitioning$.next(false);
  }
  
  // Skip to next item
  skipToNext(): void {
    if (!this.currentPlaylist || !this.currentPlaylist.items.length) {
      return;
    }
    
    // Add this line to debug
    this.logService.info(`Skipping to next. Current index: ${this.currentIndex}, next index: ${(this.currentIndex + 1) % this.currentPlaylist.items.length}`);
    
    // Clear any existing transition
    this.clearTransition();
    
    // Start transition
    this.isTransitioning$.next(true);
    
    // Wait for transition duration
    const transitionDuration = this.getTransitionDuration();
    
    // Store the reference to the timeout
    this.currentTransitionTimeout = setTimeout(() => {
      // Move to the next item
      this.currentIndex = (this.currentIndex + 1) % this.currentPlaylist!.items.length;
      
      // Add another debug statement
      this.logService.info(`Transition complete. Now at index: ${this.currentIndex}`);
      
      // End transition
      this.isTransitioning$.next(false);
      
      // Play the new current item
      this.playCurrentItem();
      
      // Clear the timeout reference
      this.currentTransitionTimeout = null;
    }, transitionDuration);
  }
  
  // Get transition duration based on current item settings
  private getTransitionDuration(): number {
    const currentItem = this.currentItem$.value;
    
    if (currentItem && currentItem.settings && currentItem.settings.transition !== 'none') {
      return currentItem.settings.transitionDuration * 1000 || 500; // Default 500ms
    }
    
    return 0; // No transition
  }
  
  // Restart playback from the beginning of the playlist
  restartPlayback(): void {
    // Clear any existing transition
    this.clearTransition();
    
    this.currentIndex = 0;
    this.playCurrentItem();
  }
  
  // Pause playback
  pausePlayback(): void {
    this.isPlaying = false;
    this.updatePlayerState({ isPlaying: false });
  }
  
  // Resume playback
  resumePlayback(): void {
    this.isPlaying = true;
    this.updatePlayerState({ isPlaying: true });
  }
  
  // Load fallback content when primary content fails
  private loadFallbackContent(): void {
    this.logService.warn('Loading fallback content');
    
    // Try to load from local cache first
    this.contentSyncService.getFallbackPlaylist().subscribe(
      fallbackPlaylist => {
        if (fallbackPlaylist) {
          this.logService.info('Loaded fallback playlist from cache');
          this.currentPlaylist = fallbackPlaylist;
          this.currentIndex = 0;
          this.playbackError$.next(null);
          
          // Update player state
          this.updatePlayerState({
            isPlaying: true,
            currentPlaylistId: fallbackPlaylist.id,
            currentPlaylistName: `${fallbackPlaylist.name} (Fallback)`,
            currentItemIndex: 0,
            totalItems: fallbackPlaylist.items.length
          });
          
          // Start playing
          this.playCurrentItem();
        } else {
          // If no fallback playlist is available, show a static message
          this.logService.error('No fallback content available');
          this.playbackError$.next('No content available. Please check your connection or device configuration.');
        }
      },
      error => {
        this.logService.error(`Error loading fallback content: ${error}`);
        this.playbackError$.next('Failed to load any content. Please contact support.');
      }
    );
  }
  
  // Update the player state with partial changes
  private updatePlayerState(changes: Partial<PlayerState>): void {
    const currentState = this.playerStateSubject.value;
    this.playerStateSubject.next({
      ...currentState,
      ...changes,
      lastUpdated: new Date()
    });
  }
  
  // Clean up on service destroy
  ngOnDestroy(): void {
    this.clearTransition();
    
    // Clean up realtime subscriptions
    if (this.realtimeChannel) {
      this.realtimeChannel.unsubscribe();
      this.realtimeChannel = null;
    }
  }
}