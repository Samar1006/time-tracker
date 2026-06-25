import { Component, HostListener, computed, inject, signal } from '@angular/core';
import {
  catchError,
  combineLatest,
  finalize,
  firstValueFrom,
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
import { TimelineService, CreateEventPayload } from '../../../../core/services/timeline.service';
import { TimelineUndoService } from '../../../../core/services/timeline-undo.service';
import { TimelineKeyboardSettingsService } from '../../../../core/services/timeline-keyboard-settings.service';
import { VoiceLogService } from '../../../../core/services/voice-log.service';
import { AppShellComponent } from '../../../../shared/layouts/app-shell/app-shell.component';
import { TimelineChartComponent } from '../../components/timeline-chart/timeline-chart.component';
import {
  ActivityRenamePayload,
  BlockDeletePayload,
  BlocksDayShiftPayload,
  EventCreateDraft,
  EventRenamePatch,
  EventTimeChangePayload,
  EventTimePatch
} from '../../components/timeline-chart/timeline-drag.util';
import { TimelineBlock, TimelineResponse } from '../../../../core/models/timeline.model';
import {
  getVisibleHours,
  shiftDate,
  toDateInputValue
} from '../../utils/dashboard-stats.util';
import {
  applyDayShiftToTimelineCache,
  applyEventCreateToTimeline,
  applyEventRenameToTimeline,
  applyEventTimeChangeToTimeline,
  emptyTimelineForDate,
  removeEventFromTimeline
} from '../../utils/timeline-optimistic.util';

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
  private readonly keyboardSettings = inject(TimelineKeyboardSettingsService);
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
  readonly hasLoadedTimeline = signal(false);
  private readonly timelineByDate = signal<ReadonlyMap<string, TimelineResponse>>(new Map());
  /** Survives timeline chart remounts during day-shift reloads. */
  readonly preservedSelectionIds = signal<readonly string[]>([]);

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
        const cached = this.timelineByDate().get(date);
        const hasCachedForDate = Boolean(cached);
        const keepTimelineMounted =
          this.softRefresh() || hasCachedForDate || this.hasLoadedTimeline();
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
            if (cached) {
              return of(cached);
            }
            return of(null);
          }),
          map((timeline) => {
            if (timeline) {
              this.hasLoadedTimeline.set(true);
              this.timelineByDate.update((entries) => {
                const next = new Map(entries);
                next.set(date, timeline);
                return next;
              });
              return { timeline };
            }

            if (cached) {
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
    const cached = this.timelineByDate().get(viewDate);
    if (cached) {
      return cached;
    }
    const current = this.timeline();
    if (current?.date === viewDate) {
      return current;
    }
    if (this.hasLoadedTimeline()) {
      const userId = this.userId() ?? '';
      const timezone =
        current?.timezone ??
        [...this.timelineByDate().values()].find((entry) => entry.timezone)?.timezone ??
        'UTC';
      return emptyTimelineForDate(viewDate, timezone, userId);
    }
    return null;
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

    if (mod && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      if (event.shiftKey) {
        void this.performRedo();
      } else {
        void this.performUndo();
      }
      return;
    }

    if (event.key === 'u' && !mod && !event.altKey && !event.shiftKey) {
      if (!this.keyboardSettings.vimMotionsEnabled()) {
        return;
      }
      event.preventDefault();
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

    this.preservedSelectionIds.update((ids) =>
      ids.includes(change.next.eventId) ? ids : [...ids, change.next.eventId]
    );

    const timeline = this.displayTimeline();
    if (timeline) {
      this.setTimelineCache(
        viewDate,
        applyEventTimeChangeToTimeline(timeline, change)
      );
    }

    this.timelineService
      .updateEvent(change.next.eventId, {
        timestamp: change.next.timestamp,
        durationSec: change.next.durationSec,
        metadata: change.next.metadata
      })
      .subscribe({
        next: () => {
          this.softRefresh.set(false);
          this.undoService.record({
            label: change.label,
            viewDate,
            undo: () => this.applyEventPatch(change.previous),
            redo: () => this.applyEventPatch(change.next)
          });
        },
        error: () => {
          const current = this.displayTimeline();
          if (current) {
            this.setTimelineCache(
              viewDate,
              applyEventTimeChangeToTimeline(current, { next: change.previous })
            );
          }
          this.softRefresh.set(false);
          this.patchError.set('Could not save timeline change. Your edit was reverted.');
        }
      });
  }

  onActivityRename(change: ActivityRenamePayload): void {
    const viewDate = this.selectedDate();
    this.patchError.set(null);
    this.softRefresh.set(true);
    this.preservedSelectionIds.set([]);

    this.timelineService
      .categorizeActivity(change.next.title)
      .pipe(
        catchError(() =>
          of({ category: 'uncategorized', confidence: 0, method: 'none' })
        ),
        switchMap(({ category, confidence }) => {
          const classified: ActivityRenamePayload = {
            ...change,
            next: {
              ...change.next,
              metadata: {
                ...change.next.metadata,
                category,
                confidence
              }
            }
          };

          const timeline = this.displayTimeline();
          if (timeline) {
            this.setTimelineCache(viewDate, applyEventRenameToTimeline(timeline, classified));
          }

          return this.timelineService
            .updateEvent(classified.next.eventId, {
              timestamp: classified.next.timestamp,
              durationSec: classified.next.durationSec,
              title: classified.next.title,
              metadata: classified.next.metadata
            })
            .pipe(map(() => classified));
        })
      )
      .subscribe({
        next: (classified) => {
          this.softRefresh.set(false);
          this.undoService.record({
            label: change.label,
            viewDate,
            undo: () => this.applyEventRenamePatch(classified.previous),
            redo: () => this.applyEventRenamePatch(classified.next)
          });
        },
        error: () => {
          const current = this.displayTimeline();
          if (current) {
            this.setTimelineCache(viewDate, applyEventRenameToTimeline(current, { next: change.previous }));
          }
          this.softRefresh.set(false);
          this.patchError.set('Could not rename activity. Your edit was reverted.');
        }
      });
  }

  onBlocksDayShift(payload: BlocksDayShiftPayload): void {
    if (payload.changes.length === 0) {
      return;
    }

    this.patchError.set(null);
    this.softRefresh.set(true);

    const selectionIds = payload.changes
      .map((change) => change.next.eventId)
      .filter((id): id is string => Boolean(id));
    this.preservedSelectionIds.set(selectionIds);

    const timeline = this.displayTimeline();
    this.timelineByDate.update((entries) =>
      applyDayShiftToTimelineCache(
        entries,
        payload.sourceDate,
        payload.targetDate,
        payload.changes,
        timeline,
        this.userId() ?? ''
      )
    );

    if (this.selectedDate() !== payload.targetDate) {
      this.selectedDate.set(payload.targetDate);
    }

    forkJoin(
      payload.changes.map((change) =>
        this.timelineService.updateEvent(change.next.eventId, {
          timestamp: change.next.timestamp,
          durationSec: change.next.durationSec,
          metadata: change.next.metadata
        })
      )
    ).subscribe({
      next: () => {
        this.softRefresh.set(false);
        for (const change of payload.changes) {
          this.undoService.record({
            label: change.label,
            viewDate: payload.sourceDate,
            undo: () => this.applyEventPatch(change.previous),
            redo: () => this.applyEventPatch(change.next)
          });
        }
      },
      error: () => {
        this.timelineByDate.update((entries) =>
          applyDayShiftToTimelineCache(
            entries,
            payload.targetDate,
            payload.sourceDate,
            payload.changes.map((change) => ({ next: change.previous })),
            this.displayTimeline(),
            this.userId() ?? ''
          )
        );
        if (this.selectedDate() !== payload.sourceDate) {
          this.selectedDate.set(payload.sourceDate);
        }
        this.preservedSelectionIds.set([]);
        this.softRefresh.set(false);
        this.patchError.set('Could not save timeline change. Your edit was reverted.');
      }
    });
  }

  onActivityCreate(draft: EventCreateDraft): void {
    const viewDate = this.selectedDate();
    this.patchError.set(null);
    this.createBusy.set(true);

    const pendingId = `pending-${Date.now()}`;

    this.timelineService
      .categorizeActivity(draft.title)
      .pipe(
        catchError(() =>
          of({ category: 'uncategorized', confidence: 0, method: 'none' })
        ),
        switchMap(({ category, confidence }) => {
          const classified: EventCreateDraft = {
            ...draft,
            metadata: {
              ...draft.metadata,
              category,
              confidence
            }
          };

          const timeline = this.displayTimeline();
          if (timeline) {
            this.setTimelineCache(
              viewDate,
              applyEventCreateToTimeline(timeline, classified, pendingId)
            );
          }

          return this.timelineService.createEvent(classified).pipe(
            map((response) => ({ response, classified }))
          );
        })
      )
      .subscribe({
        next: ({ response, classified }) => {
          const createdId = response.ids[0];
          if (!createdId) {
            return;
          }

          const current = this.displayTimeline();
          if (current) {
            let updated = removeEventFromTimeline(current, pendingId);
            updated = applyEventCreateToTimeline(updated, classified, createdId);
            this.setTimelineCache(viewDate, updated);
          }

          let currentId = createdId;
          this.undoService.record({
            label: 'Create block',
            viewDate,
            undo: () => this.deleteEventForUndo(currentId, viewDate),
            redo: async () => {
              const res = await this.createEventForUndo(classified);
              currentId = res.ids[0];
            }
          });
        },
        error: () => {
          const current = this.displayTimeline();
          if (current) {
            this.setTimelineCache(viewDate, removeEventFromTimeline(current, pendingId));
          }
          this.patchError.set('Could not create activity. Try again.');
        },
        complete: () => this.createBusy.set(false)
      });
  }

  onActivitiesCreate(drafts: EventCreateDraft[]): void {
    if (drafts.length === 0) {
      return;
    }

    const viewDate = this.selectedDate();
    this.patchError.set(null);
    this.createBusy.set(true);

    const pendingIds = drafts.map((_, index) => `pending-paste-${Date.now()}-${index}`);
    const timeline = this.displayTimeline();
    if (timeline) {
      let updated = timeline;
      for (let index = 0; index < drafts.length; index += 1) {
        updated = applyEventCreateToTimeline(updated, drafts[index], pendingIds[index]);
      }
      this.setTimelineCache(viewDate, updated);
    }

    forkJoin(drafts.map((draft) => this.timelineService.createEvent(draft))).subscribe({
      next: (responses) => {
        const createdIds = responses
          .flatMap((response) => response.ids)
          .filter((id): id is string => Boolean(id));
        if (createdIds.length === 0) {
          return;
        }

        const current = this.displayTimeline();
        if (current) {
          let updated = current;
          for (let index = 0; index < drafts.length; index += 1) {
            updated = removeEventFromTimeline(updated, pendingIds[index]);
          }
          for (let index = 0; index < drafts.length; index += 1) {
            const createdId = createdIds[index];
            if (createdId) {
              updated = applyEventCreateToTimeline(updated, drafts[index], createdId);
            }
          }
          this.setTimelineCache(viewDate, updated);
        }

        const label =
          drafts.length === 1 ? 'Paste block' : `Paste ${drafts.length} blocks`;
        let currentIds = [...createdIds];

        this.undoService.record({
          label,
          viewDate,
          undo: async () => {
            for (const eventId of currentIds) {
              await this.deleteEventForUndo(eventId, viewDate);
            }
          },
          redo: async () => {
            currentIds = [];
            for (const draft of drafts) {
              const res = await this.createEventForUndo(draft);
              const id = res.ids[0];
              if (id) {
                currentIds.push(id);
              }
            }
          }
        });
      },
      error: () => {
        const current = this.displayTimeline();
        if (current) {
          let updated = current;
          for (const pendingId of pendingIds) {
            updated = removeEventFromTimeline(updated, pendingId);
          }
          this.setTimelineCache(viewDate, updated);
        }
        this.patchError.set(
          drafts.length === 1
            ? 'Could not paste activity. Try again.'
            : 'Could not paste activities. Try again.'
        );
      },
      complete: () => this.createBusy.set(false)
    });
  }

  onSelectionChange(blocks: TimelineBlock[]): void {
    const ids = blocks
      .map((block) => block.eventId)
      .filter((id): id is string => Boolean(id));
    const prev = this.preservedSelectionIds();
    if (ids.length === prev.length && ids.every((id, index) => id === prev[index])) {
      return;
    }
    this.preservedSelectionIds.set(ids);
  }

  onBlockDelete(payload: BlockDeletePayload): void {
    this.onBlocksDelete([payload]);
  }

  onBlocksDelete(payloads: BlockDeletePayload[]): void {
    if (!this.userId() || payloads.length === 0) {
      return;
    }

    const viewDate = this.selectedDate();
    this.patchError.set(null);
    this.softRefresh.set(true);

    const eventIds = payloads.map((payload) => payload.eventId);
    const eventIdSet = new Set(eventIds);

    this.preservedSelectionIds.update((ids) => ids.filter((id) => !eventIdSet.has(id)));

    const snapshot = this.displayTimeline();
    if (snapshot) {
      let updated = snapshot;
      for (const eventId of eventIds) {
        updated = removeEventFromTimeline(updated, eventId);
      }
      this.setTimelineCache(viewDate, updated);
    }

    forkJoin(
      payloads.map((payload) => this.timelineService.deleteEvent(payload.eventId, viewDate))
    ).subscribe({
      next: () => {
        this.softRefresh.set(false);

        const restores = payloads.map((payload) => payload.restore);
        const restoredIds: string[] = [];
        const label =
          payloads.length === 1 ? 'Delete block' : `Delete ${payloads.length} blocks`;

        this.undoService.record({
          label,
          viewDate,
          undo: async () => {
            restoredIds.length = 0;
            for (const restore of restores) {
              const res = await this.createEventForUndo(restore);
              const id = res.ids[0];
              if (id) {
                restoredIds.push(id);
              }
            }
          },
          redo: async () => {
            for (const id of restoredIds) {
              await this.deleteEventForUndo(id, viewDate);
            }
          }
        });
      },
      error: () => {
        if (snapshot) {
          let restored = snapshot;
          for (const payload of payloads) {
            restored = applyEventCreateToTimeline(
              restored,
              this.restorePayloadToDraft(payload.restore, viewDate),
              payload.eventId
            );
          }
          this.setTimelineCache(viewDate, restored);
        }
        this.softRefresh.set(false);
        this.patchError.set(
          payloads.length === 1
            ? 'Could not delete this time block.'
            : 'Could not delete the selected time blocks.'
        );
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

  private setTimelineCache(date: string, timeline: TimelineResponse): void {
    this.timelineByDate.update((entries) => {
      const next = new Map(entries);
      next.set(date, timeline);
      return next;
    });
  }

  private invalidateTimelineCache(...dates: string[]): void {
    this.timelineByDate.update((entries) => {
      const next = new Map(entries);
      for (const date of dates) {
        if (date) {
          next.delete(date);
        }
      }
      return next;
    });
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

  private applyEventRenamePatch(patch: EventRenamePatch): Promise<void> {
    return firstValueFrom(
      this.timelineService.updateEvent(patch.eventId, {
        timestamp: patch.timestamp,
        durationSec: patch.durationSec,
        title: patch.title,
        metadata: patch.metadata
      })
    ).then(() => undefined);
  }

  private restorePayloadToDraft(
    restore: CreateEventPayload,
    viewDate: string
  ): EventCreateDraft {
    const meta = restore.metadata ?? {};
    return {
      timestamp: restore.timestamp,
      type: 'manual',
      title: restore.title,
      durationSec: restore.durationSec,
      metadata: {
        category: String(meta['category'] ?? 'uncategorized'),
        sourceClient: String(meta['sourceClient'] ?? 'dashboard-undo'),
        localDate: String(meta['localDate'] ?? viewDate),
        ...(typeof meta['confidence'] === 'number' ? { confidence: meta['confidence'] } : {}),
        ...(typeof meta['endLocalDate'] === 'string'
          ? { endLocalDate: meta['endLocalDate'] }
          : {})
      }
    };
  }

  private deleteEventForUndo(eventId: string, viewDate: string): Promise<void> {
    return firstValueFrom(this.timelineService.deleteEvent(eventId, viewDate)).then(() => undefined);
  }

  private createEventForUndo(payload: CreateEventPayload) {
    return firstValueFrom(this.timelineService.createEvent(payload));
  }
}
