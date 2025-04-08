// image-item.component.ts
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlaylistItem } from '../../../core/models/playlist.model';
import { LogService } from '../../../core/services/log.service';
import { ContentSyncService } from '../../../core/services/content-sync.service';

@Component({
  selector: 'app-image-item',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="image-container" [ngClass]="scalingClass">
      <img 
        *ngIf="localImageUrl"
        [src]="localImageUrl" 
        [alt]="item?.name || 'Image content'" 
        (load)="onImageLoaded()" 
        (error)="onImageError()"
      />
      <div *ngIf="!localImageUrl && !loading" class="error-placeholder">
        <span class="material-icons">broken_image</span>
        <p>Image could not be loaded</p>
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
    
    .image-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      
      &.fit img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      
      &.fill img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      &.stretch img {
        width: 100%;
        height: 100%;
        object-fit: fill;
      }
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
export class ImageItemComponent implements OnInit, OnDestroy {
  @Input() item: PlaylistItem | null = null;
  @Input() scaling: 'fit' | 'fill' | 'stretch' = 'fit';
  @Input() preload = false; // If true, just preload but don't start timer
  @Output() ended = new EventEmitter<void>();
  
  localImageUrl: string | null = null;
  loading = true;
  private timer: any;
  private originalUrl: string | null = null;
  
  constructor(
    private contentSyncService: ContentSyncService,
    private logService: LogService
  ) {}
  
  ngOnInit(): void {
    this.loading = true; // Make sure this is reset
    this.localImageUrl = null; // Reset the URL
    
    if (!this.item) {
      this.loading = false;
      return;
    }
    
    // Store the original URL to use as fallback if needed
    this.originalUrl = this.item.content.url;
    
    this.loadImage();
  }
  
  ngOnDestroy(): void {
    this.clearTimer();
    
    // Clear the image source to prevent memory leaks
    this.localImageUrl = null;
  }
  
  get scalingClass(): string {
    return this.scaling || 'fit';
  }
  
  onImageLoaded(): void {
    this.loading = false;
    this.logService.info(`Image loaded: ${this.item?.name}`);
    
    // If not in preload mode, start the timer
    if (!this.preload && this.item) {
      this.startTimer();
    }
  }
  
  onImageError(): void {
    this.loading = false;
    
    // Log error with the attempted URL
    this.logService.error(`Failed to load image: ${this.localImageUrl}`);
    
    // If using a cached URL that failed, try the original URL directly
    if (this.localImageUrl !== this.originalUrl && this.originalUrl) {
      this.logService.info(`Trying original URL: ${this.originalUrl}`);
      this.localImageUrl = this.originalUrl;
      return; // Don't start timer yet, wait for the image to load or error again
    }
    
    this.localImageUrl = null;
    
    // Even on error, we need to emit ended event after duration
    if (!this.preload && this.item) {
      this.startTimer();
    }
  }
  
  private loadImage(): void {
    if (!this.item) return;
    
    // First check if we have a local cached version
    this.contentSyncService.getLocalContentUrl(this.item.content.url).subscribe(
      localUrl => {
        this.localImageUrl = localUrl;
        // We'll set loading to false after the image loads
      },
      error => {
        this.logService.error(`Error getting local content: ${error.message}`);
        // Fall back to direct URL
        this.localImageUrl = this.item!.content.url;
      }
    );
  }
  
  private startTimer(): void {
    // Clear any existing timer
    this.clearTimer();
    
    // Set timer for the duration of this item
    if (this.item && this.item.duration > 0) {
      this.timer = setTimeout(() => {
        this.ended.emit();
      }, this.item.duration * 1000); // Convert seconds to milliseconds
    }
  }
  
  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}