// aggregationService.js — bucket raw events into hour-by-hour timeline blocks.

import { hintCategory } from './categoryHint.js';

const MS_PER_SEC = 1000;

export function parseDateOnly(input) {
  if (!input) return null;
  const match = String(input).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
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

export function mapSource(type) {
  if (type === 'manual') return 'manual';
  if (type === 'voice') return 'voice';
  return 'tracked';
}

export function activityLabel(event) {
  if (event.app && event.domain) return `${event.domain} / ${event.app}`;
  if (event.domain) return event.domain;
  if (event.app) return event.app;
  if (event.title) return event.title;
  return 'Unknown activity';
}

/**
 * Split an interval into per-hour slices for a calendar date (UTC).
 */
export function splitEventAcrossHours(event, date) {
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
    event.type,
    event.app ?? '',
    event.domain ?? '',
    activityLabel(event),
  ].join('|');
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
    for (const slice of splitEventAcrossHours(event, date)) {
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

    const { category, confidence } = hintCategory({
      label: activityLabel(slice.event),
      domain: slice.event.domain,
      kind: slice.event.domain ? 'domain' : 'app',
    });

    const hourBucket = hours[slice.hour];
    hourBucket.blocks.push({
      start: new Date(slice.startMs).toISOString(),
      end: new Date(slice.endMs).toISOString(),
      activity: activityLabel(slice.event),
      category,
      source: mapSource(slice.event.type),
      confidence,
      durationSec: roundedSec,
    });
    hourBucket.totalTrackedSec += roundedSec;
  }

  for (const hourBucket of hours) {
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
};
