// scheduleMutationService.js — natural-language edits to existing timeline events.

import {
  activityLabel,
  addDaysISO,
  eventInterval,
  eventOverlapsLocalDate,
  parseDateOnly,
} from './aggregationService.js';
import { loadEvents, replaceEvent } from './activityStore.js';
import { localTimestamp } from '../utils/voiceBlockConversion.js';
import {
  extractDurationMinutes,
  resolveCalendarDate,
  resolveDayFromSegment,
  toDateISO,
} from '../routes/schedule.js';

const MIN_DURATION_SEC = 15 * 60;
const MUTABLE_TYPES = new Set(['voice', 'manual']);
const GENERIC_TARGETS = new Set(['it', 'that', 'this', 'the event', 'the block']);

/** @typedef {{ lastEventId?: string, lastTargetActivity?: string, lastStorageDate?: string }} VoiceMutationContext */

/** True when transcript looks like an edit, not a new activity log. */
export function isMutationTranscript(transcript, context = null) {
  const t = String(transcript ?? '').trim().toLowerCase();
  if (!t) return false;
  if (/\b(?:from|between)\s+.+\s+(?:to|until|till)\s+\d/.test(t)) return false;
  if (/\b(?:from|between)\s+.+\s+(?:to|until|till)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d)/.test(t)) {
    return false;
  }
  if (/\b(?:i\s+)?(?:worked|studied|slept|ate|had|went|spent)\b/.test(t) && !/\b(?:push|move|shorten|reschedule|delay)\s+(?:my|it|that|this)\b/.test(t)) {
    return false;
  }

  const hasContext = Boolean(context?.lastEventId || context?.lastTargetActivity);
  if (hasContext) {
    if (/\b(?:actually|instead|wait|sorry|no|okay)\b/.test(t) && /\b(?:push|shift|move|shorten|extend|delay|reschedule)\b/.test(t)) {
      return true;
    }
    if (/\b(?:push|move|shift|shorten|extend)\s+(?:it|that|this)\b/.test(t)) return true;
    if (/\b(?:one|two|three|\d+)\s+more\s+hours?\b/.test(t) && /\b(?:back|later|forward|earlier)\b/.test(t)) {
      return true;
    }
  }

  return (
    /\b(?:push|delay|postpone|reschedule|shift)\b/.test(t)
    || /\bmove\s+(?:my\s+)?(?:\w+|it|that|this)\b/.test(t)
    || /\b(?:shorten|reduce|cut|extend|lengthen)\s+(?:my\s+)?(?:\w+|it|that|this)\b/.test(t)
  );
}

