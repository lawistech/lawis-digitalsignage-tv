// log.service.ts
import { Injectable, PLATFORM_ID, Inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';
import { supabase } from './supabase.config';

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  deviceId?: string;
  context?: any;
}

@Injectable({
  providedIn: 'root'
})
export class LogService {
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 100;
  private deviceId: string | null = null;
  private flushInterval: any;
  private minLogLevel = environment.production ? LogLevel.Info : LogLevel.Debug;
  private isBrowser: boolean;
  private isFlushingLogs = false;
  private lastFlushAttempt = 0;
  private flushMinInterval = 10000; // 10 seconds minimum between flush attempts
  private consoleLogEnabled = true;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: any
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    // Only access browser APIs if we're running in a browser
    if (this.isBrowser) {
      // Get device ID from local storage
      this.deviceId = localStorage.getItem('deviceId');
      
      // Setup log buffer flushing - reduce frequency to every 5 minutes
      this.flushInterval = setInterval(() => this.flushLogs(), 300000); // Flush every 5 minutes
      
      // Flush logs on unload
      window.addEventListener('beforeunload', () => this.flushLogs());
    }
  }

  /**
   * Set the minimum log level
   * @param level The minimum level to log (0=Debug, 1=Info, 2=Warn, 3=Error)
   */
  setDebugLevel(level: number): void {
    if (level >= 0 && level <= 3) {
      this.minLogLevel = level;
      this.debug(`Log level set to ${level}`);
    } else {
      this.warn(`Invalid log level: ${level}. Must be between 0 and 3.`);
    }
  }

  /**
   * Enable or disable console logging
   */
  setConsoleLogging(enabled: boolean): void {
    this.consoleLogEnabled = enabled;
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: any): void {
    this.log(LogLevel.Debug, message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: any): void {
    this.log(LogLevel.Info, message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: any): void {
    this.log(LogLevel.Warn, message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: any): void {
    this.log(LogLevel.Error, message, context);
  }

  /**
   * Main logging function
   */
  private log(level: LogLevel, message: string, context?: any): void {
    // Skip if below minimum log level
    if (level < this.minLogLevel) {
      return;
    }
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      deviceId: this.deviceId || undefined,
      context
    };
    
    // Always log to console if enabled
    if (this.consoleLogEnabled) {
      this.logToConsole(entry);
    }
    
    // Add to buffer if running in browser
    if (this.isBrowser) {
      this.logBuffer.push(entry);
      
      // Keep buffer size under control by removing older entries if needed
      if (this.logBuffer.length > this.maxBufferSize) {
        this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
      }
      
      // Auto-flush on errors or if buffer is getting full
      if ((level === LogLevel.Error && this.canFlushNow()) || 
          this.logBuffer.length >= this.maxBufferSize * 0.8) {
        this.flushLogs();
      }
    }
  }

  /**
   * Check if enough time has passed since last flush attempt
   */
  private canFlushNow(): boolean {
    const now = Date.now();
    return (now - this.lastFlushAttempt) > this.flushMinInterval;
  }

  /**
   * Format and output a log entry to the console
   */
  private logToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const prefix = `[${timestamp}]`;
    
    switch (entry.level) {
      case LogLevel.Debug:
        console.debug(prefix, entry.message, entry.context || '');
        break;
      case LogLevel.Info:
        console.info(prefix, entry.message, entry.context || '');
        break;
      case LogLevel.Warn:
        console.warn(prefix, entry.message, entry.context || '');
        break;
      case LogLevel.Error:
        console.error(prefix, entry.message, entry.context || '');
        break;
    }
  }

  /**
   * Send logs to the server and clear the buffer
   */
  flushLogs(): void {
    // Skip if not in browser, buffer is empty, already flushing, or no device ID
    if (!this.isBrowser || 
        this.logBuffer.length === 0 || 
        this.isFlushingLogs || 
        !this.deviceId) {
      return;
    }
    
    this.lastFlushAttempt = Date.now();
    this.isFlushingLogs = true;
    
    // Only send high priority logs (warnings and errors) to reduce server load
    const highPriorityLogs = this.logBuffer.filter(log => log.level >= LogLevel.Warn);
    
    // If no high priority logs, just clear the buffer
    if (highPriorityLogs.length === 0) {
      this.logBuffer = [];
      this.isFlushingLogs = false;
      return;
    }
    
    // Use Supabase directly as it has authentication built in
    Promise.resolve().then(async () => {
      try {
        // Method 1: Try using Supabase client
        const { error } = await supabase
          .from('screen_logs')
          .insert(highPriorityLogs.map(log => ({
            device_id: log.deviceId,
            level: this.getLevelName(log.level),
            message: log.message,
            context: log.context || null,
            created_at: log.timestamp
          })));
        
        if (error) {
          console.warn('Failed to log to Supabase:', error);
          // Keep critical logs for future attempts
          const criticalLogs = highPriorityLogs.filter(log => log.level === LogLevel.Error);
          // Add back to the start of the buffer
          this.logBuffer = [...criticalLogs, ...this.logBuffer.filter(log => log.level < LogLevel.Warn)];
        } else {
          // Clear the buffer of logs we've sent
          this.logBuffer = this.logBuffer.filter(log => log.level < LogLevel.Warn);
        }
      } catch (error) {
        console.error('Error sending logs:', error);
        // Keep only error logs for future attempts
        const errorLogs = highPriorityLogs.filter(log => log.level === LogLevel.Error);
        // Add back to the start of the buffer
        this.logBuffer = [...errorLogs, ...this.logBuffer.filter(log => log.level < LogLevel.Warn)];
      } finally {
        this.isFlushingLogs = false;
      }
    });
  }

  /**
   * Get the string representation of a log level
   */
  private getLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.Debug: return 'debug';
      case LogLevel.Info: return 'info';
      case LogLevel.Warn: return 'warn';
      case LogLevel.Error: return 'error';
      default: return 'unknown';
    }
  }

  /**
   * Get the current log buffer (mainly for diagnostics view)
   */
  getLogBuffer(): LogEntry[] {
    return [...this.logBuffer];
  }

  /**
   * Clear the log buffer
   */
  clearLogBuffer(): void {
    this.logBuffer = [];
  }

  /**
   * Clean up on service destruction
   */
  ngOnDestroy(): void {
    if (this.isBrowser && this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushLogs();
    }
  }
}