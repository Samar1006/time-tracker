import { CreateEventPayload } from '../../../../core/services/timeline.service';
import { TimelineBlock } from '../../../../core/models/timeline.model';
import { localTimestamp } from '../../../../core/utils/voice-block.util';

export const SNAP_MINUTES = 5;
export const MIN_DURATION_MINUTES = 5;
export const DEFAULT_CREATE_DURATION_MINUTES = 60;
export const MINUTES_PER_DAY = 24 * 60;
export const RESIZE_HANDLE_PX = 8;

export type DragMode = 'move' | 'resize-top' | 'resize-bottom';

export interface EventTimePatch {
  eventId: string;
  timestamp: string;
  durationSec: number;
  metadata: { localDate: string; endLocalDate?: string };
}

export interface EventTimeChangePayload {
  label: string;
  previous: EventTimePatch;
  next: EventTimePatch;
}

export interface BlocksDayShiftPayload {
  changes: EventTimeChangePayload[];
  targetDate: string;
  sourceDate: string;
}

export interface BlockDeletePayload {
  eventId: string;
  restore: CreateEventPayload;
}

export interface EventCreateDraft {
  timestamp: string;
  type: 'manual';
  title: string;
  durationSec: number;
  metadata: {
    category: string;
    sourceClient: string;
    localDate: string;
    endLocalDate?: string;
  };
}

/** Round to nearest 5-minute grid (9:07 → 9:05, 9:08 → 9:10). */
export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

export function clampIntervalToDay(
  startMin: number,
  endMin: number
): { startMin: number; endMin: number } {
  let start = snapMinutes(startMin);
  let end = snapMinutes(endMin);
  let duration = end - start;

  if (duration < MIN_DURATION_MINUTES) {
    if (end + (MIN_DURATION_MINUTES - duration) <= MINUTES_PER_DAY) {
      end = start + MIN_DURATION_MINUTES;
    } else {
      start = Math.max(0, end - MIN_DURATION_MINUTES);
    }
    duration = end - start;
  }

  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > MINUTES_PER_DAY) {
    start -= end - MINUTES_PER_DAY;
    end = MINUTES_PER_DAY;
  }
  start = Math.max(0, start);
  end = Math.min(MINUTES_PER_DAY, Math.max(start + MIN_DURATION_MINUTES, end));

  return { startMin: start, endMin: end };
}

/** Minutes to shift a group so the earliest start (top) or latest end (bottom) hits the day edge. */
export function groupEdgeShiftDeltaMinutes(
  intervals: readonly { startMin: number; endMin: number }[],
  edge: 'top' | 'bottom'
): number {
  if (intervals.length === 0) {
    return 0;
  }
  if (edge === 'top') {
    return -Math.min(...intervals.map((interval) => interval.startMin));
  }
  return MINUTES_PER_DAY - Math.max(...intervals.map((interval) => interval.endMin));
}

/** Vertical pointer delta in px → minutes on the day column. */
export function deltaPxToMinutes(deltaPx: number, canvasHeightPx: number): number {
  if (canvasHeightPx <= 0) return 0;
  return (deltaPx / canvasHeightPx) * MINUTES_PER_DAY;
}

/** Pointer offset within the day column (px from top) → minutes since midnight. */
export function offsetYToMinutes(offsetY: number, canvasHeightPx: number): number {
  if (canvasHeightPx <= 0) return 0;
  return snapMinutes((offsetY / canvasHeightPx) * MINUTES_PER_DAY);
}

/** Click-to-create on empty canvas: one hour starting at the snapped click time. */
export function defaultCreateInterval(anchorMin: number): { startMin: number; endMin: number } {
  let startMin = snapMinutes(anchorMin);
  let endMin = startMin + DEFAULT_CREATE_DURATION_MINUTES;
  if (endMin > MINUTES_PER_DAY) {
    endMin = MINUTES_PER_DAY;
    startMin = Math.max(0, endMin - DEFAULT_CREATE_DURATION_MINUTES);
  }
  return { startMin, endMin };
}

/** Drag-to-create: anchor + current pointer define the interval (either direction). */
export function clampCreateDragInterval(
  anchorMin: number,
  currentMin: number
): { startMin: number; endMin: number } {
  return clampIntervalToDay(Math.min(anchorMin, currentMin), Math.max(anchorMin, currentMin));
}

