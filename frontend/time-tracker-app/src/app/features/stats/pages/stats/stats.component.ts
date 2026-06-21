import { Component, computed, inject, signal } from '@angular/core';
import { catchError, forkJoin, map, of, switchMap, timeout } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../../core/services/auth.service';
import { TimelineService } from '../../../../core/services/timeline.service';
import { TimelineResponse } from '../../../../core/models/timeline.model';
import { CATEGORY_COLORS } from '../../../../core/constants/categories';
import { formatDuration } from '../../../../core/utils/duration.util';
import { AppShellComponent } from '../../../../shared/layouts/app-shell/app-shell.component';
import { StatCardComponent } from '../../../dashboard/components/stat-card/stat-card.component';
import {
  aggregateTimelineSeconds,
  computeCategoryBreakdown,
  computeTopActivities,
  getWeekDateRange,
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
  imports: [AppShellComponent, StatCardComponent],
  templateUrl: './stats.component.html',
  styleUrl: './stats.component.scss'
})
export class StatsComponent {
  private readonly auth = inject(AuthService);
  private readonly timelineService = inject(TimelineService);

  readonly period = signal<StatsPeriod>('day');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly userId = computed(() => this.auth.user()?.userId ?? null);
  readonly categoryColors = CATEGORY_COLORS;
  readonly formatDuration = formatDuration;

  private readonly statsData = toSignal(
    toObservable(this.auth.user).pipe(
      switchMap((user) => {
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
            const datesToFetch = [...new Set([today, ...weekDates, ...monthDates])];

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
    if (period === 'day') return this.dayTotal();
    if (period === 'week') return this.weekTotal();
    return this.monthTotal();
  });

  readonly activeTimelines = computed(() => {
    const data = this.statsData();
    if (!data) return [] as TimelineResponse[];

    const period = this.period();
    let dates: string[];

    if (period === 'day') {
      dates = [data.today];
    } else if (period === 'week') {
      dates = data.weekDates;
    } else {
      dates = data.monthDates.length ? data.monthDates : [data.today];
    }

    return dates
      .map((date) => data.timelinesByDate.get(date))
      .filter((timeline): timeline is TimelineResponse => !!timeline);
  });

  readonly categoryBreakdown = computed(() => computeCategoryBreakdown(this.activeTimelines()));

  readonly topActivities = computed(() => computeTopActivities(this.activeTimelines(), 8));

  setPeriod(next: StatsPeriod): void {
    this.period.set(next);
  }
}
