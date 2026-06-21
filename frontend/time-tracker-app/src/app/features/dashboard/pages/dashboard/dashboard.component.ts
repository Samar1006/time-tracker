import { Component, computed, inject, signal } from '@angular/core';
import { catchError, combineLatest, map, of, switchMap, tap } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../../core/services/auth.service';
import { TimelineResponse } from '../../../../core/models/timeline.model';
import { TimelineService } from '../../../../core/services/timeline.service';
import { ActivityCalendarComponent } from '../../components/activity-calendar/activity-calendar.component';
import { DashboardHeaderComponent } from '../../components/dashboard-header/dashboard-header.component';
import { DashboardSidebarComponent } from '../../components/dashboard-sidebar/dashboard-sidebar.component';
import { StatCardComponent } from '../../components/stat-card/stat-card.component';
import { TimelineChartComponent } from '../../components/timeline-chart/timeline-chart.component';
import {
  buildCalendarGrid,
  formatMonthLabel,
  monthKeyFromDate,
  shiftMonth
} from '../../utils/calendar.util';
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
    ActivityCalendarComponent,
    TimelineChartComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly timelineService = inject(TimelineService);

  readonly selectedDate = signal(toDateInputValue(new Date()));
  readonly visibleMonth = signal(monthKeyFromDate(toDateInputValue(new Date())));
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

  private readonly monthSummaryState = toSignal(
    combineLatest([toObservable(this.visibleMonth), toObservable(this.auth.user)]).pipe(
      switchMap(([month, user]) => {
        if (!user) {
          return of(new Map<string, number>());
        }

        return this.timelineService.getMonthSummary(user.userId, month).pipe(
          map((summary) => new Map(summary.days.map((day) => [day.date, day.totalTrackedSec]))),
          catchError(() => of(new Map<string, number>()))
        );
      })
    ),
    { initialValue: new Map<string, number>() }
  );

  readonly timeline = computed(() => this.timelineState());
  readonly monthTotals = computed(() => this.monthSummaryState());
  readonly calendarCells = computed(() =>
    buildCalendarGrid(this.visibleMonth(), this.selectedDate(), this.monthTotals())
  );
  readonly calendarMonthLabel = computed(() => formatMonthLabel(this.visibleMonth()));

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
    this.selectDate(shiftDate(this.selectedDate(), -1));
  }

  nextDay(): void {
    this.selectDate(shiftDate(this.selectedDate(), 1));
  }

  previousMonth(): void {
    this.visibleMonth.update((month) => shiftMonth(month, -1));
  }

  nextMonth(): void {
    this.visibleMonth.update((month) => shiftMonth(month, 1));
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    this.visibleMonth.set(monthKeyFromDate(date));
  }

  onVoiceLog(): void {
    console.log('Voice log clicked');
  }
}
