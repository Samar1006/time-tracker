// activity.js — contract endpoints: POST /api/events, GET /api/timeline

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import {
  appendEvents,
  clearEvents,
  countEvents,
  deleteStoredEvent,
  findEventOnDay,
  loadEvents,
  loadMonthDayTotals,
  replaceEvent,
} from '../services/activityStore.js';
import {
  aggregateTimeline,
  classifyStoredEvent,
  parseDateOnly,
  todayUtcDate,
  eventOverlapsLocalDate,
  addDaysISO,
  localDateString,
} from '../services/aggregationService.js';
import { isUserEditableEvent } from '../services/eventEditability.js';
import { getStorageMode } from '../services/redisClient.js';
import { sampleActivityEvents } from '../data/sampleActivityEvents.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const demoTimeline = JSON.parse(
  readFileSync(join(__dirname, '../data/demoTimeline.json'), 'utf8'),
);

function padTimelineHours(hours) {
  const byHour = new Map(hours.map((h) => [h.hour, h]));
  return Array.from({ length: 24 }, (_, hour) =>
    byHour.get(hour) ?? {
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      totalTrackedSec: 0,
      blocks: [],
    },
  );
}

function emptyTimeline(userId, date, timezone = 'UTC') {
  return {
    userId,
    date,
    timezone,
    totalTrackedSec: 0,
    hours: padTimelineHours([]),
  };
}

function resolveDate(req) {
  return parseDateOnly(req.query.date || req.body?.date) ?? todayUtcDate();
}

function rejectUserIdMismatch(res, authUserId, providedUserId, label = 'userId') {
  if (providedUserId && providedUserId !== authUserId) {
    res.status(403).json({ error: `${label} does not match authenticated user.` });
    return true;
  }
  return false;
}

function normalizeEvent(raw, index, userId) {
  const timestamp = raw.timestamp;
  const type = raw.type;

  if (!timestamp) return { error: `events[${index}] missing timestamp.` };
  if (!type) return { error: `events[${index}] missing type.` };

  const parsedTs = Date.parse(timestamp);
  if (!Number.isFinite(parsedTs)) {
    return { error: `events[${index}] has invalid timestamp.` };
  }

  return {
    id: raw.id ?? `evt_${Date.now()}_${index}`,
    userId,
    timestamp: new Date(parsedTs).toISOString(),
    type: String(type),
    app: raw.app ? String(raw.app) : undefined,
    domain: raw.domain ? String(raw.domain) : undefined,
    title: raw.title ? String(raw.title) : undefined,
    durationSec: raw.durationSec != null ? Number(raw.durationSec) : undefined,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : undefined,
  };
}

function collectEvents(body) {
  if (Array.isArray(body?.events)) return body.events;
  if (body?.timestamp && body?.type) return [body];
  return null;
}

function eventStorageDate(event) {
  const localDate = parseDateOnly(event.metadata?.localDate);
  if (localDate) return localDate;
  return parseDateOnly(event.timestamp);
}

/** Events stored on the previous day that spill into `date` (overnight spans). */
async function loadTimelineEvents(userId, date, timezone) {
  const events = await loadEvents(userId, date);
  const prevDate = addDaysISO(date, -1);
  const prevDay = await loadEvents(userId, prevDate);
  const carryover = prevDay.filter((e) => eventOverlapsLocalDate(e, date, timezone));
  const byId = new Map();
  for (const e of [...carryover, ...events]) byId.set(e.id, e);
  return [...byId.values()];
}

router.get('/timeline/health', (_req, res) => {
  res.json({ ok: true, storage: getStorageMode() });
});

