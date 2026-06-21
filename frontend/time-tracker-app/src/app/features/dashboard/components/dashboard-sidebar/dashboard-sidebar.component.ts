import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-dashboard-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './dashboard-sidebar.component.html',
  styleUrl: './dashboard-sidebar.component.scss'
})
export class DashboardSidebarComponent {}
