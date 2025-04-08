// web-item.component.ts
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlaylistItem } from '../../../core/models/playlist.model';
import { LogService } from '../../../core/services/log.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-web-item',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="web-container">
      <iframe
        *ngIf="safeUrl && !loading"
        [src]="safeUrl"
        frameborder="0"
        allowfullscreen
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
      ></iframe>
      <div *ngIf="!safeUrl && !loading" class="error-placeholder">
        <span class="material-icons">web_asset_off</span>
        <p>Web content could not be loaded</p>
      </div>
      <div *ngIf="loading" class="loading-indicator">
        <div class="spinner"></div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    
    .web-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    
    .error-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #dc3545;
      
      .material-icons {
        font-size: 4rem;
        margin-bottom: 1rem;
      }
    }
    
    .loading-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      
      .spinner {
        width: 50px;
        height: 50px;
        border: 5px solid rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        border-top-color: #fff;
        animation: spin 1s ease-in-out infinite;
      }
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class WebItemComponent implements OnInit, OnDestroy {
  @Input() item: PlaylistItem | null = null;
  @Input() duration: number = 10;
  @Input() preload = false;
  @Output() ended = new EventEmitter<void>();
  
  safeUrl: SafeResourceUrl | null = null;
  loading = true;
  private timer: any;
  
  constructor(
    private logService: LogService,
    private sanitizer: DomSanitizer
  ) {}
  
  ngOnInit(): void {
    if (!this.item) {
      this.loading = false;
      return;
    }
    
    this.loadWebContent();
    
    // If not preloading, start the timer after content loads
    if (!this.preload) {
      // We'll start the timer when content is loaded
      this.startTimer();
    }
  }
  
  ngOnDestroy(): void {
    this.clearTimer();
  }
  
  private loadWebContent(): void {
    if (!this.item) return;
    
    try {
      // Sanitize URL to prevent security issues
      this.safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.item.content.url);
      this.loading = false;
      this.logService.info(`Web content loaded: ${this.item.name}`);
    } catch (error) {
      this.loading = false;
      this.safeUrl = null;
      this.logService.error(`Failed to load web content: ${error}`);
    }
  }
  
  private startTimer(): void {
    // Clear any existing timer
    this.clearTimer();
    
    // Use the specified duration or default to 10 seconds
    const duration = this.duration || this.item?.duration || 10;
    
    // Set timer for the duration of this item
    this.timer = setTimeout(() => {
      this.ended.emit();
    }, duration * 1000);
  }
  
  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}