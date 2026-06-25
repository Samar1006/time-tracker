import { Component, HostListener, computed, inject, signal } from '@angular/core';
import {
  catchError,
  combineLatest,
  finalize,
  firstValueFrom,
  interval,
  map,
  of,
  startWith,
  switchMap,
  timeout
} from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../../../core/services/auth.service';
import { TimelineService, CreateEventPayload } from '../../../../core/services/timeline.service';
import { TimelineUndoService } from '../../../../core/services/timeline-undo.service';
import { VoiceLogService } from '../../../../core/services/voice-log.service';
import { AppShellComponent } from '../../../../shared/layouts/app-shell/app-shell.component';
import { TimelineChartComponent } from '../../components/timeline-chart/timeline-chart.component';
import {
  BlockDeletePayload,
  EventCreateDraft,
  EventTimeChangePayload,
  EventTimePatch
} from '../../components/timeline-chart/timeline-drag.util';
import { TimelineBlock, TimelineResponse } from '../../../../core/models/timeline.model';
import {
  getVisibleHours,
  shiftDate,
  toDateInputValue
} from '../../utils/dashboard-stats.util';

const API_TIMEOUT_MS = 8_000;
const REFRESH_MS = 60_000;

@Component({
  selector: 'app-dashboard',
  imports: [AppShellComponent, TimelineChartComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  readonly auth = inject(AuthService);
  private readonly timelineService = inject(TimelineService);
  readonly undoService = inject(TimelineUndoService);
  readonly voiceLog = inject(VoiceLogService);

  readonly selectedDate = signal(toDateInputValue(new Date()));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly lastHeard = signal<string | null>(null);
  readonly voiceError = signal<string | null>(null);
  readonly patchError = signal<string | null>(null);
  readonly createBusy = signal(false);
  private readonly reloadTick = signal(0);
  private readonly softRefresh = signal(false);
  private readonly cachedTimeline = signal<TimelineResponse | null>(null);

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
        const cached = this.cachedTimeline();
        const hasCachedForDate = cached?.date === date;
        const keepTimelineMounted = this.softRefresh() || hasCachedForDate;
        if (!keepTimelineMounted) {
          this.loading.set(true);
        }
        this.error.set(null);

        if (!userId) {
          this.loading.set(false);
          this.softRefresh.set(false);
          return of({ timeline: null });
        }

        return this.timelineService.getTimeline(userId, date).pipe(
          timeout(API_TIMEOUT_MS),
          catchError(() => {
            if (hasCachedForDate && cached) {
              return of(cached);
            }
            return of(null);
          }),
          map((timeline) => {
            if (timeline) {
              this.cachedTimeline.set(timeline);
              return { timeline };
            }

            if (hasCachedForDate && cached) {
              return { timeline: cached };
            }

            this.error.set(
              'Unable to load timeline. Make sure the server is running on port 4000.'
            );
            return { timeline: null };
          }),
          finalize(() => {
            this.loading.set(false);
            this.softRefresh.set(false);
          })
        );
      })
    ),
    {
      initialValue: { timeline: null }
    }
  );

  readonly timeline = computed(() => this.dashboardState().timeline);
  readonly displayTimeline = computed(() => {
    const viewDate = this.selectedDate();
    const current = this.timeline();
    if (current?.date === viewDate) {
      return current;
    }
    const cached = this.cachedTimeline();
    if (cached?.date === viewDate) {
      return cached;
    }
    return current;
  });
  readonly userId = computed(() => this.auth.user()?.userId ?? null);

  readonly dayHours = computed(() => {
    const current = this.displayTimeline();
    return getVisibleHours(current?.hours ?? [], 0, 23);
  });

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    const el = event.target as HTMLElement;
    if (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    if (!mod || (event.key !== 'z' && event.key !== 'Z')) {
      return;
    }

    event.preventDefault();

    if (event.shiftKey) {
      void this.performRedo();
    } else {
      void this.performUndo();
    }
  }

  previousDay(): void {
    this.selectDate(shiftDate(this.selectedDate(), -1));
  }

  nextDay(): void {
    this.selectDate(shiftDate(this.selectedDate(), 1));
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
  }

  onEventTimeChange(change: EventTimeChangePayload): void {
    const viewDate = this.selectedDate();
    this.patchError.set(null);
    this.softRefresh.set(true);

    this.timelineService
      .updateEvent(change.next.eventId, {
        timestamp: change.next.timestamp,
        durationSec: change.next.durationSec,
        metadata: change.next.metadata
      })
      .subscribe({
        next: () => {
          this.reloadTick.update((n) => n + 1);
          this.undoService.record({
            label: change.label,
            viewDate,
            undo: () => this.applyEventPatch(change.previous),
            redo: () => this.applyEventPatch(change.next)
          });
        },
        error: () => {
          this.softRefresh.set(false);
          this.patchError.set('Could not save timeline change. Your edit was reverted.');
        }
      });
  }

  onActivityCreate(draft: EventCreateDraft): void {
    const viewDate = this.selectedDate();
    this.patchError.set(null);
    this.softRefresh.set(true);
    this.createBusy.set(true);

    this.timelineService.createEvent(draft).subscribe({
      next: (response) => {
        this.reloadTick.update((n) => n + 1);
        const createdId = response.ids[0];
        if (!createdId) {
          return;
        }

        let currentId = createdId;
        this.undoService.record({
          label: 'Create block',
          viewDate,
          undo: () => this.deleteEventForUndo(currentId, viewDate),
          redo: async () => {
            const res = await this.createEventForUndo(draft);
            currentId = res.ids[0];
          }
        });
      },
      error: () => {
        this.softRefresh.set(false);
        this.patchError.set('Could not create activity. Try again.');
      },
      complete: () => this.createBusy.set(false)
    });
  }

  onBlockDelete(payload: BlockDeletePayload): void {
    if (!this.userId()) {
      return;
    }

    const viewDate = this.selectedDate();
    this.patchError.set(null);
    this.softRefresh.set(true);

    this.timelineService.deleteEvent(payload.eventId, viewDate).subscribe({
      next: () => {
        this.reloadTick.update((n) => n + 1);

        let restoredId: string | undefined;
        this.undoService.record({
          label: 'Delete block',
          viewDate,
          undo: async () => {
            const res = await this.createEventForUndo(payload.restore);
            restoredId = res.ids[0];
          },
          redo: async () => {
            if (restoredId) {
              await this.deleteEventForUndo(restoredId, viewDate);
            }
          }
        });
      },
      error: () => {
        this.softRefresh.set(false);
        this.patchError.set('Could not delete this time block.');
      }
    });
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
      if (result.added > 0 || result.updated > 0) {
        if (result.navigateToDate && result.navigateToDate !== this.selectedDate()) {
          this.selectedDate.set(result.navigateToDate);
        }
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

  private async performUndo(): Promise<void> {
    const entry = this.undoService.peekUndo();
    if (!entry) {
      return;
    }

    this.navigateToEntryDate(entry.viewDate);
    this.patchError.set(null);
    this.softRefresh.set(true);

    try {
      await this.undoService.undo();
      this.reloadTick.update((n) => n + 1);
    } catch {
      this.softRefresh.set(false);
      this.patchError.set('Could not undo timeline change.');
    }
  }

  private async performRedo(): Promise<void> {
    const entry = this.undoService.peekRedo();
    if (!entry) {
      return;
    }

    this.navigateToEntryDate(entry.viewDate);
    this.patchError.set(null);
    this.softRefresh.set(true);

    try {
      await this.undoService.redo();
      this.reloadTick.update((n) => n + 1);
    } catch {
      this.softRefresh.set(false);
      this.patchError.set('Could not redo timeline change.');
    }
  }

  private navigateToEntryDate(viewDate: string): void {
    if (viewDate !== this.selectedDate()) {
      this.selectedDate.set(viewDate);
    }
  }

  private applyEventPatch(patch: EventTimePatch): Promise<void> {
    return firstValueFrom(
      this.timelineService.updateEvent(patch.eventId, {
        timestamp: patch.timestamp,
        durationSec: patch.durationSec,
        metadata: patch.metadata
      })
    ).then(() => undefined);
  }

  private deleteEventForUndo(eventId: string, viewDate: string): Promise<void> {
    return firstValueFrom(this.timelineService.deleteEvent(eventId, viewDate)).then(() => undefined);
  }

  private createEventForUndo(payload: CreateEventPayload) {
    return firstValueFrom(this.timelineService.createEvent(payload));
  }
}
