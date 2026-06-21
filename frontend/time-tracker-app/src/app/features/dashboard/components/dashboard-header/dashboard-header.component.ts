import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../../../core/services/auth.service';
import { ThemeService } from '../../../../core/services/theme.service';

@Component({
  selector: 'app-dashboard-header',
  templateUrl: './dashboard-header.component.html',
  styleUrl: './dashboard-header.component.scss'
})
export class DashboardHeaderComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);

  readonly user = this.auth.user;

  toggleTheme(): void {
    this.theme.toggle();
  }

  initials(): string {
    return this.auth.initials();
  }

  goHistory(): void {
    void this.router.navigate(['/history']);
  }

  goSettings(): void {
    void this.router.navigate(['/settings']);
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