function stripTargetPhrase(text) {
  return String(text ?? '')
    .replace(/^(?:please\s+)?(?:can you\s+)?(?:actually\s+|instead\s+|wait\s+|sorry\s+)?/i, '')
    .replace(/\b(?:my|the|a|an)\b/gi, ' ')
    .replace(/\b(?:today|tomorrow|yesterday)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveTargetActivity(extracted, context) {
  const cleaned = stripTargetPhrase(extracted);
  if (cleaned.length >= 2 && !GENERIC_TARGETS.has(cleaned.toLowerCase())) {
    return cleaned;
  }
  return context?.lastTargetActivity ?? null;
}

function extractTargetActivity(transcript) {
  const t = transcript.trim();
  const patterns = [
    /\b(?:push|delay|postpone|reschedule|shift|move|shorten|reduce|cut|extend|lengthen)\s+(?:my\s+)?(.+?)\s+(?:back|forward|later|earlier|up|out|to|by)\b/i,
    /\b(?:push|delay|postpone|reschedule|shift|move|shorten|reduce|cut|extend|lengthen)\s+(?:my\s+)?(.+?)$/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const cleaned = stripTargetPhrase(m[1]);
      if (cleaned.length >= 2) return cleaned;
    }
  }
  return null;
}

/** Parse the destination day phrase after "to" in move/reschedule commands. */
export function extractMoveDestination(transcript, referenceDate) {
  const t = transcript.trim();
  const moveRe = /\b(?:move|reschedule|shift)\s+(?:(?:my|the|a|an)\s+)?(?:(?:\w+\s+){0,4}\w+\s+|(?:it|that|this)\s+)??to\s+(.+)$/i;
  const m = t.match(moveRe);
  if (!m?.[1]) return null;

  const dest = m[1].replace(/[.!?]+$/, '').trim();
  if (!dest) return null;

  const calendar = resolveCalendarDate(dest, referenceDate);
  if (calendar?.date) return calendar.date;

  const day = resolveDayFromSegment(dest, referenceDate, null);
  if (!day?.date) return null;

  const hasExplicitDay =
    /\b(?:tomorrow|yesterday|next\s+|today)\b/i.test(dest)
    || /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i.test(dest);

  return hasExplicitDay ? day.date : null;
}

/**
 * @returns {{
 *   action: 'shift_start' | 'move_date' | 'resize',
 *   targetActivity: string | null,
 *   deltaMin: number | null,
 *   newDate: string | null,
 *   direction: 1 | -1,
 * } | null}
 */
export function parseMutationTranscript(transcript, referenceDate = new Date(), context = null) {
  if (!isMutationTranscript(transcript, context)) return null;

  const t = transcript.trim();
  const lower = t.toLowerCase();
  const extractedTarget = extractTargetActivity(t);
  const targetActivity = resolveTargetActivity(extractedTarget, context);

  const moveDate = extractMoveDestination(t, referenceDate);
  if (moveDate) {
    return {
      action: 'move_date',
      targetActivity,
      deltaMin: null,
      newDate: moveDate,
      direction: 1,
    };
  }

  const shorten = /\b(?:shorten|reduce|cut|trim)\b/.test(lower);
  const extend = /\b(?:extend|lengthen|make\s+longer)\b/.test(lower);
  if (shorten || extend) {
    const deltaMin = extractDurationMinutes(t) ?? 60;
    return {
      action: 'resize',
      targetActivity,
      deltaMin,
      newDate: null,
      direction: extend ? 1 : -1,
    };
  }

  const back = /\b(?:back|later|out|after)\b/.test(lower);
  const forward = /\b(?:forward|earlier|up|sooner)\b/.test(lower);
  const deltaMin = extractDurationMinutes(t) ?? 60;
  const direction = forward && !back ? -1 : 1;

  return {
    action: 'shift_start',
    targetActivity,
    deltaMin,
    newDate: null,
    direction,
  };
}

function scoreEventMatch(event, targetActivity, viewDate, timeZone, context) {
  if (!MUTABLE_TYPES.has(event.type)) return -1;

  const label = activityLabel(event).toLowerCase();
  let score = 0;

  if (context?.lastEventId && event.id === context.lastEventId) {
    score += 100;
  }

  if (targetActivity) {
    const terms = targetActivity.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (terms.length === 0) {
      if (label.includes(targetActivity.toLowerCase())) score += 10;
    } else {
      for (const term of terms) {
        if (label.includes(term)) score += 8;
      }
    }
    if (score === 0 && !(context?.lastEventId && event.id === context.lastEventId)) return -1;
  } else if (context?.lastEventId && event.id === context.lastEventId) {
    score += 10;
  } else {
    score += 2;
  }

  const storageDate = parseDateOnly(event.metadata?.localDate) ?? parseDateOnly(event.timestamp);
  if (storageDate === viewDate) score += 5;
  if (eventOverlapsLocalDate(event, viewDate, timeZone)) score += 3;
  if (event.type === 'voice') score += 2;

  const { startMs } = eventInterval(event);
  const viewMid = Date.parse(`${viewDate}T12:00:00.000Z`);
  score -= Math.min(4, Math.abs(startMs - viewMid) / (4 * 3600 * 1000));

  return score;
}

function localMinutesFromTimestamp(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(new Date(iso));

  let hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  if (hour === 24) hour = 0;
  const minute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}

function syncOvernightMetadata(event, timeZone) {
  const localDate = parseDateOnly(event.metadata?.localDate) ?? parseDateOnly(event.timestamp);
  if (!localDate) return event;

  const startMin = localMinutesFromTimestamp(event.timestamp, timeZone);
  const durationSec = Number(event.durationSec) > 0 ? Number(event.durationSec) : 3600;
  const endMin = startMin + durationSec / 60;
  const metadata = { ...(event.metadata ?? {}), localDate };

  if (endMin > 24 * 60) {
    metadata.endLocalDate = addDaysISO(localDate, 1);
  } else {
    delete metadata.endLocalDate;
  }

  return { ...event, metadata };
}

function applyShiftStart(event, deltaMin, direction, timeZone) {
  const deltaMs = direction * deltaMin * 60 * 1000;
  const next = {
    ...event,
    timestamp: new Date(Date.parse(event.timestamp) + deltaMs).toISOString(),
  };
  return syncOvernightMetadata(next, timeZone);
}

function wallClockToIso(date, minutesSinceMidnight, timeZone) {
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  if (timeZone === 'UTC') {
    const [y, mo, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d, hour, minute, 0)).toISOString();
  }
  return localTimestamp(date, minutesSinceMidnight);
}

