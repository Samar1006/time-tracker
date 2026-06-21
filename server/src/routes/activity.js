// activity.js — contract endpoints: POST /api/events, GET /api/timeline

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import {
  appendEvents,
  clearEvents,
  countEvents,
  loadEvents,
} from '../services/activityStore.js';
import {
  aggregateTimeline,
  parseDateOnly,
  todayUtcDate,
} from '../services/aggregationService.js';
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

router.get('/timeline/health', (_req, res) => {
  res.json({ ok: true, storage: getStorageMode() });
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

router.get('/timeline/summary', requireAuth, async (req, res, next) => {
  try {
    if (rejectUserIdMismatch(res, req.user.id, req.query.userId, 'userId query param')) return;

    const userId = req.user.id;
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: 'Provide month query param as YYYY-MM.' });
    }

    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const days = [];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const events = await loadEvents(userId, date);
      const totalTrackedSec = events.length === 0
        ? 0
        : aggregateTimeline(events, date, { userId }).totalTrackedSec;
      days.push({ date, totalTrackedSec });
    }

    res.json({ userId, month, days });
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
