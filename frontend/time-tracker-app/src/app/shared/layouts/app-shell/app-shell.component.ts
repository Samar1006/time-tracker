import { Component, input } from '@angular/core';

import { DashboardHeaderComponent } from '../../../features/dashboard/components/dashboard-header/dashboard-header.component';
import { DashboardSidebarComponent } from '../../../features/dashboard/components/dashboard-sidebar/dashboard-sidebar.component';

@Component({
  selector: 'app-shell',
  imports: [DashboardHeaderComponent, DashboardSidebarComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss'
})
export class AppShellComponent {
  readonly userId = input<string | null>(null);
}
