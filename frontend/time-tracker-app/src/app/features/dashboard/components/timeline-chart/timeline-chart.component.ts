import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  afterEveryRender,
  afterNextRender,
  HostListener,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';

import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_LEGEND
} from '../../../../core/constants/categories';
import { ActivityCategory, TimelineBlock, TimelineHour } from '../../../../core/models/timeline.model';
import { formatDuration, formatHourLabel } from '../../../../core/utils/duration.util';
import { DayDateNavComponent } from '../../../../shared/components/day-date-nav/day-date-nav.component';
import {
  DragMode,
  BlockDeletePayload,
  BlocksDayShiftPayload,
  ActivityRenamePayload,
  EventCreateDraft,
  EventTimeChangePayload,
  RESIZE_HANDLE_PX,
  SNAP_MINUTES,
  buildCreateEventDraft,
  buildEventDayShiftPayload,
  buildEventRenamePatch,
  buildEventTimePatch,
  buildRestorePayloadFromBlock,
  shiftViewDate,
  visibleBlockIntervalMinutes,
  clampCreateDragInterval,
  defaultCreateInterval,
  clampIntervalToDay,
  deltaPxToMinutes,
  groupEdgeShiftDeltaMinutes,
  offsetYToMinutes
} from './timeline-drag.util';

interface TooltipState {
  category: string;
  duration: string;
  activity: string;
  timeRange: string;
  x: number;
  y: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  positioned: PositionedBlock;
}

/** Vertical event block in Apple Calendar–style day column. */
export interface PositionedBlock {
  block: TimelineBlock;
  /** Distance from top of visible range (0–100%). */
  topPct: number;
  /** Height as share of visible range (0–100%). */
  heightPct: number;
  /** Horizontal column for overlapping events (0-based). */
  column: number;
  /** Columns in this overlap cluster. */
  columnCount: number;
}

export interface HourGuide {
  hour: number;
  label: string;
  topPct: number;
}

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const BASE_PX_PER_HOUR = 56;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
const HALF_HOUR_STEP_PCT = (0.5 / HOURS_PER_DAY) * 100;
const DEFAULT_ZOOM = 1;
const MAX_ZOOM = 12;
/** Per keypress when using - / + to zoom the timeline. */
const KEYBOARD_ZOOM_FACTOR = 1.2;
/** Matches .day-calendar__layout vertical padding (0.5rem + 0.75rem at 16px root). */
const LAYOUT_PADDING_TOP_PX = 8;
const LAYOUT_PADDING_BOTTOM_PX = 12;
const LAYOUT_PADDING_Y_PX = LAYOUT_PADDING_TOP_PX + LAYOUT_PADDING_BOTTOM_PX;
/** Min hours of timeline kept visible above/below selection when moving with j/k (vim scrolloff). */
const SCROLL_OFF_HOURS = 2;
/** Allowed j/k step sizes (minutes); zoom picks the largest tier that still gives ~6 steps across the view. */
const CURSOR_STEP_TIERS = [60, 30, 15, 5, 1] as const;
const CURSOR_STEP_VIEWPORT_STEPS = 6;
/** When zoomed in (1 min is ~10px+), use more viewport steps so j/k can reach 1-min tiers. */
const CURSOR_STEP_VIEWPORT_STEPS_FINE = 30;
/** Min on-screen height of a 1-minute step before fine tiers apply. */
const CURSOR_STEP_MIN_PX = 10;
/** Viewport fraction kept between cursor and top/bottom edge before scrolling follows. */
const CURSOR_SCROLL_MARGIN_FRACTION = 0.18;
const BASE_DAY_HEIGHT_PX = HOURS_PER_DAY * BASE_PX_PER_HOUR;
/** Trackpad pinch fires wheel+ctrlKey; tuned for gesture deltas, not mouse wheel. */
const PINCH_ZOOM_SENSITIVITY = 0.005;
const DRAG_THRESHOLD_PX = 5;
const SCROLL_ANIMATION_MS = 260;
/** Continuous scroll speed while j/k is held (px/sec). */
const SCROLL_HOLD_PX_PER_SEC = 560;
const SCROLL_HOLD_ARM_MS = 80;
/** Window for the second `g` in `gg` (scroll to top). */
const GG_SEQUENCE_MS = 400;
/** Window for the second `d` in `dd` (delete block at cursor). */
const DD_SEQUENCE_MS = 400;
/** Faster scroll-follow for cursor moves. */
const CURSOR_SCROLL_ANIMATION_MS = 40;

function localDayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso));
}

/** Minutes since midnight on `viewDate` in `timeZone`; clamps to day edges when the instant falls outside. */
function minutesOnViewDate(iso: string, viewDate: string, timeZone: string): number {
  const dayKey = localDayKey(iso, timeZone);
  if (dayKey < viewDate) return 0;
  if (dayKey > viewDate) return MINUTES_PER_DAY;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  }).formatToParts(new Date(iso));

  let hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  if (hour === 24) hour = 0;
  const minute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const second = Number.parseInt(parts.find((p) => p.type === 'second')?.value ?? '0', 10);
  return hour * MINUTES_PER_HOUR + minute + second / 60;
}

function blocksAreContiguous(a: TimelineBlock, b: TimelineBlock): boolean {
  if (a.end === b.start) return true;
  const gapMs = Date.parse(b.start) - Date.parse(a.end);
  return gapMs >= 0 && gapMs <= 1000;
}

function blocksShouldCoalesce(a: TimelineBlock, b: TimelineBlock): boolean {
  if (!blocksAreContiguous(a, b)) return false;
  if (a.activity !== b.activity || a.category !== b.category || a.source !== b.source) {
    return false;
  }
  // Browser extension posts one event per minute; merge into one continuous block.
  if (a.source === 'tracked') return true;
  return (a.eventId ?? '') === (b.eventId ?? '');
}

function blockFullDurationSec(block: TimelineBlock): number {
  if (block.eventStart && block.eventEnd) {
    return Math.max(
      0,
      Math.round((Date.parse(block.eventEnd) - Date.parse(block.eventStart)) / 1000)
    );
  }
  return block.durationSec;
}

/** Rejoin hour-bucket slices for the same stored event (even when other blocks sit between them). */
function mergeEventSlices(blocks: TimelineBlock[]): TimelineBlock[] {
  const withoutId: TimelineBlock[] = [];
  const byEventId = new Map<string, TimelineBlock[]>();

  for (const block of blocks) {
    const id = block.eventId;
    if (!id) {
      withoutId.push(block);
      continue;
    }
    const group = byEventId.get(id) ?? [];
    group.push(block);
    byEventId.set(id, group);
  }

  const merged: TimelineBlock[] = [...withoutId];

  for (const slices of byEventId.values()) {
    if (slices.length === 1) {
      merged.push(slices[0]);
      continue;
    }

    const sorted = [...slices].sort((a, b) => a.start.localeCompare(b.start));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const start = sorted.reduce((min, b) => (b.start < min ? b.start : min), sorted[0].start);
    const end = sorted.reduce((max, b) => (b.end > max ? b.end : max), sorted[0].end);

    merged.push({
      ...first,
      start,
      end,
      eventStart: first.eventStart ?? start,
      eventEnd: last.eventEnd ?? end,
      durationSec: sorted.reduce((sum, b) => sum + b.durationSec, 0),
      spansNextDay: sorted.some((b) => b.spansNextDay),
      spansFromPrevDay: sorted.some((b) => b.spansFromPrevDay)
    });
  }

  return merged;
}

/** Rejoin hour-bucket slices that the server split across consecutive hours. */
function mergeContiguousBlocks(blocks: TimelineBlock[]): TimelineBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
  const merged: TimelineBlock[] = [];

  for (const block of sorted) {
    const last = merged.at(-1);
    if (last && blocksShouldCoalesce(last, block)) {
      last.end = block.end;
      last.durationSec += block.durationSec;
      last.eventEnd = block.eventEnd ?? block.end;
      last.eventId = block.eventId ?? last.eventId;
      last.spansNextDay = block.spansNextDay ?? last.spansNextDay;
    } else {
      merged.push({ ...block });
    }
  }

  return merged;
}

/** One layout row per stored event (guards duplicate hour-bucket slices). */
function dedupeBlocksByEventId(blocks: TimelineBlock[]): TimelineBlock[] {
  const withoutId: TimelineBlock[] = [];
  const byId = new Map<string, TimelineBlock>();

  for (const block of blocks) {
    const id = block.eventId;
    if (!id) {
      withoutId.push(block);
      continue;
    }

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, block);
      continue;
    }

    const existingStart = Date.parse(existing.start);
    const blockStart = Date.parse(block.start);
    const existingEnd = Date.parse(existing.end);
    const blockEnd = Date.parse(block.end);
    if (blockStart <= existingStart && blockEnd >= existingEnd) {
      byId.set(id, block);
    }
  }

  return [...withoutId, ...byId.values()];
}

interface LayoutItem {
  block: TimelineBlock;
  startMin: number;
  endMin: number;
  topPct: number;
  heightPct: number;
  column: number;
  columnCount: number;
}

/** One positioned row per event before columns are assigned. */
function dedupeLayoutItemsByEventId(items: LayoutItem[]): LayoutItem[] {
  const withoutId: LayoutItem[] = [];
  const byId = new Map<string, LayoutItem>();

  for (const item of items) {
    const id = item.block.eventId;
    if (!id) {
      withoutId.push(item);
      continue;
    }

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, item);
      continue;
    }

    const span = item.endMin - item.startMin;
    const existingSpan = existing.endMin - existing.startMin;
    if (span > existingSpan) {
      byId.set(id, item);
    }
  }

  return [...withoutId, ...byId.values()];
}

function uniqueOverlapCluster(cluster: LayoutItem[]): LayoutItem[] {
  const withoutId: LayoutItem[] = [];
  const byId = new Map<string, LayoutItem>();

  for (const item of cluster) {
    const id = item.block.eventId;
    if (!id) {
      withoutId.push(item);
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, item);
    }
  }

  return [...withoutId, ...byId.values()];
}

interface LayoutInterval {
  startMin: number;
  endMin: number;
}

/** Clip the visible day slice (matches visibleBlockIntervalMinutes in timeline-drag.util). */
function layoutIntervalMinutes(
  block: TimelineBlock,
  viewDate: string,
  timeZone: string,
  rangeStartMin: number,
  rangeSpanMin: number
): LayoutInterval | null {
  const startMin = minutesOnViewDate(block.start, viewDate, timeZone);
  let endMin = minutesOnViewDate(block.end, viewDate, timeZone);
  if (endMin <= startMin && block.durationSec > 0) {
    endMin = startMin + block.durationSec / 60;
  }
  const clipStart = Math.max(startMin, rangeStartMin);
  const clipEnd = Math.min(endMin, rangeStartMin + rangeSpanMin);
  if (clipEnd <= clipStart) {
    return null;
  }
  return { startMin: clipStart, endMin: clipEnd };
}

/**
 * Overlapping events share horizontal space side-by-side (Apple Calendar day view).
 * Each event keeps its full height; only the column index changes when times overlap.
 */
