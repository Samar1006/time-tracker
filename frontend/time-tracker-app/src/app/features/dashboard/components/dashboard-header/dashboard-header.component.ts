import { Component, inject } from '@angular/core';
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

  initials(): string {
    return this.auth.initials();
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
