// app-routing.module.ts
import { Routes } from '@angular/router';
import { AuthGuard } from './core/guard/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'player',
    pathMatch: 'full'
  },
  {
    path: 'registration',
    loadComponent: () => import('./features/registration/registration.component').then(m => m.RegistrationComponent),
    // Disable SSR for this route
    data: { ssr: false }
  },
  {
    path: 'player',
    loadComponent: () => import('./features/player/player.component').then(m => m.PlayerComponent),
   canActivate: [AuthGuard],
    // Disable SSR for this route
    data: { ssr: false }
  },
  {
    path: 'diagnostics',
    loadComponent: () => import('./features/diagnostics/diagnostics.component').then(m => m.DiagnosticsComponent),
    canActivate: [AuthGuard],
    // Disable SSR for this route
    data: { ssr: false }
  },
  {
    path: '**',
    redirectTo: 'player'
  }
];