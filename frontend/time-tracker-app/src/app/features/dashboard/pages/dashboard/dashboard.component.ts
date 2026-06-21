import { Component, computed, inject, signal } from '@angular/core';
import {
  catchError,
  combineLatest,
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
import { AppShellComponent } from '../../../../shared/layouts/app-shell/app-shell.component';
import { StatCardComponent } from '../../components/stat-card/stat-card.component';
import { TimelineChartComponent } from '../../components/timeline-chart/timeline-chart.component';
import {
  computeDashboardStats,
  getVisibleHours,
  shiftDate,
  toDateInputValue
} from '../../utils/dashboard-stats.util';

const API_TIMEOUT_MS = 8_000;
const REFRESH_MS = 60_000;

@Component({
  selector: 'app-dashboard',
  imports: [
    AppShellComponent,
    StatCardComponent,
    TimelineChartComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  readonly auth = inject(AuthService);
  private readonly timelineService = inject(TimelineService);
  readonly voiceLog = inject(VoiceLogService);

  readonly selectedDate = signal(toDateInputValue(new Date()));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
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
      switchMap(({ date, userId }) => {
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

  readonly timeline = computed(() => this.dashboardState().timeline);
  readonly userId = computed(() => this.auth.user()?.userId ?? null);

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

  previousDay(): void {
    this.selectDate(shiftDate(this.selectedDate(), -1));
  }

  nextDay(): void {
    this.selectDate(shiftDate(this.selectedDate(), 1));
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
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
