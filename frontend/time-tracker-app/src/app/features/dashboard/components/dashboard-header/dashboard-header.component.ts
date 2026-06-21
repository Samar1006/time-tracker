import { Component, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-dashboard-header',
  templateUrl: './dashboard-header.component.html',
  styleUrl: './dashboard-header.component.scss'
})
export class DashboardHeaderComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly displayDate = input.required<string>();
  readonly prevDay = output<void>();
  readonly nextDay = output<void>();

  initials(): string {
    return this.auth.initials();
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
