// schedule.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, from } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { LogService } from './log.service';
import { SupabaseApiService } from './supabase-api.service';
import { supabase } from './supabase.config';

interface ScheduleItem {
  playlist_id: string;
  start_time: string;
  end_time: string;
  priority: number;
  days_of_week: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ScheduleService {
  private deviceId: string | null = null;
  private currentPlaylistId: string | null = null;

  constructor(
    private http: HttpClient,
    private supabaseApi: SupabaseApiService,
    private logService: LogService
  ) {
    // Get device ID from local storage
    this.deviceId = localStorage.getItem('deviceId');
    if (!this.deviceId) {
      this.logService.error('No device ID found in local storage');
    }
  }

  /**
   * Check if the schedule has changed and a different playlist should be playing
   * @returns Observable<boolean> - True if the playlist has changed, false otherwise
   */
  checkSchedule(): Observable<boolean> {
    if (!this.deviceId) {
      this.logService.error('Cannot check schedule: No device ID');
      return of(false);
    }

    // Get the exact time including seconds for more precise logging
    const now = new Date();
    const currentTimeExact = now.toTimeString().slice(0, 8); // Format: "HH:MM:SS"
    const currentTime = currentTimeExact.slice(0, 5); // Format: "HH:MM" for comparison
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
    
    this.logService.debug(`Checking schedule at exact time: ${currentTimeExact}, day: ${currentDay}`);

    return this.supabaseApi.getScreenById(this.deviceId).pipe(
      map(screen => {
        if (!screen) {
          this.logService.warn('Screen not found when checking schedule');
          return false;
        }
        
        // Debug logging with more details
        this.logService.debug(`Screen data: ${JSON.stringify({
          id: screen.id,
          current_playlist: screen.current_playlist,
          has_schedule: !!screen.schedule?.upcoming?.length,
          schedule_count: screen.schedule?.upcoming?.length || 0
        })}`);

        // If no schedules, nothing to check
        if (!screen.schedule?.upcoming?.length) {
          this.logService.debug('No upcoming schedules found');
          return false;
        }

        // Find active schedule
        let highestPrioritySchedule = null;
        let highestPriority = Number.MAX_SAFE_INTEGER;

        // Log all schedules for debugging
        screen.schedule.upcoming.forEach((schedule, index) => {
          // Add seconds to the start_time and end_time for more exact comparison
          const startTime = schedule.start_time;
          const endTime = schedule.end_time;
          
          this.logService.debug(`Schedule ${index}: playlist=${schedule.playlist_id}, time=${startTime}-${endTime}, priority=${schedule.priority}`);
        });

        // Check each schedule - make sure to cast to the correct interface
        for (const schedule of screen.schedule.upcoming as unknown as ScheduleItem[]) {
          // Safely access days_of_week with a fallback
          const days = schedule.days_of_week || 
                      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
          
          const isActiveDay = days.includes(currentDay);
          
          // Use >= and <= for time comparison to match exactly at boundaries
          const isActiveTime = currentTime >= schedule.start_time && currentTime <= schedule.end_time;
          
          // Add more detailed logging about the exact times being compared
          this.logService.debug(
            `Schedule check details: playlist=${schedule.playlist_id}, ` +
            `activeDay=${isActiveDay}, activeTime=${isActiveTime}, ` +
            `comparing current=${currentTime} with start=${schedule.start_time}, end=${schedule.end_time}`
          );
          
          if (isActiveDay && isActiveTime && schedule.priority < highestPriority) {
            highestPrioritySchedule = schedule;
            highestPriority = schedule.priority;
            this.logService.debug(`Found higher priority schedule: ${schedule.playlist_id} (priority ${schedule.priority})`);
          }
        }

        if (highestPrioritySchedule) {
          const newPlaylistId = highestPrioritySchedule.playlist_id;
          
          // Track whether transition is exactly at schedule boundary
          const isExactTransition = 
            currentTime === highestPrioritySchedule.start_time ||
            currentTime === highestPrioritySchedule.end_time;
          
          // Check if this is different from current
          if (newPlaylistId !== this.currentPlaylistId) {
            this.logService.info(
              `Schedule change detected at ${currentTimeExact}! ` +
              `Changing playlist from ${this.currentPlaylistId || 'none'} to ${newPlaylistId} ` +
              `(exact transition: ${isExactTransition})`
            );
            
            this.currentPlaylistId = newPlaylistId;
            
            // Update the screen record with the new playlist
            this.updateCurrentPlaylist(newPlaylistId);
            
            return true;
          } else {
            this.logService.debug(`Current playlist ${this.currentPlaylistId} matches schedule, no change needed`);
          }
        } else if (screen.current_playlist && this.currentPlaylistId !== screen.current_playlist) {
          // No active schedule, revert to default playlist if different
          this.logService.info(`No active schedule, changing to default playlist: ${screen.current_playlist}`);
          this.currentPlaylistId = screen.current_playlist;
          return true;
        }
        
        return false;
      }),
      catchError(error => {
        this.logService.error(`Error checking schedule: ${error.message}`);
        return of(false);
      })
    );
  }

  /**
   * Check playlist items for scheduling
   */
  private checkPlaylistItemSchedules(): Observable<boolean> {
    return this.getAreaId().pipe(
      switchMap(areaId => {
        if (!areaId) {
          return of(false);
        }

        // Get all playlists for this area
        return this.supabaseApi.getAreaPlaylists(areaId).pipe(
          switchMap(playlists => {
            if (!playlists || playlists.length === 0) {
              return of(false);
            }

            // Get the current time and day
            const now = new Date();
            const currentTime = now.toTimeString().slice(0, 5); // Format: "HH:MM"
            const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
            
            // Check scheduled items from playlist_items table
            return this.http.get<any[]>(`${this.supabaseApi.apiUrl}/playlist_items`, {
              params: {
                select: 'playlist_id,schedule_enabled,schedule_start_time,schedule_end_time,schedule_days,schedule_priority',
                playlist_id: `in.(${playlists.map(p => p.id).join(',')})`,
                schedule_enabled: 'eq.true',
                schedule_start_time: `lte.${currentTime}`,
                schedule_end_time: `gte.${currentTime}`,
                order: 'schedule_priority.asc'
              },
              headers: {
                'apikey': this.supabaseApi.supabaseKey,
                'Authorization': `Bearer ${this.supabaseApi.supabaseKey}`
              }
            }).pipe(
              map(data => {
                // Filter items for the current day
                const scheduledItems = data.filter((item: any) => 
                  item.schedule_days && item.schedule_days.includes(currentDay)
                );
                
                if (scheduledItems.length > 0) {
                  // Get the highest priority item (lowest priority number)
                  const bestMatch = scheduledItems[0];
                  
                  if (bestMatch.playlist_id !== this.currentPlaylistId) {
                    this.currentPlaylistId = bestMatch.playlist_id;
                    this.updateCurrentPlaylist(bestMatch.playlist_id);
                    return true;
                  }
                }
                
                return false;
              }),
              catchError(error => {
                this.logService.error(`Error checking playlist item schedules: ${error.message}`);
                return of(false);
              })
            );
          }),
          catchError(error => {
            this.logService.error(`Error getting area playlists: ${error.message}`);
            return of(false);
          })
        );
      }),
      catchError(error => {
        this.logService.error(`Error in checkPlaylistItemSchedules: ${error.message}`);
        return of(false);
      })
    );
  }

  /**
   * Get the area ID for this screen
   */
  private getAreaId(): Observable<string | null> {
    return this.supabaseApi.getScreenArea(this.deviceId!).pipe(
      map(area => area ? area.area_id : null),
      catchError(error => {
        this.logService.error(`Error getting area ID: ${error.message}`);
        return of(null);
      })
    );
  }

  /**
   * Find the highest priority schedule that matches the current time
   */
  private findMatchingSchedule(schedules: ScheduleItem[]): ScheduleItem | null {
    if (!schedules || !schedules.length) {
      return null;
    }
    
    const now = new Date();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
    const currentTime = now.toTimeString().slice(0, 5); // Format: "HH:MM"
    
    // Filter schedules that match the current day and time
    const matchingSchedules = schedules.filter(schedule => {
      return (
        // Day matches
        schedule.days_of_week.includes(currentDay) &&
        // Time is within the range
        schedule.start_time <= currentTime &&
        schedule.end_time >= currentTime
      );
    });
    
    if (!matchingSchedules.length) {
      return null;
    }
    
    // Sort by priority (lower number = higher priority)
    matchingSchedules.sort((a, b) => a.priority - b.priority);
    
    // Return the highest priority schedule
    return matchingSchedules[0];
  }
  
  /**
   * Update the current playlist for this screen
   */
  private updateCurrentPlaylist(playlistId: string): void {
    if (!this.deviceId) {
      return;
    }
    
    const updateTime = new Date();
    this.logService.info(`Updating current playlist on server to: ${playlistId} at ${updateTime.toISOString()}`);
    
    // Update the screen record in Supabase
    supabase
      .from('screens')
      .update({
        current_playlist: playlistId,
        current_playlist_started_at: updateTime.toISOString(),
        // Also record that this was triggered by a schedule
        analytics: {
          last_schedule_change: updateTime.toISOString(),
          scheduled_playlist: playlistId,
          exact_change_time: updateTime.toTimeString()
        }
      })
      .eq('id', this.deviceId)
      .then(({ error }) => {
        if (error) {
          this.logService.error(`Error updating current playlist in screens table: ${error.message}`);
        } else {
          this.logService.info(`Current playlist updated in screens table to ${playlistId} successfully at ${updateTime.toTimeString()}`);
        }
      });
  }
}