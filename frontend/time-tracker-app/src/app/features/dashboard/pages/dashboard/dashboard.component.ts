import { Component, computed, inject, signal } from '@angular/core';
import { catchError, finalize, of, switchMap, tap } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../../core/services/auth.service';
import { ParsedScheduleBlock, TimelineResponse } from '../../../../core/models/timeline.model';
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
import {
  ParsedTimelineDay,
  scheduleBlocksToTimelineDays
} from '../../utils/ai-schedule-timeline.util';

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
  readonly aiTranscript = signal(
    'Yesterday from 11 PM to 1 AM I studied. Today from 9 to 10 I coded the dashboard. Tomorrow at 2 PM I have a meeting for 1 hour.'
  );
  readonly aiLoading = signal(false);
  readonly aiError = signal<string | null>(null);
  readonly parsedScheduleBlocks = signal<ParsedScheduleBlock[]>([]);

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
  readonly parsedTimelineDays = computed<ParsedTimelineDay[]>(() =>
    scheduleBlocksToTimelineDays(this.parsedScheduleBlocks())
  );

  previousDay(): void {
    this.selectedDate.update((date) => shiftDate(date, -1));
  }

  nextDay(): void {
    this.selectedDate.update((date) => shiftDate(date, 1));
  }

  onVoiceLog(): void {
    this.parseAiSchedule();
  }

  parseAiSchedule(): void {
    const transcript = this.aiTranscript().trim();
    if (!transcript) {
      this.aiError.set('Describe your day first so AI has something to parse.');
      return;
    }

    this.aiLoading.set(true);
    this.aiError.set(null);

    this.timelineService.parseSchedule(transcript, this.selectedDate()).pipe(
      finalize(() => this.aiLoading.set(false))
    ).subscribe({
      next: (result) => this.parsedScheduleBlocks.set(result.blocks),
      error: () => {
        this.aiError.set('Unable to parse schedule. Make sure the backend is running on port 4000.');
      }
    });
  }
}
