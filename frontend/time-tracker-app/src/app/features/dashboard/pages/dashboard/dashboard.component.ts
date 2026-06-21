import { Component, computed, effect, inject, signal } from '@angular/core';
import {
  catchError,
  combineLatest,
  exhaustMap,
  finalize,
  forkJoin,
  interval,
  map,
  of,
  startWith,
  switchMap,
  timeout
} from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../../core/services/auth.service';
import { MonitorService } from '../../../../core/services/monitor.service';
import { TimelineResponse } from '../../../../core/models/timeline.model';
import { ExtensionStatus, MonitorStatusResponse } from '../../../../core/models/monitor.model';
import { TimelineService } from '../../../../core/services/timeline.service';
import { ActivityCalendarComponent } from '../../components/activity-calendar/activity-calendar.component';
import { DashboardHeaderComponent } from '../../components/dashboard-header/dashboard-header.component';
import { DashboardSidebarComponent } from '../../components/dashboard-sidebar/dashboard-sidebar.component';
import { StatCardComponent } from '../../components/stat-card/stat-card.component';
import { TimelineChartComponent } from '../../components/timeline-chart/timeline-chart.component';
import {
  buildCalendarGrid,
  clampDateToMonth,
  formatMonthLabel,
  monthKeyFromDate,
  shiftMonth
} from '../../utils/calendar.util';
import {
  computeDashboardStats,
  computeVisibleHourRange,
  formatDisplayDate,
  getVisibleHours,
  hasDemoData,
  hasLiveTrackedData,
  shiftDate,
  toDateInputValue
} from '../../utils/dashboard-stats.util';

const API_TIMEOUT_MS = 8_000;
const REFRESH_MS = 60_000;

interface DashboardData {
  timeline: TimelineResponse | null;
  monthTotals: Map<string, number>;
  monitor: MonitorStatusResponse | null;
}

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
  readonly auth = inject(AuthService);
  private readonly timelineService = inject(TimelineService);
  private readonly monitorService = inject(MonitorService);

  constructor() {
    effect(() => {
      const month = monthKeyFromDate(this.selectedDate());
      if (this.visibleMonth() !== month) {
        this.visibleMonth.set(month);
      }
    });
  }

  readonly selectedDate = signal(toDateInputValue(new Date()));
  readonly visibleMonth = signal(monthKeyFromDate(toDateInputValue(new Date())));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly copyStatus = signal<string | null>(null);

  private readonly dashboardState = toSignal(
    combineLatest([
      toObservable(this.selectedDate),
      toObservable(this.visibleMonth),
      toObservable(this.auth.user)
    ]).pipe(
      switchMap(([date, month, user]) =>
        interval(REFRESH_MS).pipe(
          startWith(0),
          map(() => ({ date, month, userId: user?.userId ?? null }))
        )
      ),
      exhaustMap(({ date, month, userId }) => {
        this.loading.set(true);
        this.error.set(null);

        if (!userId) {
          this.loading.set(false);
          return of({
            timeline: null,
            monthTotals: new Map<string, number>(),
            monitor: null
          } satisfies DashboardData);
        }

        return forkJoin({
          timeline: this.timelineService.getTimeline(userId, date).pipe(
            timeout(API_TIMEOUT_MS),
            catchError(() => of(null))
          ),
          summary: this.timelineService.getMonthSummary(userId, month).pipe(
            timeout(API_TIMEOUT_MS),
            catchError(() => of(null))
          ),
          monitor: this.monitorService.getStatus(userId, date).pipe(
            timeout(API_TIMEOUT_MS),
            catchError(() => of(null))
          )
        }).pipe(
          map(({ timeline, summary, monitor }) => {
            if (!timeline) {
              this.error.set(
                'Unable to load timeline. Make sure the server is running on port 4000.'
              );
            }
            return {
              timeline,
              monthTotals: summary
                ? new Map(summary.days.map((day) => [day.date, day.totalTrackedSec]))
                : new Map<string, number>(),
              monitor
            } satisfies DashboardData;
          }),
          finalize(() => this.loading.set(false))
        );
      })
    ),
    {
      initialValue: {
        timeline: null,
        monthTotals: new Map<string, number>(),
        monitor: null
      } satisfies DashboardData
    }
  );

  private readonly extensionState = toSignal(
    interval(30_000).pipe(
      startWith(0),
      exhaustMap(() => this.monitorService.watchExtensionStatus())
    ),
    { initialValue: { connected: false } as ExtensionStatus }
  );

  readonly timeline = computed(() => this.dashboardState().timeline);
  readonly monthTotals = computed(() => this.dashboardState().monthTotals);
  readonly monitorStatus = computed(() => this.dashboardState().monitor);
  readonly userId = computed(() => this.auth.user()?.userId ?? null);
  readonly hasLiveData = computed(() => hasLiveTrackedData(this.timeline()));
  readonly showingDemoData = computed(() => hasDemoData(this.timeline()));
  readonly extensionStatus = computed(() => this.extensionState());
  readonly lastSyncLabel = computed(() =>
    this.monitorService.formatLastSync(this.monitorStatus()?.lastEventAt ?? null)
  );
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
    const { startHour, endHour } = computeVisibleHourRange(
      current?.hours ?? [],
      this.selectedDate()
    );

    if (!current) {
      return getVisibleHours([], startHour, endHour);
    }

    return getVisibleHours(current.hours, startHour, endHour);
  });

  readonly displayDate = computed(() => formatDisplayDate(this.selectedDate()));

  previousDay(): void {
    this.selectDate(shiftDate(this.selectedDate(), -1));
  }

  nextDay(): void {
    this.selectDate(shiftDate(this.selectedDate(), 1));
  }

  previousMonth(): void {
    this.syncMonth(shiftMonth(this.visibleMonth(), -1));
  }

  nextMonth(): void {
    this.syncMonth(shiftMonth(this.visibleMonth(), 1));
  }

  private syncMonth(month: string): void {
    this.visibleMonth.set(month);
    this.selectedDate.set(clampDateToMonth(month, this.selectedDate()));
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    this.visibleMonth.set(monthKeyFromDate(date));
  }

  onVoiceLog(): void {
    console.log('Voice log clicked');
  }

  async copyUserId(): Promise<void> {
    const id = this.userId();
    if (!id) return;

    try {
      await navigator.clipboard.writeText(id);
      this.copyStatus.set('Copied');
      setTimeout(() => this.copyStatus.set(null), 2000);
    } catch {
      this.copyStatus.set('Copy failed');
    }
  }
}
