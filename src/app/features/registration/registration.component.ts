// registration.component.ts
import { Component, OnInit, OnDestroy, PLATFORM_ID, Inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { interval, Subscription } from 'rxjs';
import { DeviceRegistrationService } from '../../core/services/device-registration.service';
import { LogService } from '../../core/services/log.service';

@Component({
  selector: 'app-registration',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './registration.component.html',
  styleUrls: ['./registration.component.scss']
})
export class RegistrationComponent implements OnInit, OnDestroy {
  step: 'generate' | 'connecting' | 'error' = 'generate';
  registrationCode: string = '';
  deviceId: string | null = null;
  errorMessage: string = '';
  timeRemaining: number = 30; // 30 minutes expiry
  codeIsSaved: boolean = false; // Flag to show the user their code has been saved
  
  // Default device name with random number
  deviceName: string = `Screen-${Math.floor(1000 + Math.random() * 9000)}`;
  
  private statusCheckInterval: Subscription | null = null;
  private timerInterval: Subscription | null = null;
  private isBrowser: boolean;
  
  constructor(
    private registrationService: DeviceRegistrationService,
    private logService: LogService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: any
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }
  
  ngOnInit(): void {
    // Check if running in browser
    if (!this.isBrowser) {
      return;
    }
    
    // Check if device is already registered
    if (this.registrationService.isDeviceRegistered()) {
      this.deviceId = localStorage.getItem('deviceId');
      this.logService.info('Device already registered, redirecting to player');
      this.router.navigate(['/player']);
      return;
    }
    
    // Start registration process immediately
    this.startRegistration();
  }
  
  ngOnDestroy(): void {
    this.stopPolling();
  }
  
  /**
   * Start the registration process
   */
  private startRegistration(): void {
    // Get or generate a registration code
    this.registrationCode = this.registrationService.getRegistrationCode();
    
    // Set the flag for visual confirmation
    this.codeIsSaved = true;
    
    this.logService.info(`Registration code: ${this.registrationCode} (${this.codeIsSaved ? 'saved' : 'not saved'})`);
    
    // Initialize registration on server
    this.registrationService.initializeRegistration().subscribe(success => {
      if (success) {
        // Start polling for registration status
        this.startPolling();
        
        // Start the countdown timer
        this.startTimer();
      } else {
        this.showError('Failed to initialize registration. Please try again.');
      }
    });
  }
  
  /**
   * Start polling for registration status
   */
  private startPolling(): void {
    // Check every 5 seconds
    this.statusCheckInterval = interval(5000).subscribe(() => {
      this.checkRegistrationStatus();
    });
  }
  
  /**
   * Start the countdown timer
   */
  private startTimer(): void {
    this.timerInterval = interval(60000).subscribe(() => {
      this.timeRemaining--;
      
      if (this.timeRemaining <= 0) {
        // Time expired, restart the registration process
        this.stopPolling();
        this.showError('Registration code expired. Please try again.');
      }
    });
  }
  
  /**
   * Stop all polling and timers
   */
  private stopPolling(): void {
    if (this.statusCheckInterval) {
      this.statusCheckInterval.unsubscribe();
      this.statusCheckInterval = null;
    }
    
    if (this.timerInterval) {
      this.timerInterval.unsubscribe();
      this.timerInterval = null;
    }
  }
  
  /**
   * Check if the registration code has been claimed
   */
  private checkRegistrationStatus(): void {
    this.logService.info(`Checking registration status for code: ${this.registrationCode}`);
    
    this.registrationService.checkRegistrationStatus().subscribe(status => {
      this.logService.info(`Registration status: ${JSON.stringify(status)}`);
      
      if (status.registered && status.deviceId) {
        // Registration successful
        this.step = 'connecting';
        this.deviceId = status.deviceId;
        
        // Stop polling
        this.stopPolling();
        
        // Complete registration
        this.completeRegistration(status.deviceId);
      }
    });
  }
  
  /**
   * Complete the registration process
   */
  private completeRegistration(deviceId: string): void {
    this.logService.info(`Registration claimed, completing setup with device ID: ${deviceId}`);
    
    // Complete the registration
    this.registrationService.completeRegistration(deviceId).subscribe(success => {
      if (success) {
        this.logService.info('Registration completed successfully');
        
        // Navigate to the player
        setTimeout(() => {
          this.router.navigate(['/player']);
        }, 2000);
      } else {
        this.showError('Failed to complete registration. Please try again.');
      }
    });
  }
  
  /**
   * Show an error message
   */
  private showError(message: string): void {
    this.step = 'error';
    this.errorMessage = message;
    this.logService.error(`Registration error: ${message}`);
  }
  
  /**
   * Regenerate a new registration code (if needed)
   */
  regenerateCode(): void {
    this.registrationCode = this.registrationService.generateRegistrationCode();
    this.logService.info(`New registration code generated: ${this.registrationCode}`);
    this.codeIsSaved = true;
    
    // Restart the registration process with new code
    this.restartRegistration();
  }
  
  /**
   * Restart the registration process
   */
  restartRegistration(): void {
    this.timeRemaining = 30;
    this.step = 'generate';
    this.startRegistration();
  }
  
  /**
   * Get browser info for display
   */
  getBrowser(): string {
    if (!this.isBrowser) {
      return 'Server rendering';
    }
    return navigator.userAgent;
  }
  
  /**
   * Get screen resolution for display
   */
  getResolution(): string {
    if (!this.isBrowser) {
      return 'Unknown';
    }
    return `${window.screen.width}x${window.screen.height}`;
  }
}