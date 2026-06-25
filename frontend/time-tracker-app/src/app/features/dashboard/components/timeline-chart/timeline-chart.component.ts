import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  afterEveryRender,
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
  EventCreateDraft,
  EventTimeChangePayload,
  RESIZE_HANDLE_PX,
  SNAP_MINUTES,
  buildCreateEventDraft,
  buildEventDayShiftPayload,
  buildEventTimePatch,
  buildRestorePayloadFromBlock,
  shiftViewDate,
  visibleBlockIntervalMinutes,
  clampCreateDragInterval,
  clampIntervalToDay,
  deltaPxToMinutes,
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
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
/** Trackpad pinch fires wheel+ctrlKey; tuned for gesture deltas, not mouse wheel. */
const PINCH_ZOOM_SENSITIVITY = 0.005;
const DRAG_THRESHOLD_PX = 5;
const SCROLL_ANIMATION_MS = 260;
/** Continuous scroll speed while j/k is held (px/sec). */
const SCROLL_HOLD_PX_PER_SEC = 560;
const SCROLL_HOLD_ARM_MS = 80;
/** Window for the second `g` in `gg` (scroll to top). */
const GG_SEQUENCE_MS = 400;

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

/**
 * Overlapping events share horizontal space side-by-side (Apple Calendar day view).
 * Each event gets a column index; width = 1 / max concurrent columns in its cluster.
 */
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

  const items = blocks
    .map((block) => {
      // Slice start/end match the portion of this event on the viewed calendar day.
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
      const spanMin = clipEnd - clipStart;
      return {
        block,
        startMin: clipStart,
        endMin: clipEnd,
        topPct: ((clipStart - rangeStartMin) / rangeSpanMin) * 100,
        heightPct: (spanMin / rangeSpanMin) * 100,
        column: 0,
        columnCount: 1
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const columnEnds: number[] = [];
  for (const item of items) {
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

  for (const item of items) {
    let maxColumn = item.column;
    for (const other of items) {
      if (other.startMin < item.endMin - 0.01 && other.endMin > item.startMin + 0.01) {
        maxColumn = Math.max(maxColumn, other.column);
      }
    }
    item.columnCount = maxColumn + 1;
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

interface ActiveCreateDrag {
  anchorStartMin: number;
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
  readonly blockDelete = output<BlockDeletePayload>();
  readonly blocksDayShift = output<BlocksDayShiftPayload>();
  readonly blocksSelectionChange = output<TimelineBlock[]>();

  readonly patchError = input<string | null>(null);
  readonly createBusy = input(false);
  readonly preservedSelectionIds = input<readonly string[]>([]);

  private readonly scrollContainer = viewChild<ElementRef<HTMLElement>>('scrollContainer');
  private readonly calendarCanvas = viewChild<ElementRef<HTMLElement>>('calendarCanvas');
  private readonly createLabelInput = viewChild<ElementRef<HTMLInputElement>>('createLabelInput');
  private skipCreateLabelBlur = false;
  private createBusyWasTrue = false;
  private labelBlurReady = false;
  private createLabelFocusKey = 0;
  private pinchStartScale = MIN_ZOOM;
  private pointerAnchorY = 0;
  private savedScrollTop = 0;
  private stableDate = '';
  private scrollRestorePending = false;
  private pendingDateChange = false;
  private pendingDate = '';
  private readonly pendingReselectTargetDate = signal<string | null>(null);

  readonly zoomScale = signal(MIN_ZOOM);
  readonly tooltip = signal<TooltipState | null>(null);
  readonly contextMenu = signal<ContextMenuState | null>(null);
  readonly activeDrag = signal<ActiveDrag | null>(null);
  readonly dragPreview = signal<DragPreview | null>(null);
  readonly activeCreateDrag = signal<ActiveCreateDrag | null>(null);
  readonly createPreview = signal<CreatePreview | null>(null);
  readonly labelingCreate = signal<CreatePreview | null>(null);
  readonly createLabel = signal('');
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
  private pendingScrollKey: { direction: 1 | -1; el: HTMLElement; holdStarted: boolean } | null = null;
  private pendingFirstGTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly boundScrollKeyUp = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key !== 'j' && key !== 'k') {
      return;
    }

    const pending = this.pendingScrollKey;
    if (pending && !pending.holdStarted) {
      this.animateTimelineScroll(pending.el, pending.direction * this.pxPerHour());
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
    const allBlocks = mergeContiguousBlocks(this.hours().flatMap((h) => h.blocks));

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

  readonly hasActivity = computed(() => {
    if (this.renderBlocks().length > 0) {
      return true;
    }
    return this.hours().some((hour) => hour.totalTrackedSec > 0);
  });

  constructor() {
    effect(() => {
      if (this.patchError()) {
        this.pendingReselectTargetDate.set(null);
        this.cancelDrag();
        this.cancelCreateDrag();
        this.cancelActivityLabel();
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
      const el = untracked(() => this.scrollContainer()?.nativeElement);

      if (!dateChanged && el) {
        this.savedScrollTop = el.scrollTop;
      }

      this.pendingDateChange = dateChanged;
      this.pendingDate = date;
      if (dateChanged) {
        if (!this.pendingReselectTargetDate()) {
          this.clearSelection();
        }
        this.scrollRestorePending = true;
      }
    });

    effect(() => {
      const preserved = this.preservedSelectionIds();
      this.hours();
      this.date();
      if (preserved.length === 0) {
        return;
      }
      untracked(() => this.applyPreservedSelection(preserved));
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
        if (this.refreshSelectionKeysFromEventIds(eventIds)) {
          this.pendingReselectTargetDate.set(null);
        }
      });
    });

    this.destroyRef.onDestroy(() => {
      this.teardownPendingBlockListeners();
      this.cancelPendingFirstG();
      this.pendingScrollKey = null;
      this.stopContinuousScroll();
      this.cancelScrollAnimation();
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
        container.scrollTop = 0;
        this.stableDate = this.pendingDate;
        this.cancelActivityLabel();
        return;
      }

      container.scrollTop = this.savedScrollTop;
    });
  }

  formatBlockDuration(seconds: number): string {
    return formatDuration(seconds);
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
    if (!this.labelingCreate()) {
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
    return `${block.eventId ?? ''}|${block.start}|${block.end}|${block.activity}|${block.category}|c${positioned.column}`;
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

    if (this.pendingFirstGTimer !== null && event.key !== 'g') {
      this.cancelPendingFirstG();
    }

    if (event.key === 'Escape') {
      if (this.contextMenu() || this.labelingCreate()) {
        return;
      }
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

    const nudgeDelta = this.nudgeKeyDelta(event.key);
    if (nudgeDelta !== null) {
      if (this.hasNudgeableSelection()) {
        this.nudgeSelectedBlocks(nudgeDelta, event);
      } else if (this.isJKKey(event.key)) {
        this.scrollTimeline(nudgeDelta > 0 ? 1 : -1, event);
      }
    }
  }

  isDraggingBlock(positioned: PositionedBlock): boolean {
    const drag = this.activeDrag();
    return drag ? this.blockTrackKey(drag.positioned) === this.blockTrackKey(positioned) : false;
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
    if (this.labelingCreate()) {
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
    if (this.activeDrag() || this.activeCreateDrag() || this.labelingCreate()) {
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
    this.activeCreateDrag.set({ anchorStartMin });
    this.updateCreatePreview(anchorStartMin);

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
    this.updateCreatePreview(this.clientYToMinutes(event.clientY, canvas));
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

  private updateCreatePreview(currentMin: number): void {
    const drag = this.activeCreateDrag();
    if (!drag) {
      return;
    }

    const clamped = clampCreateDragInterval(drag.anchorStartMin, currentMin);
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

    if (isClick && !this.labelingCreate()) {
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

  private clearSelection(): void {
    if (this.selectedBlockKeys().size === 0 && this.selectedEventIds().size === 0) {
      return;
    }
    this.selectedBlockKeys.set(new Set());
    this.selectedEventIds.set(new Set());
    this.pendingReselectTargetDate.set(null);
    this.blocksSelectionChange.emit([]);
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
    for (const block of deletable) {
      const eventId = block.eventId!;
      this.blockDelete.emit({
        eventId,
        restore: buildRestorePayloadFromBlock(block, viewDate)
      });
    }
    this.clearSelection();
  }

  private nudgeSelectedBlocks(deltaMin: number, event: KeyboardEvent): void {
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
    for (const block of blocks) {
      const interval = visibleBlockIntervalMinutes(block, this.date(), minutesOnView);
      const clamped = clampIntervalToDay(interval.startMin + deltaMin, interval.endMin + deltaMin);
      if (clamped.startMin === interval.startMin && clamped.endMin === interval.endMin) {
        continue;
      }

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
        moved += 1;
      } catch {
        // skip block
      }
    }

    if (moved === 0) {
      return;
    }
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
    this.selectedEventIds.set(
      new Set(
        changes.map((change) => change.next.eventId).filter((id): id is string => Boolean(id))
      )
    );
    this.selectDate.emit(targetDate);
    this.blocksDayShift.emit({ changes, targetDate, sourceDate: viewDate });
  }

  private applyPreservedSelection(preserved: readonly string[]): void {
    const eventIds = new Set(preserved);
    const current = this.selectedEventIds();
    if (current.size !== eventIds.size || [...current].some((id) => !eventIds.has(id))) {
      this.selectedEventIds.set(eventIds);
    }
    this.refreshSelectionKeysFromEventIds(eventIds);
  }

  private handleGoToScrollKey(event: KeyboardEvent): boolean {
    if (event.key === 'G') {
      this.cancelPendingFirstG();
      this.scrollTimelineToEdge('bottom', event);
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
      this.scrollTimelineToEdge('top', event);
      return true;
    }

    this.pendingFirstGTimer = setTimeout(() => {
      this.pendingFirstGTimer = null;
    }, GG_SEQUENCE_MS);
    return true;
  }

  private cancelPendingFirstG(): void {
    if (this.pendingFirstGTimer !== null) {
      clearTimeout(this.pendingFirstGTimer);
      this.pendingFirstGTimer = null;
    }
  }

  private scrollTimelineToEdge(edge: 'top' | 'bottom', event: KeyboardEvent): void {
    if (this.blocksKeyboardBlocked()) {
      return;
    }

    const el = this.scrollContainer()?.nativeElement;
    if (!el) {
      return;
    }

    event.preventDefault();
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    this.animateTimelineScrollTo(el, edge === 'top' ? 0 : maxTop);
  }

  private scrollTimeline(direction: 1 | -1, event: KeyboardEvent): void {
    if (this.blocksKeyboardBlocked()) {
      return;
    }

    const el = this.scrollContainer()?.nativeElement;
    if (!el) {
      return;
    }

    event.preventDefault();

    if (event.repeat) {
      this.cancelScrollAnimation();
      this.startScrollHold(direction, el);
      return;
    }

    this.cancelScrollAnimation();
    this.stopContinuousScroll();
    this.pendingScrollKey = { direction, el, holdStarted: false };
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

  private animateTimelineScrollTo(el: HTMLElement, targetTop: number): void {
    this.cancelScrollAnimation();
    this.pendingScrollKey = null;
    this.stopContinuousScroll();

    const startTop = el.scrollTop;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const clampedTarget = Math.min(maxTop, Math.max(0, targetTop));
    if (Math.abs(clampedTarget - startTop) < 0.5) {
      return;
    }

    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / SCROLL_ANIMATION_MS);
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
      const id = key.split('|')[0];
      if (id) {
        eventIds.add(id);
      }
    }
    this.selectedEventIds.set(eventIds);
    this.emitSelectionChange();
  }

  private emitSelectionChange(): void {
    this.blocksSelectionChange.emit(this.getSelectedBlocks());
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
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetScale));
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
