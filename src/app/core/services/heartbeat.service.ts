// heartbeat.service.ts
import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { LogService } from './log.service';
import { environment } from '../../../environments/environment';
import { supabase } from './supabase.config';


  // heartbeat.service.ts
  export interface HeartbeatData {
    status: 'playing' | 'paused' | 'error' | 'offline';
    currentItem?: string | null; // ID of current playing item
    currentPlaylist?: string | null; // ID of current playlist
    scheduleStatus?: string | null; // Status of current schedule
    error?: string | null; // Error message if any
    metrics?: {
      cpu?: number;
      memory?: number;
      storage?: number;
      temperature?: number;
      diagnostics_opened?: boolean;
    };
  }

interface NavigatorWithMemory extends Navigator {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  }
  

@Injectable({
  providedIn: 'root'
})
export class HeartbeatService {
  private deviceId: string | null = null;
  private lastOnlineStatus = true;
  private isBrowser: boolean;

  constructor(
    private http: HttpClient,
    private logService: LogService,
    @Inject(PLATFORM_ID) private platformId: any
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    if (this.isBrowser) {
      // Set up listeners for online/offline events
      window.addEventListener('online', () => this.handleNetworkStatusChange(true));
      window.addEventListener('offline', () => this.handleNetworkStatusChange(false));
      
      // Get device ID from local storage
      this.deviceId = localStorage.getItem('deviceId');
      if (!this.deviceId) {
        this.logService.error('No device ID found in local storage');
      }
    }
  }

  /**
   * Send a heartbeat to the server to let it know this screen is active
   */
  // In heartbeat.service.ts
  sendHeartbeat(data: HeartbeatData): Observable<boolean> {
    if (!this.isBrowser || !this.deviceId) {
      this.logService.error('Cannot send heartbeat: No device ID or not in browser');
      return of(false);
    }

    // Add system metrics
    const metrics = this.collectSystemMetrics();
    const heartbeatData = {
      ...data,
      metrics,
      timestamp: new Date().toISOString()
    };

    // Update screen status in Supabase with current playlist info
    return new Observable<boolean>(observer => {
      supabase
        .from('screens')
        .update({
          status: navigator.onLine ? (data.status === 'error' ? 'error' : 'online') : 'offline',
          last_ping: new Date().toISOString(),
          analytics: {
            ...metrics,
            last_error: data.error || null,
            current_item: data.currentItem || null,
            current_playlist: data.currentPlaylist || null,
            schedule_status: data.scheduleStatus || null
          }
        })
        .eq('id', this.deviceId)
        .then(({ error }) => {
          if (error) {
            this.logService.error(`Heartbeat failed: ${error.message}`);
            observer.next(false);
          } else {
            this.logService.debug('Heartbeat sent successfully');
            observer.next(true);
          }
          observer.complete();
        });
    }).pipe(
      catchError(error => {
        this.logService.error(`Error sending heartbeat: ${error.message}`);
        return of(false);
      })
    );
  }

  /**
   * Handle changes in network connectivity
   */
  private handleNetworkStatusChange(isOnline: boolean): void {
    // Only log and send update if status actually changed
    if (this.lastOnlineStatus !== isOnline) {
      this.lastOnlineStatus = isOnline;
      
      if (isOnline) {
        this.logService.info('Network connection restored');
        this.sendConnectionRestored();
      } else {
        this.logService.warn('Network connection lost');
        this.sendConnectionLost();
      }
    }
  }

  /**
   * Send notification that connection was lost
   */
  private sendConnectionLost(): void {
    if (!this.isBrowser || !this.deviceId) return;
    
    supabase
      .from('screens')
      .update({
        status: 'offline',
        last_ping: new Date().toISOString(),
        analytics: {
          connection_lost_at: new Date().toISOString()
        }
      })
      .eq('id', this.deviceId)
      .then(({ error }) => {
        if (error) {
          this.logService.error(`Failed to update offline status: ${error.message}`);
        }
      });
  }

  /**
   * Send notification that connection was restored
   */
  private sendConnectionRestored(): void {
    if (!this.isBrowser || !this.deviceId) return;
    
    supabase
      .from('screens')
      .update({
        status: 'online',
        last_ping: new Date().toISOString(),
        analytics: {
          connection_restored_at: new Date().toISOString()
        }
      })
      .eq('id', this.deviceId)
      .then(({ error }) => {
        if (error) {
          this.logService.error(`Failed to update online status: ${error.message}`);
        }
      });
  }

  /**
   * Collect system metrics like CPU, memory usage etc.
   */
  private collectSystemMetrics(): Record<string, any> {
    if (!this.isBrowser) {
      return {
        reported_at: new Date().toISOString(),
        environment: 'server'
      };
    }
    
    const metrics: Record<string, any> = {
      reported_at: new Date().toISOString(),
      browser: navigator.userAgent,
      screen_size: `${window.screen.width}x${window.screen.height}`,
      window_size: `${window.innerWidth}x${window.innerHeight}`,
      device_pixel_ratio: window.devicePixelRatio,
      online: navigator.onLine,
      memory: null
    };
    
    // Then use the interface to access the memory property
    const navigatorWithMemory = navigator as NavigatorWithMemory;
    if (navigatorWithMemory.memory) {
      const memory = navigatorWithMemory.memory;
      metrics['memory'] = {
        total: memory.jsHeapSizeLimit,
        used: memory.usedJSHeapSize,
        percent: Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)
      };
    }
    
    return metrics;
  }
}