function applyMoveDate(event, newDate, timeZone) {
  const localDate = parseDateOnly(event.metadata?.localDate) ?? parseDateOnly(event.timestamp);
  if (!localDate || !newDate) return event;

  const startMin = localMinutesFromTimestamp(event.timestamp, timeZone);
  const next = {
    ...event,
    timestamp: wallClockToIso(newDate, startMin, timeZone),
    metadata: {
      ...(event.metadata ?? {}),
      localDate: newDate,
    },
  };

  const durationSec = Number(event.durationSec) > 0 ? Number(event.durationSec) : 3600;
  const endMin = startMin + durationSec / 60;
  if (endMin > 24 * 60) {
    next.metadata.endLocalDate = addDaysISO(newDate, 1);
  } else {
    delete next.metadata.endLocalDate;
  }

  return next;
}

function applyResize(event, deltaMin, direction, timeZone) {
  const current = Number(event.durationSec) > 0 ? Number(event.durationSec) : 3600;
  const nextSec = Math.max(MIN_DURATION_SEC, current + direction * deltaMin * 60);
  const next = { ...event, durationSec: Math.round(nextSec) };
  return syncOvernightMetadata(next, timeZone);
}

async function loadCandidateEvents(userId, viewDate, timeZone, context = null) {
  const dates = new Set([
    addDaysISO(viewDate, -1),
    viewDate,
    addDaysISO(viewDate, 1),
    addDaysISO(viewDate, 7),
    addDaysISO(viewDate, 14),
  ]);

  if (context?.lastStorageDate) {
    dates.add(context.lastStorageDate);
  }

  const byId = new Map();

  for (const date of dates) {
    const dayEvents = await loadEvents(userId, date);
    for (const event of dayEvents) {
      if (context?.lastEventId && event.id === context.lastEventId) {
        byId.set(event.id, { event, storageDate: date });
        continue;
      }
      if (MUTABLE_TYPES.has(event.type) && eventOverlapsLocalDate(event, viewDate, timeZone)) {
        byId.set(event.id, { event, storageDate: date });
      } else if (MUTABLE_TYPES.has(event.type) && date === viewDate) {
        byId.set(event.id, { event, storageDate: date });
      }
    }
  }

  return [...byId.values()];
}

function pickBestMatch(candidates, targetActivity, viewDate, timeZone, context) {
  let best = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const score = scoreEventMatch(candidate.event, targetActivity, viewDate, timeZone, context);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore > 0 ? best : null;
}

function buildVoiceContext(event) {
  const storageDate = eventStorageDate(event);
  return {
    lastEventId: event.id,
    lastTargetActivity: activityLabel(event),
    lastStorageDate: storageDate ?? undefined,
  };
}

function eventStorageDate(event) {
  const localDate = parseDateOnly(event.metadata?.localDate);
  if (localDate) return localDate;
  return parseDateOnly(event.timestamp);
}

/**
 * Parse and apply a spoken schedule mutation.
 * @returns {Promise<{ applied: boolean, intent: 'mutate' | 'create', reason?: string, event?: object, operation?: object }>}
 */
export async function applyScheduleMutation({
  userId,
  transcript,
  referenceDate = new Date(),
  viewDate,
  timeZone = 'UTC',
  voiceContext = null,
}) {
  const mutation = parseMutationTranscript(transcript, referenceDate, voiceContext);
  if (!mutation) {
    return { applied: false, intent: 'create', reason: 'not_a_mutation' };
  }

  const refDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const day = viewDate ?? toDateISO(refDate);
  const candidates = await loadCandidateEvents(userId, day, timeZone, voiceContext);

  if (candidates.length === 0) {
    return { applied: false, intent: 'mutate', reason: 'no_events_to_edit' };
  }

  const match = pickBestMatch(candidates, mutation.targetActivity, day, timeZone, voiceContext);
  if (!match) {
    return {
      applied: false,
      intent: 'mutate',
      reason: mutation.targetActivity || voiceContext?.lastEventId ? 'no_matching_event' : 'ambiguous_target',
    };
  }

  let updated;
  if (mutation.action === 'move_date') {
    updated = applyMoveDate(match.event, mutation.newDate, timeZone);
  } else if (mutation.action === 'resize') {
    updated = applyResize(match.event, mutation.deltaMin ?? 60, mutation.direction, timeZone);
  } else {
    updated = applyShiftStart(match.event, mutation.deltaMin ?? 60, mutation.direction, timeZone);
  }

  const saved = await replaceEvent(userId, match.storageDate, match.event.id, updated);
  if (!saved) {
    return { applied: false, intent: 'mutate', reason: 'update_failed' };
  }

  return {
    applied: true,
    intent: 'mutate',
    operation: {
      action: mutation.action,
      eventId: match.event.id,
      matchedActivity: activityLabel(match.event),
      deltaMin: mutation.deltaMin,
      newDate: mutation.newDate,
    },
    event: saved,
    voiceContext: buildVoiceContext(saved),
    navigateToDate: mutation.action === 'move_date' ? mutation.newDate : eventStorageDate(saved),
  };
}

export default {
  isMutationTranscript,
  parseMutationTranscript,
  applyScheduleMutation,
};
