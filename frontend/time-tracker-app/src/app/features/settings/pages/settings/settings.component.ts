import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../../../core/services/auth.service';
import { DashboardHeaderComponent } from '../../../dashboard/components/dashboard-header/dashboard-header.component';
import { DashboardSidebarComponent } from '../../../dashboard/components/dashboard-sidebar/dashboard-sidebar.component';
import { formatDisplayDate, toDateInputValue } from '../../../dashboard/utils/dashboard-stats.util';

@Component({
  selector: 'app-settings-page',
  imports: [DashboardHeaderComponent, DashboardSidebarComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly displayDate = formatDisplayDate(toDateInputValue(new Date()));
  readonly avatarSrc = 'assets/auth/avatar.png';
  readonly customizeNote = signal<string | null>(null);

  initials(): string {
    return this.auth.initials();
  }

  customize(): void {
    this.customizeNote.set('Avatar customization is coming soon!');
  }

  signOut(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  /** No-op for the shared header's date arrows (not used on Settings). */
  noop(): void {}
}
