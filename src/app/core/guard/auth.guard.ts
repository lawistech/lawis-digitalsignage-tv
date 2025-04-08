// auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { DeviceRegistrationService } from '../services/device-registration.service';
import { LogService } from '../services/log.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private registrationService: DeviceRegistrationService,
    private logService: LogService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    // Check if device is registered
    if (this.registrationService.isDeviceRegistered()) {
      return true;
    }

    // If not registered, redirect to registration page
    this.logService.warn('Attempted to access protected route without registration');
    return this.router.createUrlTree(['/registration']);
  }
}