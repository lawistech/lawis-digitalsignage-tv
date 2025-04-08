// device-registration.service.ts
import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of, from } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { LogService } from './log.service';
import { environment } from '../../../environments/environment';
import { supabase } from './supabase.config';
import { DeviceInfo } from '../models/device-info.model';

@Injectable({
  providedIn: 'root'
})
export class DeviceRegistrationService {
  private registrationCode: string | null = null;
  private isBrowser: boolean;
  private readonly REGISTRATION_CODE_KEY = 'registrationCode'; // Consistent key for storage

  constructor(
    private http: HttpClient,
    private logService: LogService,
    @Inject(PLATFORM_ID) private platformId: any
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  /**
   * Generate a unique registration code for this device
   */
  generateRegistrationCode(): string {
    // Generate a 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.registrationCode = code;
    
    // Store the code in localStorage to persist across sessions
    if (this.isBrowser) {
      localStorage.setItem(this.REGISTRATION_CODE_KEY, code);
    }
    
    return code;
  }

  /**
   * Get the current registration code or generate a new one
   */
  getRegistrationCode(): string {
    if (this.registrationCode) {
      return this.registrationCode;
    }

    // Try to get from localStorage if in browser
    if (this.isBrowser) {
      const code = localStorage.getItem(this.REGISTRATION_CODE_KEY);
      if (code) {
        this.registrationCode = code;
        return code;
      }
    }

    // Generate new code
    return this.generateRegistrationCode();
  }

  /**
   * Clear the registration code
   * This should be called when registration is complete
   */
  clearRegistrationCode(): void {
    this.registrationCode = null;
    if (this.isBrowser) {
      localStorage.removeItem(this.REGISTRATION_CODE_KEY);
    }
  }

  /**
   * Check if this device is registered (has a device ID in local storage)
   */
  isDeviceRegistered(): boolean {
    if (!this.isBrowser) {
      return false;
    }
    return !!localStorage.getItem('deviceId');
  }

  /**
   * Check if the registration code has been claimed
   */
  checkRegistrationStatus(): Observable<{ registered: boolean; deviceId?: string; }> {
    const code = this.getRegistrationCode();
    console.log('Checking registration for code:', code);
    
    // Check pending_registrations table for the registration code
    return from(
      supabase
        .from('pending_registrations')
        .select('device_id, is_claimed')
        .eq('registration_code', code)
        .single()
    ).pipe(
      map(({ data, error }: any) => {
        if (error) {
          // If the error is 'not found', it means the code hasn't been claimed yet
          if (error.code === 'PGRST116') { // PostgrestError code for single row not found
            return { registered: false };
          }
          throw error;
        }
        
        console.log('Registration data:', data);
        
        if (data && data.is_claimed && data.device_id) {
          return {
            registered: true,
            deviceId: data.device_id
          };
        }
        
        return { registered: false };
      }),
      catchError(error => {
        this.logService.error(`Error checking registration status: ${error.message}`);
        return of({ registered: false });
      })
    );
  }

  /**
   * Complete the registration process by storing the device ID
   */
  completeRegistration(deviceId: string): Observable<boolean> {
    // Store device ID in local storage if in browser
    if (this.isBrowser) {
      localStorage.setItem('deviceId', deviceId);
      
      // Clear registration code since registration is complete
      this.clearRegistrationCode();
    }
    
    // Get device info
    const deviceInfo = this.collectDeviceInfo();
    
    // Update screen record with device info
    return from(
      supabase
        .from('screens')
        .update({
          last_ping: new Date().toISOString(),
          status: this.isBrowser ? (navigator.onLine ? 'online' : 'offline') : 'unknown',
          hardware: {
            os: deviceInfo.os,
            browser: deviceInfo.browser,
            resolution: deviceInfo.resolution
          },
          network: {
            connection_type: deviceInfo.connectionType,
            ip_address: deviceInfo.ipAddress
          }
        })
        .eq('id', deviceId)
    ).pipe(
      map(({ error }: any) => {
        if (error) {
          throw error;
        }
        return true;
      }),
      tap(() => {
        this.logService.info(`Device registered successfully with ID: ${deviceId}`);
      }),
      catchError(error => {
        this.logService.error(`Error completing registration: ${error.message}`);
        return of(false);
      })
    );
  }

  /**
   * Initialize registration
   */
  initializeRegistration(deviceInfo: any = {}): Observable<boolean> {
    const code = this.getRegistrationCode();
    const fullDeviceInfo = { ...this.collectDeviceInfo(), ...deviceInfo };
    
    // Insert into pending_registrations table
    return from(
      supabase
        .from('pending_registrations')
        .upsert([
          {
            registration_code: code,
            is_claimed: false,
            device_info: fullDeviceInfo,
            created_at: new Date().toISOString()
          }
        ], 
        { 
          onConflict: 'registration_code',
          ignoreDuplicates: false 
        })
    ).pipe(
      map(({ error }: any) => {
        if (error) {
          // If it's a constraint error, the code might already exist
          if (error.code === '23505') { // Unique constraint violation
            this.logService.info(`Registration code ${code} already exists, continuing...`);
            return true;
          }
          throw error;
        }
        
        this.logService.info(`Registration initialized with code: ${code}`);
        return true;
      }),
      catchError(error => {
        this.logService.error(`Error initializing registration: ${error.message}`);
        // Return true anyway so the UI can proceed - the most likely error
        // is that the table doesn't exist, which we'll handle on the admin side
        return of(true);
      })
    );
  }

  /**
   * Collect device information for registration
   */
  private collectDeviceInfo(): DeviceInfo {
    if (!this.isBrowser) {
      return {
        browser: 'server',
        resolution: 'unknown',
        connectionType: 'unknown',
        timestamp: new Date().toISOString(),
        ipAddress: 'unknown',
        os: 'server'
      };
    }
    
    const deviceInfo: DeviceInfo = {
      browser: navigator.userAgent,
      resolution: `${window.screen.width}x${window.screen.height}`,
      connectionType: this.getConnectionType(),
      timestamp: new Date().toISOString(),
      ipAddress: 'unknown',
      os: this.getOperatingSystem()
    };
    
    return deviceInfo;
  }

  /**
   * Get connection type information
   */
  private getConnectionType(): string {
    if (!this.isBrowser) {
      return 'unknown';
    }
    
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      if (connection) {
        return connection.effectiveType || connection.type || 'unknown';
      }
    }
    return navigator.onLine ? 'online' : 'offline';
  }

  /**
   * Get operating system information
   */
  private getOperatingSystem(): string {
    if (!this.isBrowser) {
      return 'unknown';
    }
    
    const userAgent = navigator.userAgent;
    
    if (userAgent.indexOf('Windows') !== -1) return 'Windows';
    if (userAgent.indexOf('Mac') !== -1) return 'MacOS';
    if (userAgent.indexOf('Linux') !== -1) return 'Linux';
    if (userAgent.indexOf('Android') !== -1) return 'Android';
    if (userAgent.indexOf('iOS') !== -1 || userAgent.indexOf('iPhone') !== -1 || userAgent.indexOf('iPad') !== -1) return 'iOS';
    
    return 'Unknown';
  }
}