function intervalsOverlap(
  a: { startMin: number; endMin: number },
  b: { startMin: number; endMin: number }
): boolean {
  return a.startMin < b.endMin - 0.01 && a.endMin > b.startMin + 0.01;
}

function overlapCluster<T extends LayoutInterval>(item: T, items: readonly T[]): T[] {
  const cluster: T[] = [];
  const stack = [item];
  const seen = new Set<T>();

  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    cluster.push(current);
    for (const other of items) {
      if (!seen.has(other) && intervalsOverlap(current, other)) {
        stack.push(other);
      }
    }
  }

  return cluster;
}

/** Older events claim left columns; matches server ids `evt_<createdAt>_…`. */
function blockColumnPriority(block: TimelineBlock): number {
  const id = block.eventId ?? '';
  const idMatch = /^evt_(\d+)_/.exec(id);
  if (idMatch) {
    return Number.parseInt(idMatch[1], 10);
  }

  const iso = block.eventStart ?? block.start;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function assignColumnsInCluster(cluster: LayoutItem[]): void {
  if (cluster.length === 0) {
    return;
  }

  if (cluster.length === 1) {
    cluster[0].column = 0;
    cluster[0].columnCount = 1;
    return;
  }

  const sorted = [...cluster].sort((a, b) => {
    const byCreated = blockColumnPriority(a.block) - blockColumnPriority(b.block);
    if (byCreated !== 0) {
      return byCreated;
    }
    return a.startMin - b.startMin || a.endMin - b.endMin;
  });

  const columnEnds: number[] = [];
  for (const item of sorted) {
    let column = 0;
    while (column < columnEnds.length && columnEnds[column] > item.startMin + 0.01) {
      column += 1;
    }
    if (column === columnEnds.length) {
      columnEnds.push(0);
    }
    columnEnds[column] = item.endMin;
    item.column = column;
  }

  const columnCount = Math.max(...sorted.map((member) => member.column)) + 1;
  for (const item of sorted) {
    item.columnCount = columnCount;
  }
}

function layoutVerticalBlocks(
  blocks: TimelineBlock[],
  viewDate: string,
  timeZone: string,
  rangeStartMin: number,
  rangeSpanMin: number
): PositionedBlock[] {
  if (rangeSpanMin <= 0 || blocks.length === 0) {
    return [];
  }

  const items = dedupeLayoutItemsByEventId(
    blocks
      .map((block) => {
        const interval = layoutIntervalMinutes(block, viewDate, timeZone, rangeStartMin, rangeSpanMin);
        if (!interval) {
          return null;
        }
        const { startMin, endMin } = interval;
        return {
          block,
          startMin,
          endMin,
          topPct: ((startMin - rangeStartMin) / rangeSpanMin) * 100,
          heightPct: ((endMin - startMin) / rangeSpanMin) * 100,
          column: 0,
          columnCount: 1
        };
      })
      .filter((item): item is LayoutItem => item !== null)
  );

  const assigned = new Set<LayoutItem>();
  for (const item of items) {
    if (assigned.has(item)) {
      continue;
    }

    const cluster = uniqueOverlapCluster(overlapCluster(item, items));
    for (const member of cluster) {
      assigned.add(member);
    }
    assignColumnsInCluster(cluster);
  }

  return items.map((item) => ({
    block: item.block,
    topPct: item.topPct,
    heightPct: item.heightPct,
    column: item.column,
    columnCount: item.columnCount
  }));
}

interface ActiveDrag {
  positioned: PositionedBlock;
  mode: DragMode;
  anchorClientY: number;
  origStartMin: number;
  origEndMin: number;
}

interface DragPreview {
  positioned: PositionedBlock;
  previewTopPct: number;
  previewHeightPct: number;
  startMin: number;
  endMin: number;
}

interface CreatePreview {
  previewTopPct: number;
  previewHeightPct: number;
  startMin: number;
  endMin: number;
}

interface RenameLabelState {
  eventId: string;
  positioned: PositionedBlock;
  previewTopPct: number;
  previewHeightPct: number;
  previousTitle: string;
}

interface ActiveCreateDrag {
  anchorStartMin: number;
  anchorClientY: number;
}

interface PendingBlockInteraction {
  positioned: PositionedBlock;
  anchorClientX: number;
  anchorClientY: number;
  shiftKey: boolean;
  editable: boolean;
  pointerId: number;
}

@Component({
  selector: 'app-timeline-chart',
  imports: [DayDateNavComponent],
  templateUrl: './timeline-chart.component.html',
  styleUrl: './timeline-chart.component.scss'
})
export class TimelineChartComponent {
  readonly hours = input.required<TimelineHour[]>();
  readonly date = input.required<string>();
  readonly timezone = input<string>('UTC');

  readonly prevDay = output<void>();
  readonly nextDay = output<void>();
  readonly selectDate = output<string>();
  readonly eventTimeChange = output<EventTimeChangePayload>();
  readonly activityCreate = output<EventCreateDraft>();
  readonly activityRename = output<ActivityRenamePayload>();
  readonly blockDelete = output<BlockDeletePayload>();
  readonly blocksDelete = output<BlockDeletePayload[]>();
  readonly blocksDayShift = output<BlocksDayShiftPayload>();
  readonly blocksSelectionChange = output<TimelineBlock[]>();

  readonly patchError = input<string | null>(null);
  readonly createBusy = input(false);
  readonly preservedSelectionIds = input<readonly string[]>([]);

  private readonly scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');
  private readonly calendarCanvas = viewChild<ElementRef<HTMLElement>>('calendarCanvas');
  private readonly createLabelInput = viewChild<ElementRef<HTMLInputElement>>('createLabelInput');
  private readonly renameLabelInput = viewChild<ElementRef<HTMLInputElement>>('renameLabelInput');
  private skipCreateLabelBlur = false;
  private skipRenameLabelBlur = false;
  private createBusyWasTrue = false;
  private labelBlurReady = false;
  private renameBlurReady = false;
  private createLabelFocusKey = 0;
  private renameLabelFocusKey = 0;
  private scrollResizeObserver: ResizeObserver | null = null;
  private pinchStartScale = DEFAULT_ZOOM;
  private pointerAnchorY = 0;
  private savedScrollTop = 0;
  /** Scroll position as a fraction of max scroll (0–1), stable across day changes at the same zoom. */
  private savedScrollRatio = 0;
  private stableDate = '';
  private scrollRestorePending = false;
  private pendingDateChange = false;
  private pendingDate = '';
  private readonly pendingReselectTargetDate = signal<string | null>(null);

  readonly zoomScale = signal(DEFAULT_ZOOM);
  private readonly scrollViewportHeight = signal(0);
  readonly tooltip = signal<TooltipState | null>(null);
  readonly contextMenu = signal<ContextMenuState | null>(null);
  readonly activeDrag = signal<ActiveDrag | null>(null);
  readonly dragPreview = signal<DragPreview | null>(null);
  readonly activeCreateDrag = signal<ActiveCreateDrag | null>(null);
  readonly createPreview = signal<CreatePreview | null>(null);
  readonly labelingCreate = signal<CreatePreview | null>(null);
  readonly labelingRename = signal<RenameLabelState | null>(null);
  readonly createLabel = signal('');
  readonly renameLabel = signal('');
  readonly insertMode = signal(false);
  readonly insertAnchorMin = signal<number | null>(null);
  readonly insertCursorMin = signal(0);
  readonly insertCursorTopPct = computed(
    () => (this.insertCursorMin() / MINUTES_PER_DAY) * 100
  );
  readonly insertCursorLabel = computed(() => this.formatCursorTime(this.insertCursorMin()));
  readonly insertGhostPreview = computed((): CreatePreview | null => {
    if (!this.insertMode()) {
      return null;
    }
    const anchor = this.insertAnchorMin();
    if (anchor === null) {
      return null;
    }
    return this.buildInsertGhostPreview(anchor, this.insertCursorMin());
  });
  private cursorInitialized = false;
  readonly selectedBlockKeys = signal<Set<string>>(new Set());
  /** Stable across layout/date changes; used to keep selection after h/l day moves. */
  readonly selectedEventIds = signal<Set<string>>(new Set());
  readonly categoryLegend = CATEGORY_LEGEND;
  readonly categoryLabels = CATEGORY_LABELS;
  readonly resizeHandlePx = RESIZE_HANDLE_PX;

  private readonly boundPointerMove = (event: PointerEvent) => this.onDragPointerMove(event);
  private readonly boundPointerUp = (event: PointerEvent) => this.onDragPointerUp(event);
  private readonly boundCreatePointerMove = (event: PointerEvent) => this.onCreatePointerMove(event);
  private readonly boundCreatePointerUp = (event: PointerEvent) => this.onCreatePointerUp(event);
  private readonly boundCloseContextMenu = () => this.closeContextMenu();
  private readonly boundContextMenuKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.closeContextMenu();
    }
  };
  private readonly boundPendingBlockMove = (event: PointerEvent) => this.onPendingBlockPointerMove(event);
  private readonly boundPendingBlockUp = (event: PointerEvent) => this.onPendingBlockPointerUp(event);
  private readonly destroyRef = inject(DestroyRef);
  private dragCaptureEl: HTMLElement | null = null;
  private createCaptureEl: HTMLElement | null = null;
  private pendingBlockInteraction: PendingBlockInteraction | null = null;
  private pendingBlockCaptureEl: HTMLElement | null = null;
  private scrollAnimationFrame: number | null = null;
  private scrollHoldFrame: number | null = null;
  private scrollHoldDirection: 1 | -1 | null = null;
  private scrollHoldLastTime = 0;
  private scrollHoldArmTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollHoldContainer: HTMLElement | null = null;
  private pendingScrollKey: {
    direction: 1 | -1;
    el: HTMLElement;
    holdStarted: boolean;
    hours: number;
  } | null = null;
  private pendingFirstGTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFirstDTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFirstZTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMotionCount = '';
  private readonly boundScrollKeyUp = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key !== 'j' && key !== 'k') {
      return;
    }

    const pending = this.pendingScrollKey;
    if (pending && !pending.holdStarted) {
      this.animateTimelineScroll(
        pending.el,
        pending.direction * this.pxPerHour() * pending.hours
      );
    }

    this.pendingScrollKey = null;
    this.stopContinuousScroll();
  };

  readonly pxPerHour = computed(() => BASE_PX_PER_HOUR * this.zoomScale());
  readonly canvasHeightPx = computed(() => HOURS_PER_DAY * this.pxPerHour());

  readonly hourGuides = computed((): HourGuide[] => {
    const guides: HourGuide[] = [];

    for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
      guides.push({
        hour,
        label: formatHourLabel(hour),
        topPct: (hour / HOURS_PER_DAY) * 100
      });
    }

    return guides;
  });

  readonly halfHourStepPct = HALF_HOUR_STEP_PCT;

  readonly positionedBlocks = computed((): PositionedBlock[] => {
    const allBlocks = dedupeBlocksByEventId(
      mergeContiguousBlocks(mergeEventSlices(this.hours().flatMap((h) => h.blocks)))
    );

    return layoutVerticalBlocks(
      allBlocks,
      this.date(),
      this.timezone(),
      0,
      MINUTES_PER_DAY
    );
  });

  /** Snapshot while dragging so background timeline refreshes cannot drop peer blocks. */
  private readonly frozenPositionedBlocks = signal<PositionedBlock[] | null>(null);

  readonly renderBlocks = computed(() => this.frozenPositionedBlocks() ?? this.positionedBlocks());

  constructor() {
    effect(() => {
      if (this.patchError()) {
        this.pendingReselectTargetDate.set(null);
        this.cancelDrag();
        this.cancelCreateDrag();
        this.cancelActivityLabel();
        this.cancelActivityRename();
      }
    });

    effect(() => {
      const labeling = this.labelingCreate();
      if (!labeling) {
        this.labelBlurReady = false;
        return;
      }
      const focusKey = this.createLabelFocusKey;
      const inputRef = this.createLabelInput();
      if (!inputRef?.nativeElement.isConnected) {
        return;
      }
      untracked(() => this.queueCreateLabelFocus(focusKey));
    });

    effect(() => {
      const renaming = this.labelingRename();
      if (!renaming) {
        this.renameBlurReady = false;
        return;
      }
      const focusKey = this.renameLabelFocusKey;
      const inputRef = this.renameLabelInput();
      if (!inputRef?.nativeElement.isConnected) {
        return;
      }
      untracked(() => this.queueRenameLabelFocus(focusKey));
    });

    effect(() => {
      const busy = this.createBusy();
      if (this.createBusyWasTrue && !busy && !this.patchError()) {
        this.labelingCreate.set(null);
        this.createLabel.set('');
      }
      this.createBusyWasTrue = busy;
    });

    effect(() => {
      this.hours();
      if (!this.activeCreateDrag()) {
        this.createPreview.set(null);
      }
    });

    effect(() => {
      const date = this.date();

      if (this.stableDate === '') {
        this.stableDate = date;
      }

      const dateChanged = date !== this.stableDate;

      this.pendingDateChange = dateChanged;
      this.pendingDate = date;
      if (dateChanged) {
        if (!this.pendingReselectTargetDate()) {
          this.clearSelection();
        }
        this.exitInsertMode();
        this.cancelActivityRename();
        this.scrollRestorePending = true;
      }
    });

    effect(() => {
      const preserved = this.preservedSelectionIds();
      this.date();
      if (preserved.length === 0) {
        return;
      }
      untracked(() => this.applyPreservedSelection(preserved));
    });

    effect(() => {
      this.renderBlocks();
      const eventIds = this.selectedEventIds();
      if (eventIds.size === 0) {
        return;
      }
      untracked(() => this.refreshSelectionKeysFromEventIds(eventIds));
    });

    effect(() => {
      this.hours();
      const date = this.date();
      const targetDate = this.pendingReselectTargetDate();
      const eventIds = this.selectedEventIds();
      if (!targetDate || date !== targetDate || eventIds.size === 0) {
        return;
      }

      untracked(() => {
        this.refreshSelectionKeysFromEventIds(eventIds);
      });
    });

    this.destroyRef.onDestroy(() => {
      this.teardownPendingBlockListeners();
      this.cancelPendingFirstG();
      this.cancelPendingFirstZ();
      this.clearPendingMotionCount();
      this.pendingScrollKey = null;
      this.stopContinuousScroll();
      this.cancelScrollAnimation();
      this.scrollResizeObserver?.disconnect();
    });

    afterNextRender(() => {
      const el = this.scrollContainer()?.nativeElement;
      if (!el) {
        return;
      }

      const syncViewport = () => {
        this.scrollViewportHeight.set(el.clientHeight);
        this.clampZoomToViewport();
      };

      syncViewport();
      this.scrollResizeObserver = new ResizeObserver(syncViewport);
      this.scrollResizeObserver.observe(el);
      this.saveScrollViewport(el);

      const onScroll = () => this.saveScrollViewport(el);
      el.addEventListener('scroll', onScroll, { passive: true });
      this.destroyRef.onDestroy(() => el.removeEventListener('scroll', onScroll));

      if (!this.cursorInitialized) {
        // First paint: set cursor to current time and scroll it into view.
        try {
          this.setCursorToNowAndScroll(el);
          this.cursorInitialized = true;
        } catch {
          // required inputs may not be ready yet; the cursor will initialize on a later render/scroll
        }
      }
    });

    afterEveryRender(() => {
      if (!this.scrollRestorePending) {
        return;
      }

      const container = this.scrollContainer()?.nativeElement;
      if (!container) {
        return;
      }

      this.scrollRestorePending = false;

      if (this.pendingDateChange) {
        this.restoreScrollViewport(container);
        this.stableDate = this.pendingDate;
        this.cancelActivityLabel();
        const targetDate = this.pendingReselectTargetDate();
        if (targetDate && targetDate === this.stableDate) {
          const eventIds = this.selectedEventIds();
          if (eventIds.size > 0) {
            this.refreshSelectionKeysFromEventIds(eventIds);
            this.emitSelectionChange();
          }
          this.pendingReselectTargetDate.set(null);
        }
        return;
      }

      this.restoreScrollViewport(container);
    });
  }

  private saveScrollViewport(el: HTMLElement): void {
    const maxTop = el.scrollHeight - el.clientHeight;
    this.savedScrollTop = el.scrollTop;
    this.savedScrollRatio = maxTop > 0 ? el.scrollTop / maxTop : 0;
  }

  private restoreScrollViewport(el: HTMLElement): void {
    const maxTop = el.scrollHeight - el.clientHeight;
    if (maxTop <= 0) {
      el.scrollTop = 0;
      return;
    }
    el.scrollTop = Math.min(maxTop, Math.max(0, this.savedScrollRatio * maxTop));
  }

  formatBlockDuration(seconds: number): string {
    return formatDuration(seconds);
  }

  formatCursorTime(minutes: number): string {
    const fmt = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: this.timezone()
    });
    return fmt.format(new Date(localTimestampFromMinutes(this.date(), minutes)));
  }

  formatTimeRange(block: TimelineBlock): string {
    const fmt = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: this.timezone()
    });
    const startIso = block.eventStart ?? block.start;
    const endIso = block.eventEnd ?? block.end;
    return `${fmt.format(new Date(startIso))} - ${fmt.format(new Date(endIso))}`;
  }

  blockDurationLabel(block: TimelineBlock): string {
    return formatDuration(blockFullDurationSec(block));
  }

  blockContinuesNextDay(block: TimelineBlock): boolean {
    return block.spansNextDay === true;
  }

  blockContinuesFromPrevDay(block: TimelineBlock): boolean {
    return block.spansFromPrevDay === true;
  }

  blockIsCompact(positioned: PositionedBlock): boolean {
    return positioned.block.durationSec < 20 * 60;
  }

  categoryColor(category: ActivityCategory): string {
    return CATEGORY_COLORS[category];
  }

  blockLeftPct(positioned: PositionedBlock): number {
    const gap = 0.8;
    const colWidth = (100 - gap * (positioned.columnCount - 1)) / positioned.columnCount;
    return positioned.column * (colWidth + gap);
  }

  blockWidthPct(positioned: PositionedBlock): number {
    const gap = 0.8;
    return (100 - gap * (positioned.columnCount - 1)) / positioned.columnCount;
  }

  showBlockTooltip(positioned: PositionedBlock, event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const { block } = positioned;

    this.tooltip.set({
      category: CATEGORY_LABELS[block.category],
      duration: this.blockDurationLabel(block),
      activity: block.activity,
      timeRange: this.formatTimeRange(block),
      x: rect.left + rect.width / 2,
      y: rect.top - 8
    });
  }

  hideTooltip(): void {
    this.tooltip.set(null);
  }

  onBlockContextMenu(event: MouseEvent, positioned: PositionedBlock): void {
    if (!this.blockIsEditable(positioned.block)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.hideTooltip();
    this.closeContextMenu();
    if (!this.labelingCreate() && !this.labelingRename()) {
      if (event.shiftKey) {
        this.toggleBlockInSelection(positioned);
      } else {
        this.selectSingleBlock(positioned);
      }
    }
    this.contextMenu.set({
      x: event.clientX,
      y: event.clientY,
      positioned
    });

    requestAnimationFrame(() => {
      document.addEventListener('click', this.boundCloseContextMenu);
      document.addEventListener('contextmenu', this.boundCloseContextMenu);
      document.addEventListener('keydown', this.boundContextMenuKeydown);
    });
  }

  closeContextMenu(): void {
    if (!this.contextMenu()) {
      return;
    }
    this.contextMenu.set(null);
    document.removeEventListener('click', this.boundCloseContextMenu);
    document.removeEventListener('contextmenu', this.boundCloseContextMenu);
    document.removeEventListener('keydown', this.boundContextMenuKeydown);
  }

  confirmDeleteBlock(event: MouseEvent): void {
    event.stopPropagation();
    const menu = this.contextMenu();
    const block = menu?.positioned.block;
    const eventId = block?.eventId;
    this.closeContextMenu();
    if (eventId && block) {
      this.blockDelete.emit({
        eventId,
        restore: buildRestorePayloadFromBlock(block, this.date())
      });
    }
  }

  blockTrackKey(positioned: PositionedBlock): string {
    const { block } = positioned;
    if (block.eventId) {
      return block.eventId;
    }
    return `${block.start}|${block.end}|${block.activity}|${block.category}`;
  }

  blockIsEditable(block: TimelineBlock): boolean {
    return Boolean(block.eventId) && (block.source === 'voice' || block.source === 'manual');
  }

  isBlockSelected(positioned: PositionedBlock): boolean {
    return this.isPositionedBlockSelected(positioned);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (this.isTypingInField()) {
      return;
    }

    const normalizedKey = event.key.toLowerCase();
    if (normalizedKey === 'i' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!this.blocksKeyboardBlocked()) {
        event.preventDefault();
        this.closeContextMenu();
        this.hideTooltip();
        if (this.insertMode()) {
          this.confirmInsertGhost();
        } else {
          this.enterInsertMode();
        }
      }
      return;
    }

    if (this.insertMode() && event.key === 'Escape') {
      event.preventDefault();
      this.exitInsertMode();
      return;
    }

    if (
      normalizedKey === 'r' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (!this.blocksKeyboardBlocked() && !this.insertMode()) {
        event.preventDefault();
        this.beginRenameAtCursor();
      }
      return;
    }

    if (this.handleHalfPageScrollKey(event)) {
      return;
    }

    // Allow moving the cursor line in normal mode without hijacking j/k scrolling:
    // In normal mode, the cursor follows scrolling (j/k scroll, trackpad scroll, etc.).

    if (this.pendingFirstGTimer !== null && event.key !== 'g') {
      this.cancelPendingFirstG();
    }

    if (this.pendingFirstDTimer !== null && event.key !== 'd') {
      this.cancelPendingFirstD();
    }

    if (this.pendingFirstZTimer !== null && event.key !== 'z') {
      this.cancelPendingFirstZ();
    }

    // Don't clear a pending count when the user is in the middle of typing a shifted command
    // (e.g. "3" then press Shift, then "J").
    const isModifierKey =
      event.key === 'Shift' || event.key === 'Alt' || event.key === 'Control' || event.key === 'Meta';
    if (
      this.pendingMotionCount &&
      !isModifierKey &&
      !this.isMotionCountDigit(event.key) &&
      !this.isJKKey(event.key)
    ) {
      this.clearPendingMotionCount();
    }

    if (event.key === 'Escape') {
      if (this.contextMenu() || this.labelingCreate()) {
        return;
      }
      if (this.labelingRename()) {
        event.preventDefault();
        this.cancelActivityRename();
        return;
      }
      this.clearPendingMotionCount();
      this.clearSelection();
      return;
    }

    if (event.key === 'Backspace') {
      this.deleteSelectedBlocks(event);
      return;
    }

    const dayNav = this.dayNavKeyAction(event.key);
    if (dayNav !== null) {
      this.navigateDay(dayNav, event);
      return;
    }

    if (this.handleGoToScrollKey(event)) {
      return;
    }

    if (this.handleDeleteAtCursorKey(event)) {
      return;
    }

    if (this.handleCenterScrollKey(event)) {
      return;
    }

    if (this.handleKeyboardZoom(event)) {
      return;
    }

    if (this.handleMotionCountKey(event)) {
      return;
    }

    const nudgeDelta = this.nudgeKeyDelta(event.key);
    if (nudgeDelta !== null) {
      const isJK = this.isJKKey(event.key);
      const consumed = isJK ? this.consumeMotionCount() : { count: 1, prefixed: false };
      if (this.hasNudgeableSelection()) {
        const hours = isJK ? Math.min(HOURS_PER_DAY, consumed.count) : 1;
        const deltaMin = isJK ? hours * MINUTES_PER_HOUR * (nudgeDelta > 0 ? 1 : -1) : nudgeDelta;
        this.nudgeSelectedBlocks(deltaMin, event, isJK);
      } else if (isJK) {
        // Normal mode with no selection: move the cursor; scroll only when cursor hits scrolloff.
        event.preventDefault();
        this.closeContextMenu();
        this.hideTooltip();
        const isUpperJK = event.key === 'J' || event.key === 'K';
        const unitMin = event.shiftKey || isUpperJK ? MINUTES_PER_HOUR : this.cursorStepMinutes();
        const count = consumed.prefixed ? consumed.count : 1;
        const stepMin = unitMin * count * (nudgeDelta > 0 ? 1 : -1);
        const snapUnit =
          event.shiftKey || isUpperJK ? MINUTES_PER_HOUR : this.cursorStepMinutes();
        this.moveCursorByMinutes(stepMin, snapUnit);
      }
    }
  }

  private handleHalfPageScrollKey(event: KeyboardEvent): boolean {
    if (!event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    const key = event.key.toLowerCase();
    if (key !== 'd' && key !== 'u') {
      return false;
    }

    if (this.blocksKeyboardBlocked()) {
      return false;
    }

    const el = this.scrollContainer()?.nativeElement;
    if (!el) {
      return false;
    }

    event.preventDefault();
    this.closeContextMenu();
    this.hideTooltip();
    this.clearPendingMotionCount();

    const direction = key === 'd' ? 1 : -1;
    const deltaMin = this.halfViewportMinutes(el) * direction;
    this.moveCursorByMinutes(deltaMin, 1, true);
    return true;
  }

  private visibleTimelineMinutes(): number {
    const el = this.scrollContainer()?.nativeElement;
    const inner = this.canvasInnerHeightPx();
    if (!el || inner <= 0) {
      return MINUTES_PER_DAY;
    }
    return (el.clientHeight / inner) * MINUTES_PER_DAY;
  }

  private halfViewportMinutes(el: HTMLElement): number {
    const inner = this.canvasInnerHeightPx();
    if (inner <= 0) {
      return MINUTES_PER_DAY / 2;
    }

    const minutes = ((el.clientHeight / 2) / inner) * MINUTES_PER_DAY;
    return Math.max(1, Math.round(minutes));
  }

  /** Largest allowed tier (60/30/15/5/1) that keeps ~6 steps across the visible range. */
  private cursorStepMinutes(): number {
    const visible = this.visibleTimelineMinutes();
    const pxPerMin = this.pxPerHour() / MINUTES_PER_HOUR;
    const steps =
      pxPerMin >= CURSOR_STEP_MIN_PX
        ? CURSOR_STEP_VIEWPORT_STEPS_FINE
        : CURSOR_STEP_VIEWPORT_STEPS;
    const maxStep = visible / steps;
    for (const tier of CURSOR_STEP_TIERS) {
      if (tier <= maxStep) {
        return tier;
      }
    }
    return 1;
  }

  private snapCursorMinutes(minutes: number, snapUnit = 1): number {
    const unit = Math.max(1, snapUnit);
    const snapped = Math.round(minutes / unit) * unit;
    return Math.min(MINUTES_PER_DAY, Math.max(0, snapped));
  }

  private enterInsertMode(): void {
    this.clearSelection();
    this.clearPendingMotionCount();
    this.insertAnchorMin.set(this.insertCursorMin());
    this.insertMode.set(true);
  }

  private exitInsertMode(): void {
    this.insertMode.set(false);
    this.insertAnchorMin.set(null);
  }

  private confirmInsertGhost(): void {
    const anchor = this.insertAnchorMin();
    if (anchor === null) {
      this.exitInsertMode();
      return;
    }

    const clamped = clampCreateDragInterval(anchor, this.insertCursorMin());
    let { startMin, endMin } = clamped;
    if (endMin <= startMin) {
      endMin = Math.min(MINUTES_PER_DAY, startMin + Math.max(1, this.cursorStepMinutes()));
    }

    const preview: CreatePreview = {
      startMin,
      endMin,
      previewTopPct: (startMin / MINUTES_PER_DAY) * 100,
      previewHeightPct: ((endMin - startMin) / MINUTES_PER_DAY) * 100
    };
    this.exitInsertMode();
    this.beginLabelingCreate(preview);
  }

  private buildInsertGhostPreview(anchorMin: number, cursorMin: number): CreatePreview {
    const clamped = clampCreateDragInterval(anchorMin, cursorMin);
    let { startMin, endMin } = clamped;
    if (endMin - startMin < 1) {
      endMin = Math.min(MINUTES_PER_DAY, startMin + 1);
    }

    return {
      previewTopPct: (startMin / MINUTES_PER_DAY) * 100,
      previewHeightPct: ((endMin - startMin) / MINUTES_PER_DAY) * 100,
      startMin,
      endMin
    };
  }

  private setCursorToNowAndScroll(el: HTMLElement): void {
    const nowIso = new Date().toISOString();
    const currentMin = minutesOnViewDate(nowIso, this.date(), this.timezone());
    const snapped = this.snapCursorMinutes(currentMin, 1);
    this.insertCursorMin.set(snapped);

    // Put the cursor near the middle of the viewport on first load.
    this.scrollCursorToVerticalCenter(el);
    this.saveScrollViewport(el);
  }

  private scrollCursorToVerticalCenter(el: HTMLElement): void {
    const cursorY = this.minutesToContentY(this.insertCursorMin());
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const targetTop = Math.min(maxTop, Math.max(0, cursorY - el.clientHeight / 2));
    this.animateTimelineScrollTo(el, targetTop, CURSOR_SCROLL_ANIMATION_MS);
  }

  private moveCursorByMinutes(
    deltaMin: number,
    snapUnit = 1,
    centerAfter = false
  ): void {
    const next = this.insertCursorMin() + deltaMin;
    this.insertCursorMin.set(this.snapCursorMinutes(next, snapUnit));

    const el = this.scrollContainer()?.nativeElement;
    if (el) {
      if (centerAfter) {
        this.scrollCursorToVerticalCenter(el);
      } else {
        this.scrollToKeepCursorVisible(el);
      }
    }
  }

  private scrollToKeepCursorVisible(el: HTMLElement): void {
    const cursorY = this.minutesToContentY(this.insertCursorMin());
    const viewportH = el.clientHeight;
    const maxTop = Math.max(0, el.scrollHeight - viewportH);
    const marginPx = viewportH * CURSOR_SCROLL_MARGIN_FRACTION;
    const scrollTop = el.scrollTop;

    let targetTop = scrollTop;
    if (cursorY < scrollTop + marginPx) {
      targetTop = cursorY - marginPx;
    } else if (cursorY > scrollTop + viewportH - marginPx) {
      targetTop = cursorY + marginPx - viewportH;
    } else {
      return;
    }

    targetTop = Math.min(maxTop, Math.max(0, targetTop));
    if (Math.abs(targetTop - scrollTop) < 0.5) {
      return;
    }

    // Instant follow avoids flicker when j/k is pressed rapidly at the scroll margin.
    this.cancelScrollAnimation();
    this.stopContinuousScroll();
    el.scrollTop = targetTop;
  }

  isDraggingBlock(positioned: PositionedBlock): boolean {
    const drag = this.activeDrag();
    if (!drag) {
      return false;
    }
    const a = drag.positioned.block;
    const b = positioned.block;
    if (a.eventId && b.eventId) {
      return a.eventId === b.eventId;
    }
    return a.start === b.start && a.end === b.end && a.activity === b.activity;
  }

  onResizeHandleDown(event: PointerEvent, positioned: PositionedBlock, mode: DragMode): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isBlockSelected(positioned)) {
      this.selectSingleBlock(positioned);
    }
    this.startDrag(event, positioned, mode);
  }

  onBlockPointerDown(event: PointerEvent, positioned: PositionedBlock): void {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.dataset['resize']) {
      return;
    }
    if (this.labelingCreate() || this.labelingRename()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.hideTooltip();
    this.teardownPendingBlockListeners();

    this.pendingBlockInteraction = {
      positioned,
      anchorClientX: event.clientX,
      anchorClientY: event.clientY,
      shiftKey: event.shiftKey,
      editable: this.blockIsEditable(positioned.block),
      pointerId: event.pointerId
    };

    document.addEventListener('pointermove', this.boundPendingBlockMove);
    document.addEventListener('pointerup', this.boundPendingBlockUp);
    document.addEventListener('pointercancel', this.boundPendingBlockUp);
    this.pendingBlockCaptureEl = event.currentTarget as HTMLElement;
    this.pendingBlockCaptureEl.setPointerCapture(event.pointerId);
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || event.target !== event.currentTarget) {
      return;
    }
    if (this.activeDrag() || this.activeCreateDrag() || this.labelingCreate() || this.labelingRename() || this.insertMode()) {
      return;
    }

    const canvas = this.calendarCanvas()?.nativeElement;
    if (!canvas) {
      return;
    }

    this.clearSelection();

    event.preventDefault();
    const anchorStartMin = this.clientYToMinutes(event.clientY, canvas);

    this.hideTooltip();
    this.activeCreateDrag.set({ anchorStartMin, anchorClientY: event.clientY });
    this.updateCreatePreview(anchorStartMin, event.clientY);

    document.addEventListener('pointermove', this.boundCreatePointerMove);
    document.addEventListener('pointerup', this.boundCreatePointerUp);
    document.addEventListener('pointercancel', this.boundCreatePointerUp);
    this.createCaptureEl = canvas;
    canvas.setPointerCapture(event.pointerId);
  }

  private startDrag(event: PointerEvent, positioned: PositionedBlock, mode: DragMode): void {
    if (!this.blockIsEditable(positioned.block)) {
      return;
    }

    this.teardownPendingBlockListeners();
    this.hideTooltip();
    this.frozenPositionedBlocks.set(this.positionedBlocks());
    const { startMin, endMin } = visibleBlockIntervalMinutes(
      positioned.block,
      this.date(),
      (iso, viewDate) => minutesOnViewDate(iso, viewDate, this.timezone())
    );
    this.activeDrag.set({
      positioned,
      mode,
      anchorClientY: event.clientY,
      origStartMin: startMin,
      origEndMin: endMin
    });
    this.updateDragPreview(0);

    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
    document.addEventListener('pointercancel', this.boundPointerUp);
    this.dragCaptureEl = event.currentTarget as HTMLElement;
    this.dragCaptureEl.setPointerCapture(event.pointerId);
  }

  private onDragPointerMove(event: PointerEvent): void {
    const drag = this.activeDrag();
    if (!drag) {
      return;
    }
    const deltaMin = deltaPxToMinutes(
      event.clientY - drag.anchorClientY,
      this.canvasHeightPx()
    );
    this.updateDragPreview(deltaMin);
  }

  private onDragPointerUp(event: PointerEvent): void {
    const drag = this.activeDrag();
    const preview = this.dragPreview();
    this.teardownDragListeners();

    if (!drag || !preview) {
      this.cancelDrag();
      return;
    }

    try {
      const minutesOnView = (iso: string, viewDate: string) =>
        minutesOnViewDate(iso, viewDate, this.timezone());
      const previous = buildEventTimePatch(
        drag.positioned.block,
        this.date(),
        drag.origStartMin,
        drag.origEndMin,
        minutesOnView
      );
      const next = buildEventTimePatch(
        drag.positioned.block,
        this.date(),
        preview.startMin,
        preview.endMin,
        minutesOnView
      );

      if (
        previous.timestamp === next.timestamp &&
        previous.durationSec === next.durationSec
      ) {
        this.cancelDrag();
        return;
      }

      const label = drag.mode === 'move' ? 'Move block' : 'Resize block';
      this.keepEventSelected(drag.positioned.block.eventId);
      this.eventTimeChange.emit({ label, previous, next });
    } catch {
      this.cancelDrag();
      return;
    }

    this.activeDrag.set(null);
    this.dragPreview.set(null);
    this.frozenPositionedBlocks.set(null);
    this.dragCaptureEl?.releasePointerCapture(event.pointerId);
    this.dragCaptureEl = null;
  }

  private updateDragPreview(deltaMin: number): void {
    const drag = this.activeDrag();
    if (!drag) {
      return;
    }

    let startMin = drag.origStartMin;
    let endMin = drag.origEndMin;

    if (drag.mode === 'move') {
      startMin += deltaMin;
      endMin += deltaMin;
    } else if (drag.mode === 'resize-top') {
      startMin += deltaMin;
    } else {
      endMin += deltaMin;
    }

    const clamped = clampIntervalToDay(startMin, endMin);
    const previewTopPct = (clamped.startMin / MINUTES_PER_DAY) * 100;
    const previewHeightPct = ((clamped.endMin - clamped.startMin) / MINUTES_PER_DAY) * 100;

    this.dragPreview.set({
      positioned: drag.positioned,
      previewTopPct,
      previewHeightPct,
      startMin: clamped.startMin,
      endMin: clamped.endMin
    });
  }

  private teardownDragListeners(): void {
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointercancel', this.boundPointerUp);
  }

  private clearDragState(): void {
    this.frozenPositionedBlocks.set(null);
    this.activeDrag.set(null);
    this.dragPreview.set(null);
    this.dragCaptureEl = null;
  }

  private cancelDrag(): void {
    this.teardownDragListeners();
    this.clearDragState();
  }

  private onCreatePointerMove(event: PointerEvent): void {
    const canvas = this.calendarCanvas()?.nativeElement;
    if (!this.activeCreateDrag() || !canvas) {
      return;
    }
    this.updateCreatePreview(this.clientYToMinutes(event.clientY, canvas), event.clientY);
  }

  private onCreatePointerUp(event: PointerEvent): void {
    const preview = this.createPreview();
    this.teardownCreateListeners();

    if (!this.activeCreateDrag() || !preview) {
      this.cancelCreateDrag();
      return;
    }

    event.preventDefault();

    this.activeCreateDrag.set(null);
    this.createPreview.set(null);
    this.createCaptureEl?.releasePointerCapture(event.pointerId);
    this.createCaptureEl = null;

    this.beginLabelingCreate(preview);
  }

  private beginLabelingCreate(preview: CreatePreview): void {
    this.createLabelFocusKey += 1;
    const focusKey = this.createLabelFocusKey;
    this.labelBlurReady = false;
    this.labelingCreate.set(null);
    this.createLabel.set('');

    window.setTimeout(() => {
      if (focusKey !== this.createLabelFocusKey) {
        return;
      }
      this.labelingCreate.set({ ...preview });
      this.queueCreateLabelFocus(focusKey);
    }, 0);
  }

  confirmActivityLabel(event?: Event): void {
    event?.preventDefault();

    if (this.createBusy()) {
      return;
    }

    const labeling = this.labelingCreate();
    if (!labeling) {
      return;
    }

    const title = this.createLabel().trim() || 'New activity';

    try {
      this.activityCreate.emit(
        buildCreateEventDraft(this.date(), labeling.startMin, labeling.endMin, title)
      );
      this.labelingCreate.set(null);
      this.createLabel.set('');
    } catch {
      this.cancelActivityLabel();
      return;
    }
  }

  cancelActivityLabel(): void {
    this.createLabelFocusKey += 1;
    this.skipCreateLabelBlur = true;
    this.labelBlurReady = false;
    this.labelingCreate.set(null);
    this.createLabel.set('');
  }

  onCreateLabelBlur(): void {
    if (this.skipCreateLabelBlur) {
      this.skipCreateLabelBlur = false;
      return;
    }
    if (!this.labelBlurReady) {
      return;
    }
    this.confirmActivityLabel();
  }

  onCreateLabelKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      this.skipCreateLabelBlur = true;
      this.confirmActivityLabel(event);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelActivityLabel();
    }
  }

  private queueCreateLabelFocus(focusKey: number, attempt = 0): void {
    if (focusKey !== this.createLabelFocusKey || !this.labelingCreate()) {
      return;
    }

    const input = this.createLabelInput()?.nativeElement;
    if (input?.isConnected) {
      input.focus({ preventScroll: true });
      input.select();
      window.setTimeout(() => {
        if (focusKey === this.createLabelFocusKey) {
          this.labelBlurReady = true;
        }
      }, 250);
      return;
    }

    if (attempt < 20) {
      window.setTimeout(
        () => this.queueCreateLabelFocus(focusKey, attempt + 1),
        attempt < 5 ? 0 : 16
      );
    }
  }

  private beginRenameAtCursor(): void {
    const positioned = this.findEditableBlockAtCursor();
    if (!positioned) {
      return;
    }

    const block = positioned.block;
    this.cancelActivityLabel();
    this.cancelActivityRename();
    this.closeContextMenu();
    this.hideTooltip();
    this.clearPendingMotionCount();
    this.clearSelection();

    this.renameLabelFocusKey += 1;
    const focusKey = this.renameLabelFocusKey;
    this.renameBlurReady = false;
    this.renameLabel.set(block.activity);
    this.labelingRename.set(null);

    window.setTimeout(() => {
      if (focusKey !== this.renameLabelFocusKey) {
        return;
      }
      this.labelingRename.set({
        eventId: block.eventId!,
        positioned,
        previewTopPct: positioned.topPct,
        previewHeightPct: positioned.heightPct,
        previousTitle: block.activity
      });
      this.queueRenameLabelFocus(focusKey);
    }, 0);
  }

  confirmActivityRename(event?: Event): void {
    event?.preventDefault();

    const renaming = this.labelingRename();
    if (!renaming) {
      return;
    }

    const title = this.renameLabel().trim();
    if (!title || title === renaming.previousTitle) {
      this.cancelActivityRename();
      return;
    }

    const block = renaming.positioned.block;
    const viewDate = this.date();
    const previous = buildEventRenamePatch(block, viewDate, renaming.previousTitle);
    const next = buildEventRenamePatch(block, viewDate, title);

    this.activityRename.emit({ label: 'Rename block', previous, next });
    this.cancelActivityRename();
    this.clearSelection();
  }

  cancelActivityRename(): void {
    this.renameLabelFocusKey += 1;
    this.skipRenameLabelBlur = true;
    this.renameBlurReady = false;
    this.labelingRename.set(null);
    this.renameLabel.set('');
  }

  onRenameLabelBlur(): void {
    if (this.skipRenameLabelBlur) {
      this.skipRenameLabelBlur = false;
      return;
    }
    if (!this.renameBlurReady) {
      return;
    }
    this.confirmActivityRename();
  }

  onRenameLabelKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      this.skipRenameLabelBlur = true;
      this.confirmActivityRename(event);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelActivityRename();
    }
  }

  private queueRenameLabelFocus(focusKey: number, attempt = 0): void {
    if (focusKey !== this.renameLabelFocusKey || !this.labelingRename()) {
      return;
    }

    const input = this.renameLabelInput()?.nativeElement;
    if (input?.isConnected) {
      input.focus({ preventScroll: true });
      input.select();
      window.setTimeout(() => {
        if (focusKey === this.renameLabelFocusKey) {
          this.renameBlurReady = true;
        }
      }, 250);
      return;
    }

    if (attempt < 20) {
      window.setTimeout(
        () => this.queueRenameLabelFocus(focusKey, attempt + 1),
        attempt < 5 ? 0 : 16
      );
    }
  }

  private updateCreatePreview(currentMin: number, clientY: number): void {
    const drag = this.activeCreateDrag();
    if (!drag) {
      return;
    }

    const dragged =
      Math.abs(clientY - drag.anchorClientY) > DRAG_THRESHOLD_PX ||
      Math.abs(currentMin - drag.anchorStartMin) >= SNAP_MINUTES;
    const clamped = dragged
      ? clampCreateDragInterval(drag.anchorStartMin, currentMin)
      : defaultCreateInterval(drag.anchorStartMin);
    this.createPreview.set({
      previewTopPct: (clamped.startMin / MINUTES_PER_DAY) * 100,
      previewHeightPct: ((clamped.endMin - clamped.startMin) / MINUTES_PER_DAY) * 100,
      startMin: clamped.startMin,
      endMin: clamped.endMin
    });
  }

  private clientYToMinutes(clientY: number, canvas: HTMLElement): number {
    const rect = canvas.getBoundingClientRect();
    return offsetYToMinutes(clientY - rect.top, rect.height);
  }

  formatCreatePreviewTimeRange(preview: CreatePreview): string {
    const fmt = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: this.timezone()
    });
    const viewDate = this.date();
    return `${fmt.format(new Date(localTimestampFromMinutes(viewDate, preview.startMin)))} - ${fmt.format(new Date(localTimestampFromMinutes(viewDate, preview.endMin)))}`;
  }

  private teardownCreateListeners(): void {
    document.removeEventListener('pointermove', this.boundCreatePointerMove);
    document.removeEventListener('pointerup', this.boundCreatePointerUp);
    document.removeEventListener('pointercancel', this.boundCreatePointerUp);
  }

  private cancelCreateDrag(): void {
    this.teardownCreateListeners();
    this.activeCreateDrag.set(null);
    this.createPreview.set(null);
    this.createCaptureEl = null;
  }

  private onPendingBlockPointerMove(event: PointerEvent): void {
    const pending = this.pendingBlockInteraction;
    if (!pending?.editable) {
      return;
    }

    const dx = event.clientX - pending.anchorClientX;
    const dy = event.clientY - pending.anchorClientY;
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) {
      return;
    }

    const { positioned, shiftKey } = pending;
    this.teardownPendingBlockListeners();
    this.ensureBlockSelectedForDrag(positioned, shiftKey);
    this.startDrag(event, positioned, 'move');
  }

  private onPendingBlockPointerUp(event: PointerEvent): void {
    const pending = this.pendingBlockInteraction;
    if (!pending) {
      return;
    }

    const dx = event.clientX - pending.anchorClientX;
    const dy = event.clientY - pending.anchorClientY;
    const isClick = Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX;

    this.teardownPendingBlockListeners();

    if (isClick && !this.labelingCreate() && !this.labelingRename()) {
      this.applyBlockClickSelection(pending.positioned, pending.shiftKey);
      event.preventDefault();
      event.stopPropagation();
    }

    this.pendingBlockCaptureEl?.releasePointerCapture(event.pointerId);
    this.pendingBlockCaptureEl = null;
    this.pendingBlockInteraction = null;
  }

  private teardownPendingBlockListeners(): void {
    document.removeEventListener('pointermove', this.boundPendingBlockMove);
    document.removeEventListener('pointerup', this.boundPendingBlockUp);
    document.removeEventListener('pointercancel', this.boundPendingBlockUp);
  }

  private applyBlockClickSelection(positioned: PositionedBlock, shiftKey: boolean): void {
    if (shiftKey) {
      this.toggleBlockInSelection(positioned);
    } else {
      this.selectSingleBlock(positioned);
    }
  }

  private selectSingleBlock(positioned: PositionedBlock): void {
    this.updateSelection(new Set([this.blockTrackKey(positioned)]));
  }

  private toggleBlockInSelection(positioned: PositionedBlock): void {
    const key = this.blockTrackKey(positioned);
    const next = new Set(this.selectedBlockKeys());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.updateSelection(next);
  }

  private ensureBlockSelectedForDrag(positioned: PositionedBlock, shiftKey: boolean): void {
    const key = this.blockTrackKey(positioned);
    if (shiftKey) {
      if (!this.selectedBlockKeys().has(key)) {
        const next = new Set(this.selectedBlockKeys());
        next.add(key);
        this.updateSelection(next);
      }
      return;
    }

    if (!this.selectedBlockKeys().has(key)) {
      this.selectSingleBlock(positioned);
    }
  }

  private keepEventSelected(eventId: string | undefined): void {
    if (!eventId) {
      return;
    }

    const eventIds = new Set(this.selectedEventIds());
    eventIds.add(eventId);
    this.selectedEventIds.set(eventIds);
    if (!this.refreshSelectionKeysFromEventIds(eventIds)) {
      this.emitSelectionChange();
    }
  }

  private clearSelection(): void {
    if (this.selectedBlockKeys().size === 0 && this.selectedEventIds().size === 0) {
      return;
    }
    this.selectedBlockKeys.set(new Set());
    this.selectedEventIds.set(new Set());
    this.pendingReselectTargetDate.set(null);
    this.blocksSelectionChange.emit([]);
  }

  private deleteBlockAtCursor(event: KeyboardEvent): void {
    const positioned = this.findEditableBlockAtCursor();
    if (!positioned) {
      return;
    }

    const block = positioned.block;
    const eventId = block.eventId;
    if (!eventId) {
      return;
    }

    event.preventDefault();
    this.closeContextMenu();
    this.hideTooltip();
    this.blockDelete.emit({
      eventId,
      restore: buildRestorePayloadFromBlock(block, this.date())
    });
    this.clearSelection();
  }

  private findEditableBlockAtCursor(): PositionedBlock | null {
    const cursorMin = this.insertCursorMin();
    const viewDate = this.date();
    const minutesOnView = (iso: string, vd: string) =>
      minutesOnViewDate(iso, vd, this.timezone());
    const hits: PositionedBlock[] = [];

    for (const positioned of this.renderBlocks()) {
      const block = positioned.block;
      if (!this.blockIsEditable(block) || !block.eventId) {
        continue;
      }

      const { startMin, endMin } = visibleBlockIntervalMinutes(block, viewDate, minutesOnView);
      if (cursorMin < startMin || cursorMin >= endMin - 0.01) {
        continue;
      }
      hits.push(positioned);
    }

    if (hits.length === 0) {
      return null;
    }

    hits.sort((a, b) => {
      if (b.column !== a.column) {
        return b.column - a.column;
      }
      const aStart = visibleBlockIntervalMinutes(a.block, viewDate, minutesOnView).startMin;
      const bStart = visibleBlockIntervalMinutes(b.block, viewDate, minutesOnView).startMin;
      return bStart - aStart;
    });
    return hits[0];
  }

  private deleteSelectedBlocks(event: KeyboardEvent): void {
    if (this.blocksKeyboardBlocked()) {
      return;
    }

    const deletable = this.getSelectedBlocks().filter(
      (block) => this.blockIsEditable(block) && block.eventId
    );
    if (deletable.length === 0) {
      return;
    }

    event.preventDefault();
    this.closeContextMenu();
    this.hideTooltip();

    const viewDate = this.date();
    const payloads = deletable.map((block) => ({
      eventId: block.eventId!,
      restore: buildRestorePayloadFromBlock(block, viewDate)
    }));
    this.blocksDelete.emit(payloads);
    this.clearSelection();
  }

  private nudgeSelectedBlocks(deltaMin: number, event: KeyboardEvent, smoothScroll = false): void {
    if (this.blocksKeyboardBlocked() || !this.hasNudgeableSelection()) {
      return;
    }

    const blocks = this.getSelectedBlocks().filter(
      (block) => this.blockIsEditable(block) && block.eventId
    );
    if (blocks.length === 0) {
      return;
    }

    event.preventDefault();
    this.closeContextMenu();
    this.hideTooltip();

    const minutesOnView = (iso: string, viewDate: string) =>
      minutesOnViewDate(iso, viewDate, this.timezone());

    let moved = 0;
    let selectionStartMin = MINUTES_PER_DAY;
    let selectionEndMin = 0;
    for (const block of blocks) {
      const interval = visibleBlockIntervalMinutes(block, this.date(), minutesOnView);
      const clamped = clampIntervalToDay(interval.startMin + deltaMin, interval.endMin + deltaMin);
      if (clamped.startMin === interval.startMin && clamped.endMin === interval.endMin) {
        continue;
      }

      selectionStartMin = Math.min(selectionStartMin, clamped.startMin);
      selectionEndMin = Math.max(selectionEndMin, clamped.endMin);

      try {
        const previous = buildEventTimePatch(
          block,
          this.date(),
          interval.startMin,
          interval.endMin,
          minutesOnView
        );
        const next = buildEventTimePatch(
          block,
          this.date(),
          clamped.startMin,
          clamped.endMin,
          minutesOnView
        );
        this.eventTimeChange.emit({ label: 'Move block', previous, next });
        this.keepEventSelected(block.eventId);
        moved += 1;
      } catch {
        // skip block
      }
    }

    if (moved === 0) {
      return;
    }

    if (!smoothScroll) {
      return;
    }

    const el = this.scrollContainer()?.nativeElement;
    if (!el) {
      return;
    }

    this.cancelScrollAnimation();
    this.stopContinuousScroll();
    const moveDirection: 1 | -1 = deltaMin > 0 ? 1 : -1;
    const targetTop = this.scrollTopForSelectionScrolloff(
      el,
      selectionStartMin,
      selectionEndMin,
      moveDirection
    );
    this.animateTimelineScrollTo(el, targetTop);
  }

  private canvasInnerHeightPx(): number {
    return Math.max(0, this.canvasHeightPx() - LAYOUT_PADDING_Y_PX);
  }

  private minutesToContentY(minutes: number): number {
    return LAYOUT_PADDING_TOP_PX + (minutes / MINUTES_PER_DAY) * this.canvasInnerHeightPx();
  }

  /** Scroll position that keeps SCROLL_OFF_HOURS visible above/below the selection (vim scrolloff). */
  private scrollTopForSelectionScrolloff(
    el: HTMLElement,
    selectionStartMin: number,
    selectionEndMin: number,
    moveDirection: 1 | -1
  ): number {
    const paddingPx = SCROLL_OFF_HOURS * this.pxPerHour();
    const viewportH = el.clientHeight;
    const maxTop = Math.max(0, el.scrollHeight - viewportH);
    const blockTop = this.minutesToContentY(selectionStartMin);
    const blockBottom = this.minutesToContentY(selectionEndMin);
    let scrollTop = el.scrollTop;

    if (blockBottom - blockTop > viewportH - paddingPx * 2) {
      if (moveDirection > 0) {
        scrollTop = blockBottom + paddingPx - viewportH;
      } else {
        scrollTop = blockTop - paddingPx;
      }
      return Math.min(maxTop, Math.max(0, scrollTop));
    }

    if (moveDirection > 0) {
      const overflow = blockBottom - (scrollTop + viewportH - paddingPx);
      if (overflow > 0) {
        scrollTop = Math.min(maxTop, scrollTop + overflow);
      }
    } else {
      const overflow = scrollTop + paddingPx - blockTop;
      if (overflow > 0) {
        scrollTop = Math.max(0, scrollTop - overflow);
      }
    }

    return scrollTop;
  }

  private moveSelectedBlocksToEdge(edge: 'top' | 'bottom', event: KeyboardEvent): void {
    if (this.blocksKeyboardBlocked() || !this.hasNudgeableSelection()) {
      return;
    }

    const blocks = this.getSelectedBlocks().filter(
      (block) => this.blockIsEditable(block) && block.eventId
    );
    if (blocks.length === 0) {
      return;
    }

    event.preventDefault();
    this.closeContextMenu();
    this.hideTooltip();

    const minutesOnView = (iso: string, viewDate: string) =>
      minutesOnViewDate(iso, viewDate, this.timezone());

    const viewDate = this.date();
    const blockIntervals = blocks.map((block) => ({
      block,
      interval: visibleBlockIntervalMinutes(block, viewDate, minutesOnView)
    }));
    const deltaMin = groupEdgeShiftDeltaMinutes(
      blockIntervals.map(({ interval }) => interval),
      edge
    );

    if (deltaMin === 0) {
      this.scrollTimelineToEdge(edge);
      return;
    }

    for (const { block, interval } of blockIntervals) {
      const target = clampIntervalToDay(
        interval.startMin + deltaMin,
        interval.endMin + deltaMin
      );

      if (target.startMin === interval.startMin && target.endMin === interval.endMin) {
        continue;
      }

      try {
        const previous = buildEventTimePatch(
          block,
          viewDate,
          interval.startMin,
          interval.endMin,
          minutesOnView
        );
        const next = buildEventTimePatch(
          block,
          viewDate,
          target.startMin,
          target.endMin,
          minutesOnView
        );
        this.eventTimeChange.emit({ label: 'Move block', previous, next });
        this.keepEventSelected(block.eventId);
      } catch {
        // skip block
      }
    }

    this.scrollTimelineToEdge(edge);
  }

  private nudgeKeyDelta(key: string): number | null {
    if (key === 'ArrowDown' || key.toLowerCase() === 'j') {
      return SNAP_MINUTES;
    }
    if (key === 'ArrowUp' || key.toLowerCase() === 'k') {
      return -SNAP_MINUTES;
    }
    return null;
  }

  private dayNavKeyAction(key: string): 'prev' | 'next' | null {
    const normalized = key.toLowerCase();
    if (normalized === 'h') {
      return 'prev';
    }
    if (normalized === 'l') {
      return 'next';
    }
    return null;
  }

  private isJKKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return normalized === 'j' || normalized === 'k';
  }

  private isMotionCountDigit(key: string): boolean {
    return /^[0-9]$/.test(key);
  }

  private clearPendingMotionCount(): void {
    this.pendingMotionCount = '';
  }

  private handleMotionCountKey(event: KeyboardEvent): boolean {
    if (!this.isMotionCountDigit(event.key) || event.repeat) {
      return false;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }
    if (this.blocksKeyboardBlocked()) {
      return false;
    }
    if (event.key === '0' && this.pendingMotionCount === '') {
      return false;
    }

    event.preventDefault();
    const next = `${this.pendingMotionCount}${event.key}`;
    const parsed = Number.parseInt(next, 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 999) {
      this.pendingMotionCount = next;
    }
    return true;
  }

  private consumeMotionCount(): { count: number; prefixed: boolean } {
    const hadPending = this.pendingMotionCount.length > 0;
    const parsed = Number.parseInt(this.pendingMotionCount, 10);
    this.pendingMotionCount = '';
    const count = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    return { count, prefixed: hadPending && Number.isFinite(parsed) && parsed > 0 };
  }

  private motionCountHours(): { hours: number; prefixed: boolean } {
    const consumed = this.consumeMotionCount();
    return { hours: Math.min(HOURS_PER_DAY, consumed.count), prefixed: consumed.prefixed };
  }

  private motionCountSteps(): { steps: number; prefixed: boolean } {
    const maxSteps = Math.floor(MINUTES_PER_DAY / this.cursorStepMinutes());
    const consumed = this.consumeMotionCount();
    return { steps: Math.min(maxSteps, consumed.count), prefixed: consumed.prefixed };
  }

  private hasNudgeableSelection(): boolean {
    if (this.selectedEventIds().size === 0 && this.selectedBlockKeys().size === 0) {
      return false;
    }
    return this.getSelectedBlocks().some((block) => this.blockIsEditable(block) && block.eventId);
  }

  private navigateDay(action: 'prev' | 'next', event: KeyboardEvent): void {
    if (this.blocksKeyboardBlocked()) {
      return;
    }

    if (this.hasNudgeableSelection()) {
      this.shiftSelectedBlocksDay(action === 'prev' ? -1 : 1, event);
      return;
    }

    event.preventDefault();
    this.closeContextMenu();
    this.hideTooltip();

    if (action === 'prev') {
      this.prevDay.emit();
    } else {
      this.nextDay.emit();
    }
  }

  private shiftSelectedBlocksDay(dayDelta: number, event: KeyboardEvent): void {
    const blocks = this.getSelectedBlocks().filter(
      (block) => this.blockIsEditable(block) && block.eventId
    );
    if (blocks.length === 0) {
      return;
    }

    event.preventDefault();
    this.closeContextMenu();
    this.hideTooltip();

    const viewDate = this.date();
    const targetDate = shiftViewDate(viewDate, dayDelta);
    const minutesOnView = (iso: string, vd: string) =>
      minutesOnViewDate(iso, vd, this.timezone());

    const changes: EventTimeChangePayload[] = [];
    for (const block of blocks) {
      const payload = buildEventDayShiftPayload(block, viewDate, dayDelta, minutesOnView);
      if (payload) {
        changes.push(payload);
      }
    }

    if (changes.length === 0) {
      return;
    }

    this.pendingReselectTargetDate.set(targetDate);
    const movedIds = changes
      .map((change) => change.next.eventId)
      .filter((id): id is string => Boolean(id));
    const eventIds = new Set(movedIds);
    this.selectedEventIds.set(eventIds);
    this.refreshSelectionKeysFromEventIds(eventIds);
    this.emitSelectionChange();
    this.blocksDayShift.emit({ changes, targetDate, sourceDate: viewDate });
  }

  private applyPreservedSelection(preserved: readonly string[]): void {
    const eventIds = new Set(preserved);
    const current = this.selectedEventIds();

    // Parent preserved ids can lag behind a shift-click; don't drop newer local picks.
    if (
      current.size > eventIds.size &&
      [...eventIds].every((id) => current.has(id))
    ) {
      this.refreshSelectionKeysFromEventIds(current);
      return;
    }

    if (current.size !== eventIds.size || [...current].some((id) => !eventIds.has(id))) {
      this.selectedEventIds.set(eventIds);
    }
    this.refreshSelectionKeysFromEventIds(eventIds);
  }

  private handleGoToScrollKey(event: KeyboardEvent): boolean {
    if (event.key === 'G') {
      this.cancelPendingFirstG();
      this.cancelPendingFirstZ();
      if (this.hasNudgeableSelection()) {
        this.moveSelectedBlocksToEdge('bottom', event);
      } else {
        // No selection: jump cursor to end of day.
        event.preventDefault();
        this.closeContextMenu();
        this.hideTooltip();
        this.clearPendingMotionCount();
        this.insertCursorMin.set(MINUTES_PER_DAY);
        const el = this.scrollContainer()?.nativeElement;
        if (el) {
          this.scrollToKeepCursorVisible(el);
        }
      }
      return true;
    }

    if (event.key !== 'g' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    if (this.blocksKeyboardBlocked()) {
      return false;
    }

    event.preventDefault();

    if (event.repeat) {
      return true;
    }

    if (this.pendingFirstGTimer !== null) {
      this.cancelPendingFirstG();
      this.cancelPendingFirstZ();
      if (this.hasNudgeableSelection()) {
        this.moveSelectedBlocksToEdge('top', event);
      } else {
        // No selection: jump cursor to start of day.
        this.closeContextMenu();
        this.hideTooltip();
        this.clearPendingMotionCount();
        this.insertCursorMin.set(0);
        const el = this.scrollContainer()?.nativeElement;
        if (el) {
          this.scrollToKeepCursorVisible(el);
        }
      }
      return true;
    }

    this.pendingFirstGTimer = setTimeout(() => {
      this.pendingFirstGTimer = null;
    }, GG_SEQUENCE_MS);
    return true;
  }

  private handleDeleteAtCursorKey(event: KeyboardEvent): boolean {
    if (event.key !== 'd' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    if (this.blocksKeyboardBlocked() || this.insertMode()) {
      return false;
    }

    event.preventDefault();

    if (event.repeat) {
      return true;
    }

    if (this.pendingFirstDTimer !== null) {
      this.cancelPendingFirstD();
      this.cancelPendingFirstG();
      this.cancelPendingFirstZ();
      this.clearPendingMotionCount();
      this.deleteBlockAtCursor(event);
      return true;
    }

    this.pendingFirstDTimer = setTimeout(() => {
      this.pendingFirstDTimer = null;
    }, DD_SEQUENCE_MS);
    return true;
  }

  private handleCenterScrollKey(event: KeyboardEvent): boolean {
    if (event.key !== 'z' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    if (this.blocksKeyboardBlocked()) {
      return false;
    }

    event.preventDefault();

    if (event.repeat) {
      return true;
    }

    if (this.pendingFirstZTimer !== null) {
      this.cancelPendingFirstZ();
      this.cancelPendingFirstG();
      this.closeContextMenu();
      this.hideTooltip();
      this.clearPendingMotionCount();
      const el = this.scrollContainer()?.nativeElement;
      if (el) {
        this.scrollCursorToVerticalCenter(el);
      }
      return true;
    }

    this.pendingFirstZTimer = setTimeout(() => {
      this.pendingFirstZTimer = null;
    }, GG_SEQUENCE_MS);
    return true;
  }

  private cancelPendingFirstG(): void {
    if (this.pendingFirstGTimer !== null) {
      clearTimeout(this.pendingFirstGTimer);
      this.pendingFirstGTimer = null;
    }
  }

  private cancelPendingFirstD(): void {
    if (this.pendingFirstDTimer !== null) {
      clearTimeout(this.pendingFirstDTimer);
      this.pendingFirstDTimer = null;
    }
  }

  private cancelPendingFirstZ(): void {
    if (this.pendingFirstZTimer !== null) {
      clearTimeout(this.pendingFirstZTimer);
      this.pendingFirstZTimer = null;
    }
  }

  private handleKeyboardZoom(event: KeyboardEvent): boolean {
    const direction = this.keyboardZoomDirection(event);
    if (direction === null) {
      return false;
    }

    if (this.blocksKeyboardBlocked()) {
      return false;
    }

    event.preventDefault();
    const factor = direction === 'in' ? KEYBOARD_ZOOM_FACTOR : 1 / KEYBOARD_ZOOM_FACTOR;
    const anchorOffsetY =
      direction === 'in' ? this.getCursorAnchorOffsetY() : this.getAnchorOffsetY();
    this.applyZoomAtAnchor(this.zoomScale() * factor, anchorOffsetY);
    return true;
  }

  private keyboardZoomDirection(event: KeyboardEvent): 'in' | 'out' | null {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return null;
    }
    if (event.key === '-' || event.key === '_') {
      return 'out';
    }
    if (event.key === '+' || (event.key === '=' && event.shiftKey)) {
      return 'in';
    }
    return null;
  }

  private scrollTimelineToEdge(edge: 'top' | 'bottom', event?: KeyboardEvent): void {
    if (this.blocksKeyboardBlocked()) {
      return;
    }

    const el = this.scrollContainer()?.nativeElement;
    if (!el) {
      return;
    }

    event?.preventDefault();
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    this.animateTimelineScrollTo(el, edge === 'top' ? 0 : maxTop);
  }

  private scrollTimeline(
    direction: 1 | -1,
    event: KeyboardEvent,
    hours = 1,
    immediate = false
  ): void {
    if (this.blocksKeyboardBlocked()) {
      return;
    }

    const el = this.scrollContainer()?.nativeElement;
    if (!el) {
      return;
    }

    event.preventDefault();

    if (immediate) {
      this.pendingScrollKey = null;
      this.cancelScrollAnimation();
      this.stopContinuousScroll();
      if (this.scrollHoldArmTimer !== null) {
        clearTimeout(this.scrollHoldArmTimer);
        this.scrollHoldArmTimer = null;
      }
      document.removeEventListener('keyup', this.boundScrollKeyUp);
      this.animateTimelineScroll(el, direction * this.pxPerHour() * hours);
      return;
    }

    if (event.repeat) {
      this.cancelScrollAnimation();
      this.startScrollHold(direction, el);
      return;
    }

    this.cancelScrollAnimation();
    this.stopContinuousScroll();
    this.pendingScrollKey = { direction, el, holdStarted: false, hours };
    this.scrollHoldContainer = el;
    document.addEventListener('keyup', this.boundScrollKeyUp);

    if (this.scrollHoldArmTimer !== null) {
      clearTimeout(this.scrollHoldArmTimer);
    }
    this.scrollHoldArmTimer = setTimeout(() => {
      this.scrollHoldArmTimer = null;
      const pending = this.pendingScrollKey;
      if (pending?.el === el && !pending.holdStarted) {
        this.startScrollHold(direction, el);
      }
    }, SCROLL_HOLD_ARM_MS);
  }

  private startScrollHold(direction: 1 | -1, el: HTMLElement): void {
    if (this.pendingScrollKey?.el === el) {
      this.pendingScrollKey.holdStarted = true;
    }

    if (this.scrollHoldArmTimer !== null) {
      clearTimeout(this.scrollHoldArmTimer);
      this.scrollHoldArmTimer = null;
    }

    if (this.scrollHoldDirection === direction && this.scrollHoldFrame !== null) {
      return;
    }

    this.scrollHoldContainer = el;
    this.scrollHoldDirection = direction;
    this.scrollHoldLastTime = performance.now();
    document.addEventListener('keyup', this.boundScrollKeyUp);

    if (this.scrollHoldFrame !== null) {
      cancelAnimationFrame(this.scrollHoldFrame);
    }

    const step = (now: number) => {
      if (this.scrollHoldDirection === null || !this.scrollHoldContainer) {
        this.scrollHoldFrame = null;
        return;
      }

      const dt = Math.min(48, now - this.scrollHoldLastTime) / 1000;
      this.scrollHoldLastTime = now;
      const container = this.scrollHoldContainer;
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const delta = this.scrollHoldDirection * SCROLL_HOLD_PX_PER_SEC * dt;
      container.scrollTop = Math.min(maxTop, Math.max(0, container.scrollTop + delta));
      this.scrollHoldFrame = requestAnimationFrame(step);
    };

    this.scrollHoldFrame = requestAnimationFrame(step);
  }

  private stopContinuousScroll(): void {
    this.scrollHoldDirection = null;
    this.scrollHoldContainer = null;

    if (this.scrollHoldFrame !== null) {
      cancelAnimationFrame(this.scrollHoldFrame);
      this.scrollHoldFrame = null;
    }

    if (this.scrollHoldArmTimer !== null) {
      clearTimeout(this.scrollHoldArmTimer);
      this.scrollHoldArmTimer = null;
    }

    document.removeEventListener('keyup', this.boundScrollKeyUp);
  }

  private cancelScrollAnimation(): void {
    if (this.scrollAnimationFrame !== null) {
      cancelAnimationFrame(this.scrollAnimationFrame);
      this.scrollAnimationFrame = null;
    }
  }

  private animateTimelineScroll(el: HTMLElement, deltaPx: number): void {
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const targetTop = Math.min(maxTop, Math.max(0, el.scrollTop + deltaPx));
    this.animateTimelineScrollTo(el, targetTop);
  }

  private animateTimelineScrollTo(
    el: HTMLElement,
    targetTop: number,
    durationMs = SCROLL_ANIMATION_MS
  ): void {
    this.cancelScrollAnimation();
    this.stopContinuousScroll();

    const startTop = el.scrollTop;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const clampedTarget = Math.min(maxTop, Math.max(0, targetTop));
    if (Math.abs(clampedTarget - startTop) < 0.5) {
      return;
    }

    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      el.scrollTop = startTop + (clampedTarget - startTop) * eased;
      if (progress < 1) {
        this.scrollAnimationFrame = requestAnimationFrame(tick);
      } else {
        this.scrollAnimationFrame = null;
      }
    };

    this.scrollAnimationFrame = requestAnimationFrame(tick);
  }

  private blocksKeyboardBlocked(): boolean {
    return Boolean(
      this.labelingCreate() ||
      this.labelingRename() ||
      this.contextMenu() ||
      this.activeDrag() ||
      this.activeCreateDrag()
    );
  }

  private isPositionedBlockSelected(positioned: PositionedBlock): boolean {
    const eventId = positioned.block.eventId ?? '';
    if (eventId && this.selectedEventIds().has(eventId)) {
      return true;
    }
    return this.selectedBlockKeys().has(this.blockTrackKey(positioned));
  }

  private refreshSelectionKeysFromEventIds(eventIds: Set<string>): boolean {
    const keys = new Set<string>();
    for (const positioned of this.renderBlocks()) {
      const id = positioned.block.eventId ?? '';
      if (id && eventIds.has(id)) {
        keys.add(this.blockTrackKey(positioned));
      }
    }
    if (keys.size === 0) {
      return false;
    }

    const existing = this.selectedBlockKeys();
    if (keys.size === existing.size && [...keys].every((key) => existing.has(key))) {
      return true;
    }

    this.selectedBlockKeys.set(keys);
    this.emitSelectionChange();
    return true;
  }

  private getSelectedEditableEventIds(): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();

    for (const block of this.getSelectedBlocks()) {
      if (!this.blockIsEditable(block)) {
        continue;
      }
      const eventId = block.eventId;
      if (!eventId || seen.has(eventId)) {
        continue;
      }
      seen.add(eventId);
      ids.push(eventId);
    }

    return ids;
  }

  private isTypingInField(): boolean {
    const el = document.activeElement;
    if (!el) {
      return false;
    }
    const tag = el.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      (el as HTMLElement).isContentEditable
    );
  }

  private updateSelection(keys: Set<string>): void {
    this.selectedBlockKeys.set(keys);
    const eventIds = new Set<string>();
    for (const positioned of this.renderBlocks()) {
      if (keys.has(this.blockTrackKey(positioned))) {
        const id = positioned.block.eventId;
        if (id) {
          eventIds.add(id);
        }
      }
    }
    for (const key of keys) {
      if (key.includes('|')) {
        continue;
      }
      eventIds.add(key);
    }
    this.selectedEventIds.set(eventIds);
    this.emitSelectionChange();
  }

  private emitSelectionChange(): void {
    const blocks = this.getSelectedBlocks();
    if (blocks.length === 0 && this.selectedEventIds().size > 0) {
      return;
    }
    this.blocksSelectionChange.emit(blocks);
  }

  private getSelectedBlocks(): TimelineBlock[] {
    const seenEventIds = new Set<string>();
    const blocks: TimelineBlock[] = [];

    for (const positioned of this.renderBlocks()) {
      if (!this.isPositionedBlockSelected(positioned)) {
        continue;
      }
      const eventId = positioned.block.eventId ?? '';
      if (eventId && seenEventIds.has(eventId)) {
        continue;
      }
      if (eventId) {
        seenEventIds.add(eventId);
      }
      blocks.push(positioned.block);
    }

    return blocks;
  }

  onWheelZoom(event: WheelEvent): void {
    this.closeContextMenu();
    // macOS trackpad pinch sends wheel events with ctrlKey; plain two-finger scroll scrolls.
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const delta = normalizeWheelDelta(event);
    const factor = Math.exp(-delta * PINCH_ZOOM_SENSITIVITY);
    this.applyZoomAtAnchor(this.zoomScale() * factor, this.getAnchorOffsetY(event));
  }

  onPointerMove(event: PointerEvent): void {
    const el = this.scrollContainer()?.nativeElement;
    if (!el) {
      return;
    }

    const rect = el.getBoundingClientRect();
    this.pointerAnchorY = event.clientY - rect.top;
  }

  onGestureStart(event: Event): void {
    event.preventDefault();
    this.pinchStartScale = this.zoomScale();
  }

  onGestureChange(event: Event): void {
    event.preventDefault();
    const gesture = event as Event & { scale: number };
    this.applyZoomAtAnchor(
      this.pinchStartScale * gesture.scale,
      this.pointerAnchorY || this.getAnchorOffsetY()
    );
  }

  onGestureEnd(event: Event): void {
    event.preventDefault();
  }

  private getCursorAnchorOffsetY(): number {
    const el = this.scrollContainer()?.nativeElement;
    if (!el) {
      return 0;
    }

    const cursorContentY = this.minutesToContentY(this.insertCursorMin());
    return cursorContentY - el.scrollTop;
  }

  private getAnchorOffsetY(event?: WheelEvent): number {
    const el = this.scrollContainer()?.nativeElement;
    if (!el) {
      return 0;
    }

    if (event) {
      const rect = el.getBoundingClientRect();
      return event.clientY - rect.top;
    }

    return el.clientHeight / 2;
  }

  private applyZoomAtAnchor(targetScale: number, anchorOffsetY: number): void {
    const clamped = Math.min(MAX_ZOOM, Math.max(this.minZoomScale(), targetScale));
    if (Math.abs(clamped - this.zoomScale()) < 0.001) {
      return;
    }

    const el = this.scrollContainer()?.nativeElement;
    const oldHeight = this.canvasHeightPx();
    const anchorContentY = el ? el.scrollTop + anchorOffsetY : 0;
    const anchorRatio = oldHeight > 0 ? anchorContentY / oldHeight : 0;

    this.zoomScale.set(clamped);

    if (!el) {
      return;
    }

    el.scrollTop = anchorRatio * this.canvasHeightPx() - anchorOffsetY;
  }

  /** Most zoomed-out level: full 24h grid fits inside the fixed scroll viewport. */
  private minZoomScale(): number {
    const viewport = this.scrollViewportHeight();
    if (viewport <= 0) {
      return DEFAULT_ZOOM;
    }

    const available = Math.max(0, viewport - LAYOUT_PADDING_Y_PX);
    if (available >= BASE_DAY_HEIGHT_PX) {
      return DEFAULT_ZOOM;
    }

    return available / BASE_DAY_HEIGHT_PX;
  }

  private clampZoomToViewport(): void {
    const min = this.minZoomScale();
    const current = this.zoomScale();
    if (current >= min) {
      return;
    }

    this.zoomScale.set(min);
    const el = this.scrollContainer()?.nativeElement;
    if (el) {
      el.scrollTop = 0;
    }
  }
}

function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * 120;
  }
  return event.deltaY;
}

function localTimestampFromMinutes(viewDate: string, minutes: number): string {
  const [year, month, day] = viewDate.split('-').map(Number);
  return new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0).toISOString();
}