router.get('/monitor/status', requireAuth, async (req, res, next) => {
  try {
    if (rejectUserIdMismatch(res, req.user.id, req.query.userId, 'userId query param')) return;

    const userId = req.user.id;
    const date = parseDateOnly(req.query.date) ?? todayUtcDate();
    const events = await loadEvents(userId, date);
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;

    res.json({
      userId,
      date,
      eventCount: events.length,
      lastEventAt: lastEvent?.timestamp ?? null,
      lastDomain: lastEvent?.domain ?? null,
      storage: getStorageMode(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/events', requireAuth, async (req, res, next) => {
  try {
    const authUserId = req.user.id;
    const incoming = collectEvents(req.body);
    if (!incoming || incoming.length === 0) {
      return res.status(400).json({ error: 'Provide a raw event or { events: [...] }.' });
    }

    for (let i = 0; i < incoming.length; i += 1) {
      if (incoming[i].userId && incoming[i].userId !== authUserId) {
        return res.status(403).json({
          error: `events[${i}] userId does not match authenticated user.`,
        });
      }
    }

    const normalized = [];
    for (let i = 0; i < incoming.length; i += 1) {
      const result = normalizeEvent(incoming[i], i, authUserId);
      if (result.error) return res.status(400).json({ error: result.error });
      normalized.push(classifyStoredEvent(result));
    }

    const byDay = new Map();
    for (const event of normalized) {
      const date = eventStorageDate(event);
      if (!date) {
        return res.status(400).json({ error: 'Each event timestamp must include a calendar date.' });
      }
      if (!byDay.has(date)) byDay.set(date, []);
      byDay.get(date).push(event);
    }

    const ids = [];
    for (const [date, events] of byDay.entries()) {
      await appendEvents(events[0].userId, date, events);
      ids.push(...events.map((e) => e.id));
    }

    res.status(201).json({
      accepted: normalized.length,
      ids,
      storage: getStorageMode(),
    });
  } catch (err) {
    if (getStorageMode() === 'memory' && process.env.REDIS_URL) {
      return res.status(503).json({ error: 'Redis unavailable.' });
    }
    next(err);
  }
});

router.get('/timeline/summary', requireAuth, async (req, res, next) => {
  try {
    if (rejectUserIdMismatch(res, req.user.id, req.query.userId, 'userId query param')) return;

    const userId = req.user.id;
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: 'Provide month query param as YYYY-MM.' });
    }

    const timezone = req.query.timezone || 'UTC';
    const dayResults = await loadMonthDayTotals(userId, month);

    res.json({ userId, month, timezone, days: dayResults });
  } catch (err) {
    next(err);
  }
});

router.get('/timeline', requireAuth, async (req, res, next) => {
  try {
    if (rejectUserIdMismatch(res, req.user.id, req.query.userId, 'userId query param')) return;

    const userId = req.user.id;
    const date = parseDateOnly(req.query.date) ?? todayUtcDate();
    const timezone = req.query.timezone || 'UTC';
    const events = await loadTimelineEvents(userId, date, timezone);

    if (events.length === 0) {
      if (req.query.demo === 'true') {
        const fallback = {
          ...demoTimeline,
          userId,
          date,
          timezone,
        };
        fallback.hours = padTimelineHours(fallback.hours);
        return res.json(fallback);
      }
      return res.json(emptyTimeline(userId, date, timezone));
    }

    res.json(aggregateTimeline(events, date, { userId, timezone }));
  } catch (err) {
    next(err);
  }
});

const MIN_PATCH_DURATION_SEC = 5 * 60;

function syncEventLocalMetadata(event, timeZone) {
  const localDate = parseDateOnly(event.metadata?.localDate) ?? parseDateOnly(event.timestamp);
  if (!localDate) return event;

  const startMs = Date.parse(event.timestamp);
  const durationSec = Number(event.durationSec) > 0 ? Number(event.durationSec) : 300;
  const endMs = startMs + durationSec * 1000;

  const startDay = localDateString(startMs, timeZone);
  const endDay = localDateString(endMs, timeZone);
  const metadata = { ...(event.metadata ?? {}), localDate: startDay };

  if (endDay > startDay) {
    metadata.endLocalDate = endDay;
  } else {
    delete metadata.endLocalDate;
  }

  return { ...event, metadata };
}

async function locateStoredEvent(userId, eventId, dateHint) {
  const seeds = new Set([dateHint].filter(Boolean));
  if (dateHint) {
    for (let offset = -14; offset <= 14; offset += 1) {
      seeds.add(addDaysISO(dateHint, offset));
    }
  }

  for (const date of seeds) {
    const located = await findEventOnDay(userId, date, eventId);
    if (located) return located;
  }
  return null;
}

router.patch('/events/:eventId', requireAuth, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;
    const { timestamp, durationSec, metadata, title } = req.body ?? {};

    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
      return res.status(400).json({ error: 'Provide a valid timestamp (ISO 8601).' });
    }
    if (durationSec == null || !Number.isFinite(Number(durationSec)) || Number(durationSec) < MIN_PATCH_DURATION_SEC) {
      return res.status(400).json({ error: `durationSec must be at least ${MIN_PATCH_DURATION_SEC}.` });
    }
    if (title !== undefined && typeof title !== 'string') {
      return res.status(400).json({ error: 'title must be a string.' });
    }

    const dateHint = parseDateOnly(metadata?.localDate) ?? parseDateOnly(timestamp);
    const located = await locateStoredEvent(userId, eventId, dateHint);
    if (!located) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    if (!isUserEditableEvent(located.event)) {
      return res.status(403).json({
        error: 'Tracked browser activity cannot be edited.',
        code: 'EVENT_NOT_EDITABLE',
      });
    }

    const timezone = req.query.timezone || 'UTC';
    const updated = syncEventLocalMetadata(
      {
        ...located.event,
        timestamp: new Date(Date.parse(timestamp)).toISOString(),
        durationSec: Math.round(Number(durationSec)),
        ...(title !== undefined ? { title: String(title).trim() || located.event.title } : {}),
        metadata: metadata && typeof metadata === 'object'
          ? { ...(located.event.metadata ?? {}), ...metadata }
          : located.event.metadata,
      },
      timezone,
    );

    const toSave = title !== undefined ? classifyStoredEvent(updated) : updated;

    const saved = await replaceEvent(userId, located.storageDate, eventId, toSave);
    if (!saved) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    res.json({ event: saved });
  } catch (err) {
    next(err);
  }
});

