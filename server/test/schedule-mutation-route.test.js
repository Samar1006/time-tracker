import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { request, startTestServer, stopTestServer, loginDemo, bearer } from './helpers/http.js';
import { resetMemoryStore } from '../src/services/redisClient.js';

const DATE = '2026-06-20';
const USER = 'user-demo-1';

describe('schedule mutate route', () => {
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

  it('POST /api/schedule/mutate requires auth', async () => {
    const res = await request('/api/schedule/mutate', {
      method: 'POST',
      body: { transcript: 'Push my meeting back by an hour', viewDate: DATE },
    });
    assert.equal(res.status, 401);
  });

  it('returns 422 for non-mutation transcripts', async () => {
    const res = await request('/api/schedule/mutate', {
      method: 'POST',
      headers: bearer(token),
      body: {
        transcript: 'From 9 to 10 AM coding',
        referenceDate: `${DATE}T12:00:00.000Z`,
        viewDate: DATE,
        timezone: 'UTC',
      },
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.intent, 'create');
  });

  it('pushes a voice event back via API', async () => {
    await request('/api/events', {
      method: 'POST',
      headers: bearer(token),
      body: {
        events: [{
          id: 'evt_voice_meeting',
          timestamp: `${DATE}T14:00:00.000Z`,
          type: 'voice',
          title: 'meeting',
          durationSec: 3600,
          metadata: { localDate: DATE, category: 'communication' },
        }],
      },
    });

    const mutate = await request('/api/schedule/mutate', {
      method: 'POST',
      headers: bearer(token),
      body: {
        transcript: 'Push my meeting back by an hour',
        referenceDate: `${DATE}T12:00:00.000Z`,
        viewDate: DATE,
        timezone: 'UTC',
      },
    });

    assert.equal(mutate.status, 200);
    assert.equal(mutate.body.applied, true);

    const timeline = await request(`/api/timeline?date=${DATE}&timezone=UTC`, {
      headers: bearer(token),
    });
    const hour15 = timeline.body.hours[15].blocks.some((b) => b.activity === 'meeting');
    assert.equal(hour15, true);
  });
});
