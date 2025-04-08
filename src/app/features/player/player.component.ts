// player.component.ts
import { Component, OnInit, OnDestroy, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, Subscription, interval, fromEvent } from 'rxjs';
import { PlaybackService } from '../../core/services/playback.service';
import { ScheduleService } from '../../core/services/schedule.service';
import { HeartbeatService } from '../../core/services/heartbeat.service';
import { LogService } from '../../core/services/log.service';
import { SupabaseApiService } from '../../core/services/supabase-api.service';
import { PlaylistItem } from '../../core/models/playlist.model';
import { PlayerState } from '../../core/models/player-state.model';
import { ImageItemComponent } from './components/image-item.component';
import { VideoItemComponent } from './components/video-item.component';
import { WebItemComponent } from './components/web-item.component';
import { TickerItemComponent } from './components/ticker-item.component';

@Component({
  selector: 'app-player',
  standalone: true,
  imports: [
    CommonModule,
    ImageItemComponent, 
    VideoItemComponent, 
    WebItemComponent, 
    TickerItemComponent
  ],
  templateUrl: './player.component.html',
  styleUrls: ['./player.component.scss']
})
export class PlayerComponent implements OnInit, OnDestroy {
  currentItem: PlaylistItem | null = null;
  nextItem: PlaylistItem | null = null;
  isTransitioning = false;
  playerState$: Observable<PlayerState>;
  currentPlayerState: PlayerState | null = null;
  playbackError: string | null = null;
  isFullscreen = false;
  isOnline = navigator.onLine;
  
  private lastTimeCheck: number = 0;
  private preciseMinuteInterval: any = null;
  private transitionTimeoutIds: number[] = [];
  
  private subscriptions: Subscription[] = [];
  private heartbeatInterval: Subscription | null = null;
  private scheduleCheckInterval: Subscription | null = null;

  constructor(
    private playbackService: PlaybackService,
    private scheduleService: ScheduleService,
    private heartbeatService: HeartbeatService,
    private logService: LogService,
    private supabaseApi: SupabaseApiService,
    private router: Router,
    private elementRef: ElementRef
  ) {
    this.playerState$ = this.playbackService.playerState$;
    this.logService.setDebugLevel(0); // Set to lowest level for maximum verbosity
    this.logService.info('Player component initialized with verbose logging');
  }

  // Handle key presses (useful for debugging/admin functions)
  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Diagnostic key shortcuts (only active in development)
    if (event.altKey && event.key === 'd') {
      this.router.navigate(['/diagnostics']);
    }
    
    // Toggle fullscreen with F key
    if (event.key === 'f') {
      this.toggleFullscreen();
    }
    
    // Exit fullscreen with Escape key
    if (event.key === 'Escape') {
      this.exitFullscreen();
    }
    
