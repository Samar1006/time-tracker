import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/pages/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'signup',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/pages/signup/signup.component').then((m) => m.SignupComponent)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/pages/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      )
  },
  {
    path: 'stats',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/stats/pages/stats/stats.component').then((m) => m.StatsComponent)
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/pages/settings/settings.component').then(
        (m) => m.SettingsComponent
      )
  },
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
