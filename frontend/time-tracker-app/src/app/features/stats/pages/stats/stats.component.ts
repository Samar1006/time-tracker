import { Component, computed, inject, signal } from '@angular/core';
import { catchError, combineLatest, forkJoin, map, of, switchMap, timeout } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../../core/services/auth.service';
import { TimelineService } from '../../../../core/services/timeline.service';
import { TimelineResponse } from '../../../../core/models/timeline.model';
import { formatDuration } from '../../../../core/utils/duration.util';
import { AppShellComponent } from '../../../../shared/layouts/app-shell/app-shell.component';
import { DayDateNavComponent } from '../../../../shared/components/day-date-nav/day-date-nav.component';
import { StatCardComponent } from '../../../dashboard/components/stat-card/stat-card.component';
import { ActivityDonutChartComponent } from '../../components/activity-donut-chart/activity-donut-chart.component';
import {
  aggregateTimelineSeconds,
  computeActivityDonutSlices,
  daysInCalendarMonth,
  formatDisplayDate,
  getWeekDateRange,
  shiftDate,
  toDateInputValue,
  toMonthInputValue
} from '../../../dashboard/utils/dashboard-stats.util';

type StatsPeriod = 'day' | 'week' | 'month';

const API_TIMEOUT_MS = 8_000;

interface StatsData {
  timelinesByDate: Map<string, TimelineResponse>;
  monthTotalSec: number;
  today: string;
  weekDates: string[];
  monthDates: string[];
}

@Component({
  selector: 'app-stats',
  imports: [AppShellComponent, StatCardComponent, ActivityDonutChartComponent, DayDateNavComponent],
  templateUrl: './stats.component.html',
  styleUrl: './stats.component.scss'
})
export class StatsComponent {
  private readonly auth = inject(AuthService);
  private readonly timelineService = inject(TimelineService);

  readonly period = signal<StatsPeriod>('day');
  readonly selectedDay = signal(toDateInputValue(new Date()));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly userId = computed(() => this.auth.user()?.userId ?? null);
  readonly formatDuration = formatDuration;
  readonly selectedDayLabel = computed(() => formatDisplayDate(this.selectedDay()));

  readonly activityTotalsByDate = computed(() => {
    const data = this.statsData();
    if (!data) {
      return new Map<string, number>();
    }

    const totals = new Map<string, number>();
    for (const [date, timeline] of data.timelinesByDate) {
      totals.set(date, timeline.totalTrackedSec);
    }
    return totals;
  });

  private readonly statsData = toSignal(
    combineLatest([toObservable(this.auth.user), toObservable(this.selectedDay)]).pipe(
      switchMap(([user, selectedDay]) => {
        const userId = user?.userId;
        if (!userId) {
          this.loading.set(false);
          return of(null);
        }

        this.loading.set(true);
        this.error.set(null);

        const today = toDateInputValue(new Date());
        const month = toMonthInputValue(new Date());
        const weekDates = getWeekDateRange(today);

        return this.timelineService.getMonthSummary(userId, month).pipe(
          timeout(API_TIMEOUT_MS),
          catchError(() => of(null)),
          switchMap((monthSummary) => {
            const monthDates =
              monthSummary?.days.filter((day) => day.totalTrackedSec > 0).map((day) => day.date) ??
              [];
            const datesToFetch = [...new Set([today, selectedDay, ...weekDates, ...monthDates])];

            if (datesToFetch.length === 0) {
              return of({
                timelinesByDate: new Map<string, TimelineResponse>(),
                monthTotalSec: 0,
                today,
                weekDates,
                monthDates
              });
            }

            return forkJoin(
              datesToFetch.map((date) =>
                this.timelineService.getTimeline(userId, date).pipe(
                  timeout(API_TIMEOUT_MS),
                  catchError(() => of(null)),
                  map((timeline) => ({ date, timeline }))
                )
              )
            ).pipe(
              map((results) => {
                const timelinesByDate = new Map<string, TimelineResponse>();
                for (const { date, timeline } of results) {
                  if (timeline) {
                    timelinesByDate.set(date, timeline);
                  }
                }

                const monthTotalSec =
                  monthSummary?.days.reduce((sum, day) => sum + day.totalTrackedSec, 0) ?? 0;

                if (timelinesByDate.size === 0 && !monthSummary) {
                  this.error.set(
                    'Unable to load stats. Make sure the server is running on port 4000.'
                  );
                }

                return {
                  timelinesByDate,
                  monthTotalSec,
                  today,
                  weekDates,
                  monthDates
                };
              })
            );
          })
        );
      }),
      map((data) => {
        this.loading.set(false);
        return data;
      })
    ),
    { initialValue: null as StatsData | null }
  );

  readonly dayViewTotal = computed(() => {
    const data = this.statsData();
    if (!data) return '—';
    const timeline = data.timelinesByDate.get(this.selectedDay());
    return formatDuration(timeline?.totalTrackedSec ?? 0);
  });

  readonly dayTotal = computed(() => {
    const data = this.statsData();
    if (!data) return '—';
    const timeline = data.timelinesByDate.get(data.today);
    return formatDuration(timeline?.totalTrackedSec ?? 0);
  });

  readonly weekTotal = computed(() => {
    const data = this.statsData();
    if (!data) return '—';
    const timelines = data.weekDates
      .map((date) => data.timelinesByDate.get(date))
      .filter((timeline): timeline is TimelineResponse => !!timeline);
    return formatDuration(aggregateTimelineSeconds(timelines));
  });

  readonly monthTotal = computed(() => {
    const data = this.statsData();
    if (!data) return '—';
    return formatDuration(data.monthTotalSec);
  });

  readonly periodTotal = computed(() => {
    const period = this.period();
    if (period === 'day') return this.dayViewTotal();
    if (period === 'week') return this.weekTotal();
    return this.monthTotal();
  });

  readonly activeTimelines = computed(() => {
    const data = this.statsData();
    if (!data) return [] as TimelineResponse[];

    const period = this.period();
    let dates: string[];

    if (period === 'day') {
      dates = [this.selectedDay()];
    } else if (period === 'week') {
      dates = data.weekDates;
    } else {
      dates = data.monthDates.length ? data.monthDates : [data.today];
    }

    return dates
      .map((date) => data.timelinesByDate.get(date))
      .filter((timeline): timeline is TimelineResponse => !!timeline);
  });

  readonly periodDayCount = computed(() => {
    const period = this.period();
    if (period === 'day') return 1;
    if (period === 'week') return 7;
    return daysInCalendarMonth();
  });

  readonly activityDonutSlices = computed(() =>
    computeActivityDonutSlices(this.activeTimelines(), this.periodDayCount())
  );

  readonly hasOnlyUntracked = computed(() => {
    const slices = this.activityDonutSlices();
    return slices.length === 1 && slices[0]?.label === 'untracked';
  });

  setPeriod(next: StatsPeriod): void {
    this.period.set(next);
  }

  previousDay(): void {
    this.selectedDay.set(shiftDate(this.selectedDay(), -1));
  }

  nextDay(): void {
    this.selectedDay.set(shiftDate(this.selectedDay(), 1));
  }

  selectDay(date: string): void {
    this.selectedDay.set(date);
  }
}