export function buildCreateEventDraft(
  viewDate: string,
  startMin: number,
  endMin: number,
  title = 'New activity'
): EventCreateDraft {
  const clamped = clampIntervalToDay(startMin, endMin);
  const durationSec = Math.round((clamped.endMin - clamped.startMin) * 60);

  return {
    timestamp: localTimestamp(viewDate, clamped.startMin),
    type: 'manual',
    title,
    durationSec,
    metadata: {
      category: 'uncategorized',
      sourceClient: 'dashboard-drag',
      localDate: viewDate
    }
  };
}

/** Visible slice on the viewed day (matches layoutVerticalBlocks clipping). */
export function visibleBlockIntervalMinutes(
  block: TimelineBlock,
  viewDate: string,
  minutesOnViewDate: (iso: string, viewDate: string) => number,
  rangeStartMin = 0,
  rangeSpanMin = MINUTES_PER_DAY
): { startMin: number; endMin: number } {
  const startMin = minutesOnViewDate(block.start, viewDate);
  let endMin = minutesOnViewDate(block.end, viewDate);
  if (endMin <= startMin && block.durationSec > 0) {
    endMin = startMin + block.durationSec / 60;
  }
  const clipStart = Math.max(startMin, rangeStartMin);
  const clipEnd = Math.min(endMin, rangeStartMin + rangeSpanMin);
  if (clipEnd <= clipStart) {
    return { startMin: clipStart, endMin: clipStart };
  }
  return { startMin: clipStart, endMin: clipEnd };
}

export function buildRestorePayloadFromBlock(
  block: TimelineBlock,
  viewDate: string
): CreateEventPayload {
  const startIso = block.eventStart ?? block.start;
  const durationSec =
    block.eventStart && block.eventEnd
      ? Math.max(0, Math.round((Date.parse(block.eventEnd) - Date.parse(block.eventStart)) / 1000))
      : block.durationSec;

  return {
    timestamp: startIso,
    type: 'manual',
    title: block.activity,
    durationSec,
    metadata: {
      category: block.category,
      localDate: viewDate,
      sourceClient: 'dashboard-undo'
    }
  };
}

export function buildEventTimePatch(
  block: TimelineBlock,
  viewDate: string,
  startMin: number,
  endMin: number,
  minutesOnViewDate: (iso: string, viewDate: string) => number
): EventTimePatch {
  if (!block.eventId) {
    throw new Error('Block has no eventId');
  }

  const eventStartIso = block.eventStart ?? block.start;
  const origSliceStartMin = minutesOnViewDate(block.start, viewDate);
  const deltaStartMin = startMin - origSliceStartMin;
  const durationSec = Math.round((endMin - startMin) * 60);

  const timestamp = new Date(Date.parse(eventStartIso) + deltaStartMin * 60 * 1000).toISOString();

  return {
    eventId: block.eventId,
    timestamp,
    durationSec,
    metadata: { localDate: viewDate }
  };
}

export function shiftViewDate(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fullEventDurationSec(block: TimelineBlock): number {
  if (block.eventStart && block.eventEnd) {
    return Math.max(
      0,
      Math.round((Date.parse(block.eventEnd) - Date.parse(block.eventStart)) / 1000)
    );
  }
  return block.durationSec;
}

/** Shift an event by whole days, preserving wall-clock start and duration. */
export function buildEventDayShiftPayload(
  block: TimelineBlock,
  viewDate: string,
  dayDelta: number,
  minutesOnViewDate: (iso: string, viewDate: string) => number
): EventTimeChangePayload | null {
  if (!block.eventId || dayDelta === 0) {
    return null;
  }

  const interval = visibleBlockIntervalMinutes(block, viewDate, minutesOnViewDate);
  const previous = buildEventTimePatch(
    block,
    viewDate,
    interval.startMin,
    interval.endMin,
    minutesOnViewDate
  );

  const eventStartIso = block.eventStart ?? block.start;
  const durationSec = fullEventDurationSec(block);
  const startMin = minutesOnViewDate(eventStartIso, viewDate);
  const targetDate = shiftViewDate(viewDate, dayDelta);
  const shiftedTimestamp = new Date(
    Date.parse(eventStartIso) + dayDelta * 24 * 60 * 60 * 1000
  ).toISOString();

  const metadata: EventTimePatch['metadata'] = { localDate: targetDate };
  if (startMin + durationSec / 60 > MINUTES_PER_DAY || block.spansNextDay) {
    metadata.endLocalDate = shiftViewDate(targetDate, 1);
  }

  const next: EventTimePatch = {
    eventId: block.eventId,
    timestamp: shiftedTimestamp,
    durationSec,
    metadata
  };

  return { label: 'Move block', previous, next };
}