    // Force reload the current playlist with R key
    if (event.key === 'r') {
      this.playbackService.reloadPlaylist();
    }
  }

  ngOnInit(): void {
    this.setupNetworkListeners();
    this.setupTimeChangeListeners();
    this.setupPlayback();
    this.setupScheduleChecking();
    this.startHeartbeat();
    
    // Ensure we're in fullscreen mode
    this.enterFullscreen();
    
    // Log player startup
    this.logService.info('Player started');
  }

  private setupTimeChangeListeners(): void {
    // Check when visibility changes (tab becomes active)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.logService.info('Tab became visible, checking schedule');
        this.checkScheduleAndReload();
      }
    });
    
    // Listen for time adjustments (not perfect but helps)
    const timeCheckInterval = setInterval(() => {
      const now = new Date();
      const nowSecs = Math.floor(now.getTime() / 1000);
      
      if (!this.lastTimeCheck) {
        this.lastTimeCheck = nowSecs;
      } else {
        // If more than 90 seconds have passed since our last 60-second check,
        // the clock might have been adjusted
        const diff = nowSecs - this.lastTimeCheck;
        if (diff > 90 || diff < 30) {
          this.logService.info(`Time jump detected (${diff}s), checking schedule`);
          this.checkScheduleAndReload();
        }
        this.lastTimeCheck = nowSecs;
      }
    }, 60000);
    
    // Fix the subscription push by creating a proper Subscription
    const subscription = new Subscription();
    subscription.add(() => clearInterval(timeCheckInterval));
    this.subscriptions.push(subscription);
  }

  ngOnDestroy(): void {
    // Clear all transition timeouts
    this.transitionTimeoutIds.forEach(id => clearTimeout(id));
    
    // Clean up all subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.heartbeatInterval) {
      this.heartbeatInterval.unsubscribe();
    }
    if (this.scheduleCheckInterval) {
      this.scheduleCheckInterval.unsubscribe();
    }
    if (this.preciseMinuteInterval) {
      clearInterval(this.preciseMinuteInterval);
    }
    this.logService.info('Player stopped');
  }
  
  private setupNetworkListeners(): void {
    // Listen for online/offline events
    const onlineSubscription = fromEvent(window, 'online').subscribe(() => {
      this.isOnline = true;
      this.logService.info('Network connection restored');
      
      // Force reload playlist when we come back online
      this.playbackService.reloadPlaylist();
    });
    
    const offlineSubscription = fromEvent(window, 'offline').subscribe(() => {
      this.isOnline = false;
      this.logService.warn('Network connection lost');
    });
    
    this.subscriptions.push(onlineSubscription, offlineSubscription);
  }

  // Toggle fullscreen
  toggleFullscreen(): void {
    if (this.isFullscreen) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
    }
  }

  // Enhanced fullscreen method with better cross-browser support
  enterFullscreen(): void {
    const elem = document.documentElement;
    
    try {
      this.logService.info('Attempting to enter fullscreen mode');
      
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if ((elem as any).mozRequestFullScreen) { // Firefox
        (elem as any).mozRequestFullScreen();
      } else if ((elem as any).webkitRequestFullscreen) { // Chrome, Safari and Opera
        (elem as any).webkitRequestFullscreen();
      } else if ((elem as any).msRequestFullscreen) { // IE/Edge
        (elem as any).msRequestFullscreen();
      }
      
      this.isFullscreen = true;
      this.logService.info('Entered fullscreen mode');
    } catch (error) {
      this.logService.warn(`Could not enter fullscreen mode: ${error}`);
    }
  }

  // Method to exit fullscreen
  exitFullscreen(): void {
    try {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).mozCancelFullScreen) { // Firefox
        (document as any).mozCancelFullScreen();
      } else if ((document as any).webkitExitFullscreen) { // Chrome, Safari and Opera
        (document as any).webkitExitFullscreen();
      } else if ((document as any).msExitFullscreen) { // IE/Edge
        (document as any).msExitFullscreen();
      }
      
      this.isFullscreen = false;
      this.logService.info('Exited fullscreen mode');
    } catch (error) {
      this.logService.warn(`Could not exit fullscreen mode: ${error}`);
    }
  }

  // Track fullscreen state changes
  @HostListener('document:fullscreenchange', ['$event'])
  @HostListener('document:webkitfullscreenchange', ['$event'])
  @HostListener('document:mozfullscreenchange', ['$event'])
  @HostListener('document:MSFullscreenChange', ['$event'])
  onFullscreenChange(): void {
    // Update the fullscreen state based on the document's fullscreen status
    this.isFullscreen = !!document.fullscreenElement || 
                       !!(document as any).webkitFullscreenElement || 
                       !!(document as any).mozFullScreenElement || 
                       !!(document as any).msFullscreenElement;
    
    this.logService.info(`Fullscreen state changed: ${this.isFullscreen ? 'enabled' : 'disabled'}`);
  }

  private setupPlayback(): void {
    // Subscribe to current item changes
    const currentItemSub = this.playbackService.currentItem$.subscribe(item => {
      this.currentItem = item;
      if (item) {
        this.logService.info(`Playing item: ${item.name}`);
      }
    });

    // Subscribe to next item changes
    const nextItemSub = this.playbackService.nextItem$.subscribe(item => {
      this.nextItem = item;
    });

    // Subscribe to transition state
    const transitionSub = this.playbackService.isTransitioning$.subscribe(transitioning => {
      this.isTransitioning = transitioning;
    });

    // Subscribe to errors
    const errorSub = this.playbackService.playbackError$.subscribe(error => {
      this.playbackError = error;
      if (error) {
        this.logService.error(`Playback error: ${error}`);
      }
    });
    
    // Subscribe to player state
    const playerStateSub = this.playerState$.subscribe(state => {
      this.currentPlayerState = state;
    });

    this.subscriptions.push(currentItemSub, nextItemSub, transitionSub, errorSub, playerStateSub);

    // Start playback
    this.playbackService.startPlayback();
  }

  private setupScheduleChecking(): void {
    // Initial check on startup with a small delay to ensure everything is loaded
    setTimeout(() => {
      this.logService.info('Performing initial schedule check');
      this.checkScheduleAndReload();
    }, 3000);
    
    // Check more frequently - every 20 seconds instead of every minute
    this.scheduleCheckInterval = interval(20000).subscribe(() => {
      const now = new Date();
      this.logService.debug(`Schedule check at ${now.toTimeString()}`);
      this.checkScheduleAndReload();
    });
    
    // Setup more precise checks exactly at scheduled times
    this.setupTargetedScheduleChecks();
  }

  // Helper method to check schedule and reload if needed
  private checkScheduleAndReload(): void {
    this.scheduleService.checkSchedule().subscribe(
      (changed: boolean) => {
        if (changed) {
          this.logService.info('Schedule changed, reloading playlist');
          this.playbackService.reloadPlaylist();
        } else {
          this.logService.debug('No schedule changes detected');
        }
      },
      (error: any) => {
        this.logService.error(`Schedule check error: ${error}`);
      }
    );
  }

  // New method to set up targeted checks at known schedule times
  private setupTargetedScheduleChecks(): void {
    // First clear any existing interval
    if (this.preciseMinuteInterval) {
      clearInterval(this.preciseMinuteInterval);
      this.preciseMinuteInterval = null;
    }
    
    // Get all scheduled playlists and set up targeted checks for each transition time
    const deviceId = localStorage.getItem('deviceId');
    if (!deviceId) return;
    
    this.logService.info('Setting up targeted schedule checks');
    
    // Get screen configuration with schedules
    this.supabaseApi.getScreenById(deviceId).subscribe(screen => {
      if (!screen || !screen.schedule || !screen.schedule.upcoming) {
        this.logService.warn('No schedules found for targeted checks');
        return;
      }
      
      // Extract all unique transition times
      const transitionTimes = new Set<string>();
      screen.schedule.upcoming.forEach(schedule => {
        transitionTimes.add(schedule.start_time);
        transitionTimes.add(schedule.end_time);
      });
      
      this.logService.info(`Found ${transitionTimes.size} unique transition times to monitor`);
      
      // For each transition time, set up a check 5 seconds before and after the scheduled time
      transitionTimes.forEach(timeStr => {
        this.setupTransitionTimeChecks(timeStr);
      });
    });
  }

  // New method to set up checks for a specific schedule transition time
  private setupTransitionTimeChecks(timeStr: string): void {
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Calculate milliseconds until the next occurrence of this time
    const calculateMsToTime = (): number => {
      const now = new Date();
      const target = new Date();
      
      target.setHours(hours, minutes, 0, 0);
      
      // If the target time is already passed for today, schedule for tomorrow
      if (now > target) {
        target.setDate(target.getDate() + 1);
      }
      
      return target.getTime() - now.getTime();
    };
    
    // Set up targeted checks for this time
    const scheduleNextCheck = () => {
      const msToTime = calculateMsToTime();
      
      // Schedule check 5 seconds before the transition time
      const beforeCheck = setTimeout(() => {
        this.logService.info(`Pre-transition check for ${timeStr}`);
        this.checkScheduleAndReload();
      }, msToTime - 5000);
      
      // Schedule check exactly at the transition time
      const exactCheck = setTimeout(() => {
        this.logService.info(`Exact transition check for ${timeStr}`);
        this.checkScheduleAndReload();
      }, msToTime);
      
      // Schedule check 5 seconds after the transition time
      const afterCheck = setTimeout(() => {
        this.logService.info(`Post-transition check for ${timeStr}`);
        this.checkScheduleAndReload();
        
        // Set up the next day's check
        scheduleNextCheck();
      }, msToTime + 5000);
      
      // Store the timeouts so they can be cleared if needed
      this.transitionTimeoutIds.push(beforeCheck, exactCheck, afterCheck);
    };
    
    // Start the process
    scheduleNextCheck();
    this.logService.info(`Set up transition checks for time: ${timeStr}`);
  }

  // Add precise timing checks
  private setupPreciseMinuteChecks(): void {
    // Check how many milliseconds until the next minute boundary
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    
    // Set up a timeout to check at the next minute boundary
    setTimeout(() => {
      this.logService.info('Checking schedule at minute boundary');
      this.checkScheduleAndReload();
      
      // Then set up an interval to check every minute precisely
      this.preciseMinuteInterval = setInterval(() => {
        const d = new Date();
        this.logService.info(`Precise minute check: ${d.toTimeString()}`);
        this.checkScheduleAndReload();
      }, 60000);
    }, msToNextMinute);
  }

  private startHeartbeat(): void {
    // Send heartbeat immediately on startup
    this.sendHeartbeat();
    
    // Send heartbeat every 60 seconds
    this.heartbeatInterval = interval(60000).subscribe(() => {
      this.sendHeartbeat();
    });
  }
  
  private sendHeartbeat(): void {
    this.heartbeatService.sendHeartbeat({
      status: this.playbackError ? 'error' : this.isPlaying() ? 'playing' : 'paused',
      currentItem: this.currentItem?.id,
      currentPlaylist: this.currentPlayerState?.currentPlaylistId || null,
      error: this.playbackError
    }).subscribe(
      success => {
        if (success) {
          this.logService.debug('Heartbeat sent successfully');
        } else {
          this.logService.warn('Heartbeat failed');
        }
      },
      error => {
        this.logService.error(`Heartbeat error: ${error}`);
      }
    );
  }
  
  private isPlaying(): boolean {
    return this.currentPlayerState?.isPlaying || false;
  }

  // Methods to handle manual controls if needed
  skipToNext(): void {
    this.playbackService.skipToNext();
  }

  restartPlayback(): void {
    this.playbackService.restartPlayback();
  }
  
  // Force reload the current playlist
  reloadPlaylist(): void {
    this.playbackService.reloadPlaylist();
  }
}