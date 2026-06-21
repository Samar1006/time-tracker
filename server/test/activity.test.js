import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { request, startTestServer, stopTestServer, loginDemo, bearer } from './helpers/http.js';
import { resetMemoryStore } from '../src/services/redisClient.js';

const DATE = '2026-06-20';
const USER = 'user-demo-1';

describe('activity routes (API contract)', () => {
  let token;

  before(async () => {
    await startTestServer();
  });

  after(async () => {
    await stopTestServer();
  });

  beforeEach(async () => {
    resetMemoryStore();
    token = await loginDemo();
  });

  it('GET /health returns ok', async () => {
    const res = await request('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('GET /api/timeline without token returns 401', async () => {
    const res = await request(`/api/timeline?userId=${USER}&date=${DATE}`);
    assert.equal(res.status, 401);
  });

  it('GET /api/monitor/status returns event count for a day', async () => {
    await request('/api/events', {
      method: 'POST',
      headers: bearer(token),
      body: {
        timestamp: `${DATE}T21:30:00.000Z`,
        type: 'domain_visit',
        app: 'Chrome',
        domain: 'youtube.com',
        durationSec: 120,
        metadata: { localDate: DATE },
      },
    });

    const status = await request(`/api/monitor/status?userId=${USER}&date=${DATE}`, {
      headers: bearer(token),
    });
    assert.equal(status.status, 200);
    assert.equal(status.body.eventCount, 1);
    assert.equal(status.body.lastDomain, 'youtube.com');
  });

  it('GET /api/timeline returns empty timeline when no events', async () => {
    const res = await request(`/api/timeline?userId=${USER}&date=${DATE}`, {
      headers: bearer(token),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.userId, USER);
    assert.equal(res.body.totalTrackedSec, 0);
    assert.ok(Array.isArray(res.body.hours));
    assert.equal(res.body.hours.length, 24);
    assert.equal(res.body.hours[9].blocks.length, 0);
  });

  it('POST /api/events without token returns 401', async () => {
    const res = await request('/api/events', {
      method: 'POST',
      body: {
        timestamp: `${DATE}T08:00:00.000Z`,
        type: 'app_focus',
      },
    });
    assert.equal(res.status, 401);
  });

  it('POST /api/events with mismatched body userId returns 403', async () => {
    const res = await request('/api/events', {
      method: 'POST',
      headers: bearer(token),
      body: {
        userId: 'other-user',
        timestamp: `${DATE}T08:00:00.000Z`,
        type: 'app_focus',
      },
    });
    assert.equal(res.status, 403);
  });

  it('GET /api/timeline returns demo fallback when empty', async () => {
    const res = await request(`/api/timeline?userId=${USER}&date=${DATE}`, {
      headers: bearer(token),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.userId, USER);
    assert.equal(res.body.totalTrackedSec, 0);
    assert.ok(Array.isArray(res.body.hours));
    assert.equal(res.body.hours.length, 24);
    assert.equal(res.body.hours[9].blocks.length, 0);
  });

  it('GET /api/timeline?demo=true returns demo fallback when empty', async () => {
    const res = await request(`/api/timeline?userId=${USER}&date=${DATE}&demo=true`, {
      headers: bearer(token),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.hours[9].blocks[0].source, 'demo');
  });

  it('POST /api/events/seed then GET /api/timeline', async () => {
    const seed = await request('/api/events/seed', {
      method: 'POST',
      headers: bearer(token),
      body: { userId: USER, date: DATE },
    });
    assert.equal(seed.status, 201);
    assert.equal(seed.body.accepted, 8);

    const timeline = await request(`/api/timeline?userId=${USER}&date=${DATE}`, {
      headers: bearer(token),
    });
    assert.equal(timeline.status, 200);
    assert.equal(timeline.body.date, DATE);
    assert.ok(timeline.body.totalTrackedSec > 0);
    assert.equal(timeline.body.hours[9].blocks[0].source, 'tracked');
  });

  it('GET /api/timeline/summary returns per-day totals for seeded month', async () => {
    await request('/api/events/seed', {
      method: 'POST',
      headers: bearer(token),
      body: { userId: USER, date: DATE },
    });

    const summary = await request(`/api/timeline/summary?userId=${USER}&month=2026-06`, {
      headers: bearer(token),
    });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.month, '2026-06');
    assert.equal(summary.body.days.length, 30);
    const day20 = summary.body.days.find((d) => d.date === DATE);
    assert.ok(day20.totalTrackedSec > 0);
  });

  it('POST /api/events validates contract fields', async () => {
    const bad = await request('/api/events', {
      method: 'POST',
      headers: bearer(token),
      body: { events: [{ type: 'manual' }] },
    });
    assert.equal(bad.status, 400);

    const good = await request('/api/events', {
      method: 'POST',
      headers: bearer(token),
      body: {
        timestamp: `${DATE}T08:00:00.000Z`,
        type: 'app_focus',
        app: 'Messages',
        durationSec: 1800,
      },
    });
    assert.equal(good.status, 201);
    assert.equal(good.body.accepted, 1);
    assert.equal(good.body.ids.length, 1);

    const raw = await request(`/api/events?userId=${USER}&date=${DATE}`, {
      headers: bearer(token),
    });
    assert.equal(raw.status, 200);
    assert.equal(raw.body.count, 1);
  });

  it('authenticated ingest stores events under JWT user and timeline shows tracked', async () => {
    const ingest = await request('/api/events', {
      method: 'POST',
      headers: bearer(token),
      body: {
        timestamp: `${DATE}T10:00:00.000Z`,
        type: 'app_focus',
        app: 'Cursor',
        durationSec: 3600,
      },
    });
    assert.equal(ingest.status, 201);

    const timeline = await request(`/api/timeline?date=${DATE}`, {
      headers: bearer(token),
    });
    assert.equal(timeline.status, 200);
    assert.equal(timeline.body.userId, USER);
    assert.equal(timeline.body.hours[10].blocks[0].source, 'tracked');
  });

  it('DELETE /api/events clears a day', async () => {
    await request('/api/events/seed', {
      method: 'POST',
      headers: bearer(token),
      body: { userId: USER, date: DATE },
    });
    const cleared = await request(`/api/events?userId=${USER}&date=${DATE}`, {
      method: 'DELETE',
      headers: bearer(token),
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.cleared, 8);

    const timeline = await request(`/api/timeline?userId=${USER}&date=${DATE}`, {
      headers: bearer(token),
    });
    assert.equal(timeline.body.totalTrackedSec, 0);
    assert.equal(timeline.body.hours[9].blocks.length, 0);
  });
});
