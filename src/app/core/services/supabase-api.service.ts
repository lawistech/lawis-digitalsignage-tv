// src/app/core/services/supabase-api.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { supabase } from './supabase.config';
import { LogService } from './log.service';
import { Playlist, PlaylistItem } from '../models/playlist.model';
import { Screen } from '../models/screen.model';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SupabaseApiService {
  apiUrl = environment.apiUrl;
  supabaseKey = environment.supabaseKey;
  
  constructor(
    private http: HttpClient,
    private logService: LogService
  ) {}

  /**
   * Get screen information by ID
   */
  getScreenById(screenId: string): Observable<Screen | null> {
    this.logService.info(`Fetching screen info for ID: ${screenId}`);
    return from(
      supabase
        .from('screens')
        .select('*')
        .eq('id', screenId)
        .single()
    ).pipe(
      map(({ data, error }: any) => {
        if (error) {
          throw error;
        }
        return data as Screen;
      }),
      catchError(error => {
        this.logService.error(`Error fetching screen: ${error.message}`);
        return of(null);
      })
    );
  }

  /**
   * Get the area information for a screen
   */
  getScreenArea(screenId: string): Observable<any | null> {
    return from(
      supabase
        .from('area_screens')
        .select('*')
        .eq('screen_id', screenId)
        .single()
    ).pipe(
      map(({ data, error }: any) => {
        if (error) {
          throw error;
        }
        return data;
      }),
      catchError(error => {
        this.logService.error(`Error fetching screen area: ${error.message}`);
        return of(null);
      })
    );
  }

  /**
   * Get playlist by ID
   */
  getPlaylistById(playlistId: string): Observable<Playlist | null> {
    this.logService.info(`Fetching playlist: ${playlistId}`);
    return from(
      supabase
        .from('playlists')
        .select('*')
        .eq('id', playlistId)
        .single()
    ).pipe(
      switchMap(({ data: playlistData, error: playlistError }: any) => {
        if (playlistError) {
          throw playlistError;
        }
        
        // Now get the playlist items
        return this.getPlaylistItems(playlistId).pipe(
          map(items => {
            // Construct the full playlist object
            const playlist: Playlist = {
              id: playlistData.id,
              name: playlistData.name,
              description: playlistData.description || '',
              duration: playlistData.duration || 0,
              items: items,
              lastModified: playlistData.updated_at,
              createdBy: playlistData.created_by,
              status: playlistData.status || 'active',
              tags: playlistData.tags || [],
              settings: playlistData.settings || {
                autoPlay: true,
                loop: true,
                defaultMuted: true,
                transition: {
                  type: 'fade',
                  duration: 0.5
                },
                defaultDuration: 10,
                scheduling: {
                  enabled: false,
                  priority: 1
                }
              }
            };
            
            return playlist;
          })
        );
      }),
      catchError(error => {
        this.logService.error(`Error fetching playlist: ${error.message}`);
        return of(null);
      })
    );
  }

  /**
   * Get playlist items
   */
  private getPlaylistItems(playlistId: string): Observable<PlaylistItem[]> {
    return from(
      supabase
        .from('playlist_items')
        .select('*')
        .eq('playlist_id', playlistId)
        .order('id')
    ).pipe(
      map(({ data, error }: any) => {
        if (error) {
          throw error;
        }
        
        // Map database items to PlaylistItem model
        return data.map((item: any) => ({
          id: item.id,
          type: item.type as 'image' | 'video' | 'webpage' | 'ticker',
          name: item.name,
          duration: item.duration,
          content: {
            url: item.content_url,
            thumbnail: item.thumbnail_url
          },
          settings: {
            transition: item.transition as 'fade' | 'slide' | 'none' || 'fade',
            transitionDuration: item.transition_duration || 0.5,
            scaling: item.scaling as 'fit' | 'fill' | 'stretch' || 'fit',
            muted: item.muted,
            loop: item.loop
          },
          schedule: item.schedule_enabled ? {
            enabled: item.schedule_enabled,
            startTime: item.schedule_start_time,
            endTime: item.schedule_end_time,
            daysOfWeek: item.schedule_days || [],
            priority: item.schedule_priority || 1
          } : undefined
        }));
      }),
      catchError(error => {
        this.logService.error(`Error fetching playlist items: ${error.message}`);
        return of([]);
      })
    );
  }

  /**
   * Update screen status
   */
  updateScreenStatus(screenId: string, status: string, data: any = {}): Observable<boolean> {
    return from(
      supabase
        .from('screens')
        .update({
          status: status,
          last_ping: new Date().toISOString(),
          ...data
        })
        .eq('id', screenId)
    ).pipe(
      map(({ error }: any) => {
        if (error) {
          throw error;
        }
        return true;
      }),
      catchError(error => {
        this.logService.error(`Error updating screen status: ${error.message}`);
        return of(false);
      })
    );
  }

  /**
   * Get all playlists for an area
   */
  getAreaPlaylists(areaId: string): Observable<Playlist[]> {
    return from(
      supabase
        .from('playlists')
        .select('*')
        .eq('area_id', areaId)
        .order('name')
    ).pipe(
      map(({ data, error }: any) => {
        if (error) {
          throw error;
        }
        
        // Return the playlist metadata (without items)
        return data.map((playlist: any) => ({
          id: playlist.id,
          name: playlist.name,
          description: playlist.description || '',
          duration: playlist.duration || 0,
          items: [],  // Items will be loaded separately when needed
          lastModified: playlist.updated_at,
          createdBy: playlist.created_by,
          status: playlist.status || 'active',
          tags: playlist.tags || [],
          settings: playlist.settings || {
            autoPlay: true,
            loop: true,
            defaultMuted: true,
            transition: {
              type: 'fade',
              duration: 0.5
            },
            defaultDuration: 10,
            scheduling: {
              enabled: false,
              priority: 1
            }
          }
        }));
      }),
      catchError(error => {
        this.logService.error(`Error fetching area playlists: ${error.message}`);
        return of([]);
      })
    );
  }

  /**
   * Check pending registrations for a code
   */
  checkRegistrationCode(code: string): Observable<{claimed: boolean, deviceId?: string}> {
    return from(
      supabase
        .from('pending_registrations')
        .select('*')
        .eq('registration_code', code)
        .single()
    ).pipe(
      map(({ data, error }: any) => {
        if (error) {
          throw error;
        }
        
        if (data && data.is_claimed) {
          return {
            claimed: true,
            deviceId: data.device_id
          };
        }
        
        return { claimed: false };
      }),
      catchError(error => {
        this.logService.error(`Error checking registration code: ${error.message}`);
        return of({ claimed: false });
      })
    );
  }
  
  /**
   * Create a new screen in the database
   */
  createScreen(name: string, areaId: string): Observable<{success: boolean, screenId?: string}> {
    const screenId = crypto.randomUUID();
    
    return from(
      supabase
        .from('screens')
        .insert([{
          id: screenId,
          name: name,
          status: 'online',
          resolution: `${window.screen.width}x${window.screen.height}`,
          orientation: window.screen.width > window.screen.height ? 'landscape' : 'portrait',
          last_ping: new Date().toISOString(),
          area_id: areaId,
          hardware: {
            model: 'Web Browser',
            manufacturer: navigator.userAgent,
            supported_resolutions: [`${window.screen.width}x${window.screen.height}`]
          },
          network: {
            connection_type: (navigator as any).connection ? (navigator as any).connection.effectiveType : 'unknown'
          },
          settings: {
            auto_start: true,
            auto_update: true,
            content_caching: true,
            refresh_interval: 30
          },
          tags: ['web']
        }])
    ).pipe(
      switchMap(({ error }: any) => {
        if (error) {
          throw error;
        }
        
        // Now add entry to area_screens
        return from(
          supabase
            .from('area_screens')
            .insert([{
              screen_id: screenId,
              screen_name: name,
              screen_status: 'online',
              area_id: areaId,
              current_playlist: null,
              location: {}
            }])
        );
      }),
      map(({ error }: any) => {
        if (error) {
          throw error;
        }
        
        return {
          success: true,
          screenId: screenId
        };
      }),
      catchError(error => {
        this.logService.error(`Error creating screen: ${error.message}`);
        return of({ success: false });
      })
    );
  }
  
  /**
   * Get all areas
   */
  getAreas(): Observable<any[]> {
    return from(
      supabase
        .from('area_screens')
        .select('area_id, area_name')
        .order('area_name')
    ).pipe(
      map(({ data, error }: any) => {
        if (error) {
          throw error;
        }
        
        // Deduplicate areas
        const areas = new Map();
        data.forEach((item: any) => {
          if (item.area_id && !areas.has(item.area_id)) {
            areas.set(item.area_id, { id: item.area_id, name: item.area_name });
          }
        });
        
        return Array.from(areas.values());
      }),
      catchError(error => {
        this.logService.error(`Error fetching areas: ${error.message}`);
        return of([]);
      })
    );
  }
}