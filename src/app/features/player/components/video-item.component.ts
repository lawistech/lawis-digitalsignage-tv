// video-item.component.ts
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlaylistItem } from '../../../core/models/playlist.model';
import { LogService } from '../../../core/services/log.service';
import { ContentSyncService } from '../../../core/services/content-sync.service';

@Component({
  selector: 'app-video-item',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="video-container" [ngClass]="scalingClass">
      <video #videoElement
        *ngIf="localVideoUrl"
        [src]="localVideoUrl"
        [muted]="muted"
        [loop]="loop"
        [autoplay]="!preload"
        (loadeddata)="onVideoLoaded()"
        (error)="onVideoError($event)"
        (ended)="onVideoEnded()"
        playsinline
      ></video>
      <div *ngIf="!localVideoUrl && !loading" class="error-placeholder">
        <span class="material-icons">videocam_off</span>
        <p>Video could not be loaded</p>
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
    
    .video-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      
      &.fit video {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      
      &.fill video {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      &.stretch video {
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
  `],
})
export class VideoItemComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement') videoElement: ElementRef<HTMLVideoElement> | null = null;
  @Input() item: PlaylistItem | null = null;
  @Input() scaling: 'fit' | 'fill' | 'stretch' = 'fit';
  @Input() muted = true;
  @Input() loop = false;
  @Input() preload = false; // If true, just preload but don't play
  @Output() ended = new EventEmitter<void>();
  
  localVideoUrl: string | null = null;
  loading = true;
  loadError = false;
  private originalUrl: string | null = null;
  private errorRetryTimer: any = null;
  
  constructor(
    private contentSyncService: ContentSyncService,
    private logService: LogService
  ) {}
  
  ngOnInit(): void {
    if (!this.item) {
      this.loading = false;
      return;
    }
    
    // Store the original URL for fallback
    this.originalUrl = this.item.content.url;
    
    this.loadVideo();
  }
  
  ngOnDestroy(): void {
    // Stop video playback when component is destroyed
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.pause();
      this.videoElement.nativeElement.src = '';
      this.videoElement.nativeElement.load();
    }
    
    this.clearErrorRetryTimer();
    
    // Clear the video source to prevent memory leaks
    this.localVideoUrl = null;
  }
  
  get scalingClass(): string {
    return this.scaling || 'fit';
  }
  
  onVideoLoaded(): void {
    this.loading = false;
    this.logService.info(`Video loaded: ${this.item?.name}`);
    
    // Start playing if not in preload mode
    if (!this.preload && this.videoElement?.nativeElement) {
      const playPromise = this.videoElement.nativeElement.play();
      
      // Handle play promise (might be rejected if browser prevents autoplay)
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          this.logService.error(`Error playing video: ${error}`);
          // If video can't autoplay, we still need to move to the next item
          if (!this.loop) {
            setTimeout(() => this.ended.emit(), 1000);
          }
        });
      }
    }
  }
  
  onVideoError(event: any): void {
    this.loading = false;
    this.loadError = true;
    
    // Log the detailed error
    const videoElement = this.videoElement?.nativeElement;
    const errorCode = videoElement ? videoElement.error?.code : 'unknown';
    const errorMessage = videoElement ? videoElement.error?.message : 'unknown';
    
    this.logService.error(`Video error: ${errorCode} - ${errorMessage} for URL: ${this.localVideoUrl}`);
    
    // If using a cached URL that failed, try the original URL directly
    if (this.localVideoUrl !== this.originalUrl && this.originalUrl) {
      this.logService.info(`Trying original URL: ${this.originalUrl}`);
      this.localVideoUrl = this.originalUrl;
      return; // Let the video element try with the new URL
    }
    
    // Even on error, we need to emit ended event
    if (!this.preload) {
      this.errorRetryTimer = setTimeout(() => this.ended.emit(), 1000);
    }
  }
  
  onVideoEnded(): void {
    if (!this.loop) {
      this.ended.emit();
    }
  }
  
  private loadVideo(): void {
    if (!this.item) return;
    
    // First check if we have a local cached version
    this.contentSyncService.getLocalContentUrl(this.item.content.url).subscribe(
      localUrl => {
        this.localVideoUrl = localUrl;
        // We'll set loading to false after the video loads
      },
      error => {
        this.logService.error(`Error getting local content: ${error.message}`);
        // Fall back to direct URL
        this.localVideoUrl = this.item!.content.url;
      }
    );
  }
  
  private clearErrorRetryTimer(): void {
    if (this.errorRetryTimer) {
      clearTimeout(this.errorRetryTimer);
      this.errorRetryTimer = null;
    }
  }
}