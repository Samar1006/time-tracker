import { Component, computed, inject, signal } from '@angular/core';
import { catchError, of, switchMap, tap } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../../core/services/auth.service';
import { TimelineHour, TimelineResponse } from '../../../../core/models/timeline.model';
import { TimelineService } from '../../../../core/services/timeline.service';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../../../../core/constants/categories';
import { formatDuration } from '../../../../core/utils/duration.util';
import { DashboardHeaderComponent } from '../../../dashboard/components/dashboard-header/dashboard-header.component';
import { DashboardSidebarComponent } from '../../../dashboard/components/dashboard-sidebar/dashboard-sidebar.component';
import {
  formatDisplayDate,
  shiftDate,
  toDateInputValue
} from '../../../dashboard/utils/dashboard-stats.util';

@Component({
  selector: 'app-timeline-page',
  imports: [DashboardHeaderComponent, DashboardSidebarComponent],
  templateUrl: './timeline.component.html',
  styleUrl: './timeline.component.scss'
})
export class TimelineComponent {
  private readonly auth = inject(AuthService);
  private readonly timelineService = inject(TimelineService);

  readonly selectedDate = signal(toDateInputValue(new Date()));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private readonly state = toSignal(
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

  readonly timeline = computed(() => this.state());
  readonly activeHours = computed<TimelineHour[]>(() =>
    (this.timeline()?.hours ?? []).filter((hour) => hour.blocks.length > 0)
  );
  readonly hasActivities = computed(() => this.activeHours().length > 0);
  readonly totalTracked = computed(() => formatDuration(this.timeline()?.totalTrackedSec ?? 0));
  readonly displayDate = computed(() => formatDisplayDate(this.selectedDate()));

  previousDay(): void {
    this.selectedDate.update((date) => shiftDate(date, -1));
  }

  nextDay(): void {
    this.selectedDate.update((date) => shiftDate(date, 1));
  }

  categoryColor(category: string): string {
    return CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] ?? CATEGORY_COLORS.uncategorized;
  }

  categoryLabel(category: string): string {
    return CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category;
  }

  duration(seconds: number): string {
    return formatDuration(seconds);
  }
}