router.delete('/events/:eventId', requireAuth, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;
    const dateHint = parseDateOnly(req.query.date) ?? parseDateOnly(req.query.localDate);
    const located = await locateStoredEvent(userId, eventId, dateHint);
    if (!located) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    if (!isUserEditableEvent(located.event)) {
      return res.status(403).json({
        error: 'Tracked browser activity cannot be deleted.',
        code: 'EVENT_NOT_EDITABLE',
      });
    }

    const deleted = await deleteStoredEvent(userId, eventId, dateHint ?? located.storageDate);
    if (!deleted) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    res.json({ deleted: true, eventId });
  } catch (err) {
    next(err);
  }
});

router.get('/events', requireAuth, async (req, res, next) => {
  try {
    if (rejectUserIdMismatch(res, req.user.id, req.query.userId, 'userId query param')) return;

    const userId = req.user.id;
    const date = parseDateOnly(req.query.date) ?? todayUtcDate();
    const events = await loadEvents(userId, date);
    res.json({ userId, date, count: events.length, events });
  } catch (err) {
    next(err);
  }
});

router.post('/events/seed', requireAuth, async (req, res, next) => {
  try {
    const bodyUserId = req.body?.userId;
    const queryUserId = req.query.userId;
    if (bodyUserId && bodyUserId !== req.user.id) {
      return res.status(403).json({ error: 'userId in body does not match authenticated user.' });
    }
    if (queryUserId && queryUserId !== req.user.id) {
      return res.status(403).json({ error: 'userId query param does not match authenticated user.' });
    }

    const userId = req.user.id;
    const date = resolveDate(req);
    const replace = req.body?.replace !== false;

    if (replace) await clearEvents(userId, date);
    const events = sampleActivityEvents(userId, date);
    await appendEvents(userId, date, events);

    res.status(201).json({
      accepted: events.length,
      ids: events.map((e) => e.id),
      date,
      userId,
      storage: getStorageMode(),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/events', requireAuth, async (req, res, next) => {
  try {
    if (rejectUserIdMismatch(res, req.user.id, req.query.userId, 'userId query param')) return;

    const userId = req.user.id;
    const date = parseDateOnly(req.query.date) ?? todayUtcDate();
    const before = await countEvents(userId, date);
    await clearEvents(userId, date);
    res.json({ cleared: before, userId, date });
  } catch (err) {
    next(err);
  }
});

export default router;
