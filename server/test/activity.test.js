import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { request, startTestServer, stopTestServer } from './helpers/http.js';
import { resetMemoryStore } from '../src/services/redisClient.js';

const DATE = '2026-06-20';
const USER = 'user-demo-1';

describe('activity routes (API contract)', () => {
  before(async () => {
    await startTestServer();
  });

  after(async () => {
    await stopTestServer();
  });

  beforeEach(() => {
    resetMemoryStore();
  });

  it('GET /health returns ok', async () => {
    const res = await request('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('GET /api/timeline returns demo fallback when empty', async () => {
    const res = await request(`/api/timeline?userId=${USER}&date=${DATE}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.userId, USER);
    assert.ok(Array.isArray(res.body.hours));
    assert.equal(res.body.hours[9].blocks[0].source, 'demo');
  });

  it('POST /api/events/seed then GET /api/timeline', async () => {
    const seed = await request('/api/events/seed', {
      method: 'POST',
      body: { userId: USER, date: DATE },
    });
    assert.equal(seed.status, 201);
    assert.equal(seed.body.accepted, 8);

    const timeline = await request(`/api/timeline?userId=${USER}&date=${DATE}`);
    assert.equal(timeline.status, 200);
    assert.equal(timeline.body.date, DATE);
    assert.ok(timeline.body.totalTrackedSec > 0);
    assert.equal(timeline.body.hours[9].blocks[0].source, 'tracked');
  });

  it('POST /api/events validates contract fields', async () => {
    const bad = await request('/api/events', {
      method: 'POST',
      body: { events: [{ type: 'manual' }] },
    });
    assert.equal(bad.status, 400);

    const good = await request('/api/events', {
      method: 'POST',
      body: {
        userId: USER,
        timestamp: `${DATE}T08:00:00.000Z`,
        type: 'app_focus',
        app: 'Messages',
        durationSec: 1800,
      },
    });
    assert.equal(good.status, 201);
    assert.equal(good.body.accepted, 1);
    assert.equal(good.body.ids.length, 1);

    const raw = await request(`/api/events?userId=${USER}&date=${DATE}`);
    assert.equal(raw.status, 200);
    assert.equal(raw.body.count, 1);
  });

  it('DELETE /api/events clears a day', async () => {
    await request('/api/events/seed', {
      method: 'POST',
      body: { userId: USER, date: DATE },
    });
    const cleared = await request(`/api/events?userId=${USER}&date=${DATE}`, {
      method: 'DELETE',
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.cleared, 8);

    const timeline = await request(`/api/timeline?userId=${USER}&date=${DATE}`);
    assert.equal(timeline.body.hours[9].blocks[0].source, 'demo');
  });
});
