import { Component, computed, effect, inject, signal } from '@angular/core';
import {
  catchError,
  combineLatest,
  exhaustMap,
  finalize,
  interval,
  map,
  of,
  startWith,
  switchMap,
  timeout
} from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../../core/services/auth.service';
import { TimelineService } from '../../../../core/services/timeline.service';
import { VoiceLogService } from '../../../../core/services/voice-log.service';
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
  formatDisplayDate,
  getVisibleHours,
  shiftDate,
  toDateInputValue
} from '../../utils/dashboard-stats.util';

const API_TIMEOUT_MS = 8_000;
const SUMMARY_TIMEOUT_MS = 15_000;
const REFRESH_MS = 60_000;

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
  readonly voiceLog = inject(VoiceLogService);

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
  readonly monthTotals = signal(new Map<string, number>());
  readonly lastHeard = signal<string | null>(null);
  readonly voiceError = signal<string | null>(null);
  private readonly reloadTick = signal(0);

  private readonly dashboardState = toSignal(
    combineLatest([
      toObservable(this.selectedDate),
      toObservable(this.auth.user),
      toObservable(this.reloadTick)
    ]).pipe(
      switchMap(([date, user]) =>
        interval(REFRESH_MS).pipe(
          startWith(0),
          map(() => ({ date, userId: user?.userId ?? null }))
        )
      ),
      exhaustMap(({ date, userId }) => {
        this.loading.set(true);
        this.error.set(null);

        if (!userId) {
          this.loading.set(false);
          return of({ timeline: null });
        }

        return this.timelineService.getTimeline(userId, date).pipe(
          timeout(API_TIMEOUT_MS),
          catchError(() => of(null)),
          map((timeline) => {
            if (!timeline) {
              this.error.set(
                'Unable to load timeline. Make sure the server is running on port 4000.'
              );
            }
            return { timeline };
          }),
          finalize(() => this.loading.set(false))
        );
      })
    ),
    {
      initialValue: { timeline: null }
    }
  );

  /** Keeps month summary fetch alive; totals written to monthTotals signal. */
  private readonly _monthSummarySubscription = toSignal(
    combineLatest([
      toObservable(this.visibleMonth),
      toObservable(this.auth.user)
    ]).pipe(
      switchMap(([month, user]) =>
        interval(REFRESH_MS).pipe(
          startWith(0),
          map(() => ({ month, userId: user?.userId ?? null }))
        )
      ),
      exhaustMap(({ month, userId }) => {
        if (!userId) {
          this.monthTotals.set(new Map());
          return of(new Map<string, number>());
        }

        return this.timelineService.getMonthSummary(userId, month).pipe(
          timeout(SUMMARY_TIMEOUT_MS),
          map((summary) => new Map(summary.days.map((day) => [day.date, day.totalTrackedSec]))),
          catchError(() => of(new Map<string, number>())),
          map((totals) => {
            this.monthTotals.set(totals);
            return totals;
          })
        );
      })
    ),
    { initialValue: new Map<string, number>() }
  );

  readonly timeline = computed(() => this.dashboardState().timeline);
  readonly userId = computed(() => this.auth.user()?.userId ?? null);
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

  readonly dayHours = computed(() => {
    const current = this.timeline();
    return getVisibleHours(current?.hours ?? [], 0, 23);
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

  async onVoiceLog(): Promise<void> {
    this.voiceError.set(null);
    try {
      const result = await this.voiceLog.toggle(this.selectedDate());
      if (!result) return;

      if (!result.transcript) {
        this.voiceError.set(
          'No speech detected. Speak for a few seconds, then tap Stop.',
        );
        return;
      }

      this.lastHeard.set(result.transcript);
      if (result.added > 0) {
        this.reloadTick.update((n) => n + 1);
      } else if (result.parsed > 0) {
        this.voiceError.set(
          'Heard you, but could not place times on the timeline. Try mentioning times like "9 to 10 AM".',
        );
      } else {
        this.voiceError.set(
          'Heard you, but could not parse activities. Try "9 to 10 AM coding, then lunch".',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voice log failed';
      this.voiceError.set(msg);
    }
  }
}
