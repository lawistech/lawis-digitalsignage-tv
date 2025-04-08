// diagnostics.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { interval, Subscription } from 'rxjs';
import { LogService, LogEntry, LogLevel } from '../../core/services/log.service';
import { ContentSyncService } from '../../core/services/content-sync.service';
import { HeartbeatService } from '../../core/services/heartbeat.service';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-diagnostics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './diagnostics.component.html',
  styleUrls: ['./diagnostics.component.scss']
})
export class DiagnosticsComponent implements OnInit, OnDestroy {
  deviceId: string | null = null;
  appVersion = environment.appVersion;
  screenResolution = `${window.screen.width}x${window.screen.height}`;
  browserInfo = navigator.userAgent;
  isOnline = navigator.onLine;
  lastHeartbeat: string | null = null;
  uptime = '00:00:00';
  memoryUsage = 'N/A';
  cacheSize = 'N/A';
  
  logs: LogEntry[] = [];
  filteredLogs: LogEntry[] = [];
  logFilter: 'all' | 'error' | 'warn' | 'info' = 'all';
  
  private startTime = Date.now();
  private refreshInterval: Subscription | null = null;
  
  constructor(
    private router: Router,
    private logService: LogService,
    private contentSyncService: ContentSyncService,
    private heartbeatService: HeartbeatService
  ) {}
  
  ngOnInit(): void {
    this.deviceId = localStorage.getItem('deviceId');
    this.refreshData();
    
    // Listen for online/offline events
    window.addEventListener('online', () => this.isOnline = true);
    window.addEventListener('offline', () => this.isOnline = false);
    
    // Set up auto-refresh every 5 seconds
    this.refreshInterval = interval(5000).subscribe(() => {
      this.updateUptime();
      this.updateMemoryUsage();
    });
    
    // Listen for keyboard events to exit
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
  }
  
  ngOnDestroy(): void {
    if (this.refreshInterval) {
      this.refreshInterval.unsubscribe();
    }
    document.removeEventListener('keydown', this.handleKeyDown.bind(this));
  }
  
  handleKeyDown(event: KeyboardEvent): void {
    // Alt+D to exit diagnostics
    if (event.altKey && event.key === 'd') {
      this.goBack();
    }
  }
  
  refreshData(): void {
    this.logs = this.logService.getLogBuffer();
    this.filterLogs();
    this.updateUptime();
    this.updateMemoryUsage();
    
    // Send a heartbeat to update server status
    this.heartbeatService.sendHeartbeat({
      status: 'playing',
      metrics: {
        diagnostics_opened: true
      }
    }).subscribe(() => {
      this.lastHeartbeat = new Date().toLocaleTimeString();
    });
  }
  
  updateUptime(): void {
    const diff = Date.now() - this.startTime;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    
    this.uptime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  
  updateMemoryUsage(): void {
    if ('memory' in navigator) {
      const memory = (navigator as any).memory;
      if (memory) {
        const used = memory.usedJSHeapSize;
        const total = memory.jsHeapSizeLimit;
        const percent = Math.round((used / total) * 100);
        
        this.memoryUsage = `${this.formatBytes(used)} / ${this.formatBytes(total)} (${percent}%)`;
      }
    }
  }
  
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  formatTime(isoString: string): string {
    try {
      return new Date(isoString).toLocaleTimeString();
    } catch (e) {
      return isoString;
    }
  }
  
  getLogClass(log: LogEntry): string {
    switch (log.level) {
      case LogLevel.Debug:
        return 'log-debug';
      case LogLevel.Info:
        return 'log-info';
      case LogLevel.Warn:
        return 'log-warn';
      case LogLevel.Error:
        return 'log-error';
      default:
        return '';
    }
  }
  
  getLogLevelText(level: LogLevel): string {
    switch (level) {
      case LogLevel.Debug:
        return 'DEBUG';
      case LogLevel.Info:
        return 'INFO';
      case LogLevel.Warn:
        return 'WARN';
      case LogLevel.Error:
        return 'ERROR';
      default:
        return 'UNKNOWN';
    }
  }
  
  filterLogs(): void {
    switch (this.logFilter) {
      case 'error':
        this.filteredLogs = this.logs.filter(log => log.level === LogLevel.Error);
        break;
      case 'warn':
        this.filteredLogs = this.logs.filter(log => log.level >= LogLevel.Warn);
        break;
      case 'info':
        this.filteredLogs = this.logs.filter(log => log.level >= LogLevel.Info);
        break;
      default:
        this.filteredLogs = [...this.logs];
    }
  }
  
  clearLogs(): void {
    this.logs = [];
    this.filteredLogs = [];
  }
  
  clearCache(): void {
    if (confirm('Are you sure you want to clear the content cache?')) {
      this.contentSyncService.clearCache().subscribe(success => {
        if (success) {
          this.logService.info('Cache cleared successfully');
          alert('Cache cleared successfully');
        } else {
          this.logService.error('Failed to clear cache');
          alert('Failed to clear cache');
        }
        this.refreshData();
      });
    }
  }
  
  restartPlayer(): void {
    if (confirm('Are you sure you want to restart the player?')) {
      this.logService.info('Player restart requested');
      this.router.navigate(['/player']);
    }
  }
  
  reloadContent(): void {
    if (confirm('Are you sure you want to reload all content?')) {
      this.logService.info('Content reload requested');
      // This would typically call a service to reload content
      alert('Content reload initiated');
      this.router.navigate(['/player']);
    }
  }
  
  factoryReset(): void {
    if (confirm('WARNING: Factory reset will delete all data and require re-registration. Are you absolutely sure?')) {
      if (confirm('Last warning: This action cannot be undone. Continue?')) {
        this.logService.info('Factory reset initiated');
        
        // Clear all local storage
        localStorage.clear();
        sessionStorage.clear();
        
        // Clear indexed DB
        this.contentSyncService.clearCache().subscribe(() => {
          // Redirect to registration
          this.router.navigate(['/registration']);
        });
      }
    }
  }
  
  goBack(): void {
    this.router.navigate(['/player']);
  }
}