import { ActivityCategory, TimelineBlock, TimelineResponse } from '../../../core/models/timeline.model';
import { EventCreateDraft, EventTimePatch } from '../components/timeline-chart/timeline-drag.util';
import { getVisibleHours } from './dashboard-stats.util';

function timelineHourForIso(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false
  }).formatToParts(new Date(iso));

  let hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  if (hour === 24) {
    hour = 0;
  }
  return hour;
}

export function emptyTimelineForDate(
  date: string,
  timezone: string,
  userId: string
): TimelineResponse {
  return {
    userId,
    date,
    timezone,
    totalTrackedSec: 0,
    hours: getVisibleHours([], 0, 23)
  };
}

function removeBlocksFromTimeline(
  timeline: TimelineResponse,
  eventIds: ReadonlySet<string>
): TimelineResponse {
  const hours = timeline.hours.map((hour) => {
    const blocks = hour.blocks.filter((block) => !block.eventId || !eventIds.has(block.eventId));
    const totalTrackedSec = blocks.reduce((sum, block) => sum + block.durationSec, 0);
    return { ...hour, blocks, totalTrackedSec };
  });
  const totalTrackedSec = hours.reduce((sum, hour) => sum + hour.totalTrackedSec, 0);
  return { ...timeline, hours, totalTrackedSec };
}

function blockFromTimePatch(original: TimelineBlock, patch: EventTimePatch): TimelineBlock {
  const startMs = Date.parse(patch.timestamp);
  const endMs = startMs + patch.durationSec * 1000;
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();

  return {
    ...original,
    start,
    end,
    eventStart: start,
    eventEnd: end,
    eventId: patch.eventId,
    durationSec: patch.durationSec,
    spansNextDay: patch.metadata.endLocalDate !== undefined,
    spansFromPrevDay: false
  };
}

function addBlockToTimeline(timeline: TimelineResponse, block: TimelineBlock): TimelineResponse {
  const hour = timelineHourForIso(block.start, timeline.timezone);
  const hours = timeline.hours.map((entry) => {
    if (entry.hour !== hour) {
      return entry;
    }
    const blocks = [...entry.blocks, block];
    return {
      ...entry,
      blocks,
      totalTrackedSec: blocks.reduce((sum, item) => sum + item.durationSec, 0)
    };
  });
  const totalTrackedSec = hours.reduce((sum, entry) => sum + entry.totalTrackedSec, 0);
  return { ...timeline, hours, totalTrackedSec };
}

function indexBlocksByEventId(timeline: TimelineResponse): Map<string, TimelineBlock> {
  const byId = new Map<string, TimelineBlock>();
  for (const hour of timeline.hours) {
    for (const block of hour.blocks) {
      if (block.eventId) {
        byId.set(block.eventId, block);
      }
    }
  }
  return byId;
}

/** Update cached timelines after blocks move to another day (before the view date changes). */
export function applyDayShiftToTimelineCache(
  entries: ReadonlyMap<string, TimelineResponse>,
  sourceDate: string,
  targetDate: string,
  changes: readonly { next: EventTimePatch }[],
  sourceTimeline: TimelineResponse | null,
  userId: string
): Map<string, TimelineResponse> {
  const next = new Map(entries);
  const movedIds = new Set(changes.map((change) => change.next.eventId));

  const source =
    next.get(sourceDate) ??
    sourceTimeline ??
    emptyTimelineForDate(sourceDate, 'UTC', userId);
  const blocksById = indexBlocksByEventId(source);

  next.set(sourceDate, removeBlocksFromTimeline(source, movedIds));

  let target =
    next.get(targetDate) ?? emptyTimelineForDate(targetDate, source.timezone, source.userId);
  for (const change of changes) {
    const original = blocksById.get(change.next.eventId);
    if (!original) {
      continue;
    }
    target = addBlockToTimeline(target, blockFromTimePatch(original, change.next));
  }
  next.set(targetDate, target);

  return next;
}

function blockFromCreateDraft(draft: EventCreateDraft, eventId: string): TimelineBlock {
  const startMs = Date.parse(draft.timestamp);
  const endMs = startMs + draft.durationSec * 1000;
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  const category = (draft.metadata.category ?? 'uncategorized') as ActivityCategory;

  return {
    start,
    end,
    eventStart: start,
    eventEnd: end,
    eventId,
    spansNextDay: draft.metadata.endLocalDate !== undefined,
    spansFromPrevDay: false,
    activity: draft.title,
    category,
    source: 'manual',
    confidence: 1,
    durationSec: draft.durationSec
  };
}

/** Insert a newly created manual event into a cached day timeline. */
export function applyEventCreateToTimeline(
  timeline: TimelineResponse,
  draft: EventCreateDraft,
  eventId: string
): TimelineResponse {
  return addBlockToTimeline(timeline, blockFromCreateDraft(draft, eventId));
}

/** Remove one event from a cached day timeline. */
export function removeEventFromTimeline(
  timeline: TimelineResponse,
  eventId: string
): TimelineResponse {
  return removeBlocksFromTimeline(timeline, new Set([eventId]));
}

/** Move one event to its new time in a cached day timeline. */
export function applyEventTimeChangeToTimeline(
  timeline: TimelineResponse,
  change: { next: EventTimePatch }
): TimelineResponse {
  const original = indexBlocksByEventId(timeline).get(change.next.eventId);
  if (!original) {
    return timeline;
  }

  let updated = removeBlocksFromTimeline(timeline, new Set([change.next.eventId]));
  updated = addBlockToTimeline(updated, blockFromTimePatch(original, change.next));
  return updated;
}
