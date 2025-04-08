// ticker-item.component.ts
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlaylistItem } from '../../../core/models/playlist.model';
import { LogService } from '../../../core/services/log.service';

@Component({
  selector: 'app-ticker-item',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ticker-container">
      @if (item && !loading) {
        <div class="ticker-content" [ngStyle]="getTickerStyle()">
          {{ tickerText }}
        </div>
      }

      @if (loading) {
        <div class="loading-indicator">
          <div class="spinner"></div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    
    .ticker-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      overflow: hidden;
    }
    
    .ticker-content {
      white-space: nowrap;
      font-size: 2rem;
      font-weight: bold;
      animation: ticker-scroll 20s linear infinite;
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
    
    @keyframes ticker-scroll {
      from {
        transform: translateX(100%);
      }
      to {
        transform: translateX(-100%);
      }
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class TickerItemComponent implements OnInit, OnDestroy {
  @Input() item: PlaylistItem | null = null;
  @Input() preload = false; // Add this input property to fix the error
  @Input() duration: number = 10;
  @Output() ended = new EventEmitter<void>();
  
  tickerText: string = '';
  loading = true;
  private timer: any;
  
  constructor(private logService: LogService) {}
  
  ngOnInit(): void {
    this.loading = true;
    
    if (!this.item) {
      this.loading = false;
      return;
    }
    
    // For a ticker, the content URL actually contains the text
    this.tickerText = this.item.content.url;
    this.loading = false;
    
    // If not in preload mode, start the timer for duration
    if (!this.preload) {
      this.startTimer();
    }
  }
  
  ngOnDestroy(): void {
    this.clearTimer();
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
  
  getTickerStyle(): any {
    // Add any custom styling for the ticker
    return {
      color: 'white',
      fontSize: '2rem',
      textShadow: '2px 2px 4px rgba(0, 0, 0, 0.5)'
    };
  }
}