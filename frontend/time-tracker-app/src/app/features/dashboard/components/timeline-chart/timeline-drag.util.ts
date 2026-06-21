import { TimelineBlock } from '../../../../core/models/timeline.model';

export const SNAP_MINUTES = 5;
export const MIN_DURATION_MINUTES = 5;
export const MINUTES_PER_DAY = 24 * 60;
export const RESIZE_HANDLE_PX = 8;

export type DragMode = 'move' | 'resize-top' | 'resize-bottom';

export interface EventTimePatch {
  eventId: string;
  timestamp: string;
  durationSec: number;
  metadata: { localDate: string; endLocalDate?: string };
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

/** Vertical pointer delta in px → minutes on the day column. */
export function deltaPxToMinutes(deltaPx: number, canvasHeightPx: number): number {
  if (canvasHeightPx <= 0) return 0;
  return (deltaPx / canvasHeightPx) * MINUTES_PER_DAY;
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
  const origStartMin = minutesOnViewDate(eventStartIso, viewDate);
  const deltaStartMin = startMin - origStartMin;
  const durationSec = Math.round((endMin - startMin) * 60);

  const timestamp = new Date(Date.parse(eventStartIso) + deltaStartMin * 60 * 1000).toISOString();

  return {
    eventId: block.eventId,
    timestamp,
    durationSec,
    metadata: { localDate: viewDate }
  };
}
