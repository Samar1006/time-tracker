// aggregationService.js — bucket raw events into hour-by-hour timeline blocks.

import { categorizeDomain, categorizeText } from './categorizationService.js';
import { isMacTrackerBrowserFocus } from './browserFilter.js';

const MS_PER_SEC = 1000;

export function parseDateOnly(input) {
  if (!input) return null;
  const match = String(input).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(date, days) {
  const base = new Date(`${date}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function eventInterval(event) {
  const startMs = Date.parse(event.timestamp);
  const durationSec = Number(event.durationSec) > 0
    ? Number(event.durationSec)
    : inferDurationSec(event);
  const endMs = startMs + durationSec * MS_PER_SEC;
  return { startMs, endMs, durationSec };
}

function inferDurationSec(event) {
  // Default point-in-time events to 5 minutes for visualization.
  return 300;
}

/** Fast total for calendar dots — skips hour bucketing. */
export function sumTrackedSec(events) {
  return events.reduce((total, event) => total + eventInterval(event).durationSec, 0);
}

export function mapSource(type) {
  if (type === 'manual') return 'manual';
  if (type === 'voice') return 'voice';
  return 'tracked';
}

export function activityLabel(event) {
  if (event.type === 'domain_visit' && event.domain) return event.domain;
  if (event.app && event.domain) return `${event.domain} / ${event.app}`;
  if (event.domain) return event.domain;
  if (event.app) return event.app;
  if (event.title) return event.title;
  return 'Unknown activity';
}

/** Classify manual/voice events at ingest so stored metadata carries category. */
export function classifyStoredEvent(event) {
  if (event.type !== 'manual' && event.type !== 'voice') {
    return event;
  }

  const { category, confidence } = event.domain
    ? categorizeDomain(event.domain)
    : categorizeText(activityLabel(event));

  return {
    ...event,
    metadata: {
      ...(event.metadata ?? {}),
      category,
      confidence,
    },
  };
}

export function localDateString(ms, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function localHour(ms, timeZone) {
  const hour = Number.parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(new Date(ms)),
    10,
  );
  return hour === 24 ? 0 : hour;
}

function localDayRangeMs(date, timeZone) {
  const utcMid = Date.parse(`${date}T00:00:00.000Z`);
  const windowStart = utcMid - 14 * 3600 * MS_PER_SEC;
  const windowEnd = utcMid + 38 * 3600 * MS_PER_SEC;

  // Binary search — O(log n) instead of ~100k second-by-second Intl calls.
  let lo = windowStart;
  let hi = windowEnd;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDateString(mid, timeZone) < date) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;

  lo = start;
  hi = start + 28 * 3600 * MS_PER_SEC;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDateString(mid, timeZone) === date) lo = mid + 1;
    else hi = mid;
  }
  const end = lo;

  return { start, end };
}

/** True when a stored event interval overlaps a local calendar day. */
export function eventOverlapsLocalDate(event, date, timeZone = 'UTC') {
  const { startMs, endMs } = eventInterval(event);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return false;
  }
  const { start, end } = localDayRangeMs(date, timeZone);
  return startMs < end && endMs > start;
}

function nextHourBoundaryMs(cursor, clampedEnd, timeZone, hour) {
  let lo = cursor + 1;
  let hi = clampedEnd;
  if (lo >= hi) return clampedEnd;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localHour(mid, timeZone) === hour) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function splitEventAcrossHoursLocal(event, date, timeZone) {
  const { startMs, endMs } = eventInterval(event);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const { start: dayStart, end: dayEnd } = localDayRangeMs(date, timeZone);
  const clampedStart = Math.max(startMs, dayStart);
  const clampedEnd = Math.min(endMs, dayEnd);
  if (clampedEnd <= clampedStart) return [];

  const slices = [];
  let cursor = clampedStart;

  while (cursor < clampedEnd) {
    const hour = localHour(cursor, timeZone);
    const sliceEnd = nextHourBoundaryMs(cursor, clampedEnd, timeZone, hour);
    const durationSec = (sliceEnd - cursor) / MS_PER_SEC;
    if (durationSec > 0) {
      slices.push({
        hour,
        startMs: cursor,
        endMs: sliceEnd,
        durationSec,
        event,
      });
    }
    cursor = sliceEnd;
  }

  return slices;
}

/**
 * Split an interval into per-hour slices for a calendar date.
 */
export function splitEventAcrossHours(event, date, timeZone = 'UTC') {
  if (timeZone && timeZone !== 'UTC') {
    return splitEventAcrossHoursLocal(event, date, timeZone);
  }

  return splitEventAcrossHoursUtc(event, date);
}

function splitEventAcrossHoursUtc(event, date) {
  const { startMs, endMs } = eventInterval(event);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const dayStart = Date.parse(`${date}T00:00:00.000Z`);
  const dayEnd = dayStart + 24 * 60 * 60 * MS_PER_SEC;
  const clampedStart = Math.max(startMs, dayStart);
  const clampedEnd = Math.min(endMs, dayEnd);
  if (clampedEnd <= clampedStart) return [];

  const slices = [];
  let cursor = clampedStart;

  while (cursor < clampedEnd) {
    const hour = new Date(cursor).getUTCHours();
    const hourEnd = Date.UTC(
      new Date(cursor).getUTCFullYear(),
      new Date(cursor).getUTCMonth(),
      new Date(cursor).getUTCDate(),
      hour + 1,
      0,
      0,
      0,
    );
    const sliceEnd = Math.min(hourEnd, clampedEnd);
    const durationSec = (sliceEnd - cursor) / MS_PER_SEC;
    if (durationSec > 0) {
      slices.push({
        hour,
        startMs: cursor,
        endMs: sliceEnd,
        durationSec,
        event,
      });
    }
    cursor = sliceEnd;
  }

  return slices;
}

function mergeKey(slice) {
  const { event } = slice;
  return [
    slice.hour,
    event.id ?? '',
    event.type,
    event.app ?? '',
    event.domain ?? '',
    activityLabel(event),
  ].join('|');
}

function blocksAreAdjacent(a, b) {
  if (a.end === b.start) return true;
  const gapMs = Date.parse(b.start) - Date.parse(a.end);
  return gapMs >= 0 && gapMs <= 3000;
}

function trackedBlocksCanCoalesce(last, block) {
  if (last.source !== 'tracked' || block.source !== 'tracked') return false;
  if (last.activity !== block.activity || last.category !== block.category) return false;

  const lastStart = Date.parse(last.start);
  const lastEnd = Date.parse(last.end);
  const blockStart = Date.parse(block.start);
  const blockEnd = Date.parse(block.end);

  if (blocksAreAdjacent(last, block)) return true;
  return blockStart < lastEnd && blockEnd > lastStart;
}

function mergeTrackedBlocks(last, block) {
  const lastStart = Date.parse(last.start);
  const lastEnd = Date.parse(last.end);
  const blockStart = Date.parse(block.start);
  const blockEnd = Date.parse(block.end);
  const mergedStart = Math.min(lastStart, blockStart);
  const mergedEnd = Math.max(lastEnd, blockEnd);

  last.start = new Date(mergedStart).toISOString();
  last.end = new Date(mergedEnd).toISOString();
  last.durationSec = Math.round((mergedEnd - mergedStart) / 1000);

  const lastEventEnd = last.eventEnd ? Date.parse(last.eventEnd) : lastEnd;
  const blockEventEnd = block.eventEnd ? Date.parse(block.eventEnd) : blockEnd;
  last.eventEnd = new Date(Math.max(lastEventEnd, blockEventEnd)).toISOString();
  last.eventStart = last.eventStart ?? last.start;
}

/** Merge back-to-back tracked events (e.g. Chrome extension 1-min flushes) into one block. */
function coalesceAdjacentTrackedBlocks(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
  const merged = [];

  for (const block of sorted) {
    const last = merged.at(-1);
    if (last && trackedBlocksCanCoalesce(last, block)) {
      mergeTrackedBlocks(last, block);
    } else {
      merged.push({ ...block });
    }
  }

  return merged;
}

/**
 * @param {import('./activityStore.js').StoredEvent[]} events
 * @param {string} date YYYY-MM-DD
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} [opts.timezone]
 */
export function aggregateTimeline(events, date, { userId, timezone = 'UTC' } = {}) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    totalTrackedSec: 0,
    blocks: [],
  }));

  /** @type {Map<string, object>} */
  const merged = new Map();

  for (const event of events) {
    if (isMacTrackerBrowserFocus(event)) continue;
    for (const slice of splitEventAcrossHours(event, date, timezone)) {
      const key = mergeKey(slice);
      const existing = merged.get(key);
      if (existing) {
        existing.durationSec += slice.durationSec;
        existing.endMs = slice.endMs;
      } else {
        merged.set(key, { ...slice });
      }
    }
  }

  for (const slice of merged.values()) {
    const roundedSec = Math.round(slice.durationSec);
    if (roundedSec <= 0) continue;

    const { startMs: eventStartMs, endMs: eventEndMs } = eventInterval(slice.event);
    const spansNextDay = localDateString(eventEndMs, timezone) > date;
    const spansFromPrevDay = localDateString(eventStartMs, timezone) < date;

    // Use the shared AI categorizer: by domain when present, else by label text.
    const { category, confidence } = slice.event.domain
      ? categorizeDomain(slice.event.domain)
      : categorizeText(activityLabel(slice.event));

    const hourBucket = hours[slice.hour];
    hourBucket.blocks.push({
      start: new Date(slice.startMs).toISOString(),
      end: new Date(slice.endMs).toISOString(),
      eventStart: new Date(eventStartMs).toISOString(),
      eventEnd: new Date(eventEndMs).toISOString(),
      eventId: slice.event.id,
      spansNextDay,
      spansFromPrevDay,
      activity: activityLabel(slice.event),
      category,
      source: mapSource(slice.event.type),
      confidence,
      durationSec: roundedSec,
    });
    hourBucket.totalTrackedSec += roundedSec;
  }

  for (const hourBucket of hours) {
    hourBucket.blocks = coalesceAdjacentTrackedBlocks(hourBucket.blocks);
    hourBucket.blocks.sort((a, b) => b.durationSec - a.durationSec);
  }

  const totalTrackedSec = hours.reduce((sum, h) => sum + h.totalTrackedSec, 0);

  return {
    userId,
    date,
    timezone,
    totalTrackedSec,
    hours,
  };
}

export default {
  parseDateOnly,
  todayUtcDate,
  eventInterval,
  splitEventAcrossHours,
  aggregateTimeline,
  classifyStoredEvent,
  activityLabel,
};
