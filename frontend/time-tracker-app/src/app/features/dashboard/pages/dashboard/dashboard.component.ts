import { Component, computed, inject, signal } from '@angular/core';
import { catchError, of, switchMap, tap } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../../core/services/auth.service';
import { TimelineResponse } from '../../../../core/models/timeline.model';
import { TimelineService } from '../../../../core/services/timeline.service';
import { DashboardHeaderComponent } from '../../components/dashboard-header/dashboard-header.component';
import { DashboardSidebarComponent } from '../../components/dashboard-sidebar/dashboard-sidebar.component';
import { StatCardComponent } from '../../components/stat-card/stat-card.component';
import { TimelineChartComponent } from '../../components/timeline-chart/timeline-chart.component';
import {
  computeDashboardStats,
  formatDisplayDate,
  getVisibleHours,
  shiftDate,
  toDateInputValue
} from '../../utils/dashboard-stats.util';

@Component({
  selector: 'app-dashboard',
  imports: [
    DashboardHeaderComponent,
    DashboardSidebarComponent,
    StatCardComponent,
    TimelineChartComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly timelineService = inject(TimelineService);

  readonly selectedDate = signal(toDateInputValue(new Date()));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private readonly timelineState = toSignal(
    toObservable(this.selectedDate).pipe(
      tap(() => {
        this.loading.set(true);
        this.error.set(null);
      }),
      switchMap((date) => {
        const user = this.auth.user();
        if (!user) {
          return of(null);
        }

        return this.timelineService.getTimeline(user.userId, date).pipe(
          catchError(() => {
            this.error.set('Unable to load timeline. Make sure the server is running on port 4000.');
            return of(null);
          })
        );
      }),
      tap(() => this.loading.set(false))
    ),
    { initialValue: null as TimelineResponse | null }
  );

  readonly timeline = computed(() => this.timelineState());
  readonly stats = computed(() => {
    const current = this.timeline();
    if (!current) {
      return {
        totalTracked: '—',
        mostActiveCategory: '—',
        mostActiveDuration: '—',
        topApp: '—'
      };
    }

    return computeDashboardStats(current);
  });

  readonly visibleHours = computed(() => {
    const current = this.timeline();
    if (!current) {
      return getVisibleHours([], 8, 18);
    }

    return getVisibleHours(current.hours, 8, 18);
  });

  readonly displayDate = computed(() => formatDisplayDate(this.selectedDate()));

  previousDay(): void {
    this.selectedDate.update((date) => shiftDate(date, -1));
  }

  nextDay(): void {
    this.selectedDate.update((date) => shiftDate(date, 1));
  }

  onVoiceLog(): void {
    // TODO: wire to /api/transcribe and schedule pipeline
    console.log('Voice log clicked');
  }
}
