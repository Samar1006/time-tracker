// activity.js — contract endpoints: POST /api/events, GET /api/timeline

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import {
  appendEvents,
  clearEvents,
  countEvents,
  DEFAULT_USER_ID,
  loadEvents,
} from '../services/activityStore.js';
import {
  aggregateTimeline,
  parseDateOnly,
  todayUtcDate,
} from '../services/aggregationService.js';
import { getStorageMode } from '../services/redisClient.js';
import { sampleActivityEvents } from '../data/sampleActivityEvents.js';

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

function resolveUserId(req) {
  return req.query.userId || req.body?.userId || DEFAULT_USER_ID;
}

function resolveDate(req) {
  return parseDateOnly(req.query.date || req.body?.date) ?? todayUtcDate();
}

function normalizeEvent(raw, index) {
  const userId = raw.userId;
  const timestamp = raw.timestamp;
  const type = raw.type;

  if (!userId) return { error: `events[${index}] missing userId.` };
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
  if (body?.userId && body?.timestamp && body?.type) return [body];
  return null;
}

router.get('/timeline/health', (_req, res) => {
  res.json({ ok: true, storage: getStorageMode() });
});

router.post('/events', async (req, res, next) => {
  try {
    const incoming = collectEvents(req.body);
    if (!incoming || incoming.length === 0) {
      return res.status(400).json({ error: 'Provide a raw event or { events: [...] }.' });
    }

    const normalized = [];
    for (let i = 0; i < incoming.length; i += 1) {
      const result = normalizeEvent(incoming[i], i);
      if (result.error) return res.status(400).json({ error: result.error });
      normalized.push(result);
    }

    const byDay = new Map();
    for (const event of normalized) {
      const date = parseDateOnly(event.timestamp);
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

router.get('/timeline', async (req, res, next) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'Provide userId query param.' });
    }

    const date = parseDateOnly(req.query.date) ?? todayUtcDate();
    const timezone = req.query.timezone || 'UTC';
    const events = await loadEvents(userId, date);

    if (events.length === 0) {
      const fallback = {
        ...demoTimeline,
        userId,
        date,
        timezone,
      };
      fallback.hours = padTimelineHours(fallback.hours);
      return res.json(fallback);
    }

    res.json(aggregateTimeline(events, date, { userId, timezone }));
  } catch (err) {
    next(err);
  }
});

router.get('/events', async (req, res, next) => {
  try {
    const userId = req.query.userId;
    const date = parseDateOnly(req.query.date) ?? todayUtcDate();
    if (!userId) {
      return res.status(400).json({ error: 'Provide userId query param.' });
    }

    const events = await loadEvents(userId, date);
    res.json({ userId, date, count: events.length, events });
  } catch (err) {
    next(err);
  }
});

router.post('/events/seed', async (req, res, next) => {
  try {
    const userId = resolveUserId(req);
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

router.delete('/events', async (req, res, next) => {
  try {
    const userId = req.query.userId;
    const date = parseDateOnly(req.query.date) ?? todayUtcDate();
    if (!userId) {
      return res.status(400).json({ error: 'Provide userId query param.' });
    }

    const before = await countEvents(userId, date);
    await clearEvents(userId, date);
    res.json({ cleared: before, userId, date });
  } catch (err) {
    next(err);
  }
});

export default router;
