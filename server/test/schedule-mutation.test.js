import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMutationTranscript,
  parseMutationTranscript,
  applyScheduleMutation,
} from '../src/services/scheduleMutationService.js';
import { appendEvents, loadEvents } from '../src/services/activityStore.js';
import { resetMemoryStore } from '../src/services/redisClient.js';

const REF = new Date('2026-06-20T12:00:00.000Z');
const VIEW = '2026-06-20';
const USER = 'user-demo-1';

describe('scheduleMutationService', () => {
  it('detects mutation utterances vs new activity logs', () => {
    assert.equal(isMutationTranscript('Push my meeting back by an hour'), true);
    assert.equal(isMutationTranscript('Move my meeting to tomorrow'), true);
    assert.equal(isMutationTranscript('Shorten my meeting by an hour'), true);
    assert.equal(isMutationTranscript('From 9 to 10 AM I worked on the dashboard'), false);
    assert.equal(isMutationTranscript('I slept from 11 pm to 6 am'), false);
  });

  it('parses push back by an hour', () => {
    const m = parseMutationTranscript('Push my meeting back by an hour', REF);
    assert.equal(m?.action, 'shift_start');
    assert.equal(m?.deltaMin, 60);
    assert.equal(m?.direction, 1);
    assert.match(m?.targetActivity ?? '', /meeting/i);
  });

  it('parses move to tomorrow', () => {
    const m = parseMutationTranscript('Move my meeting to tomorrow', REF);
    assert.equal(m?.action, 'move_date');
    assert.equal(m?.newDate, '2026-06-21');
  });

  it('parses move to next Friday', () => {
    const m = parseMutationTranscript('Move my meeting to next Friday', REF);
    assert.equal(m?.action, 'move_date');
    assert.equal(m?.newDate, '2026-06-26');
  });

  it('parses shorten by an hour', () => {
    const m = parseMutationTranscript('Shorten my meeting by an hour', REF);
    assert.equal(m?.action, 'resize');
    assert.equal(m?.deltaMin, 60);
    assert.equal(m?.direction, -1);
  });

  it('applies push back to a stored voice event', async () => {
    resetMemoryStore();
    await appendEvents(USER, VIEW, [{
      id: 'evt_meeting',
      userId: USER,
      timestamp: `${VIEW}T15:00:00.000Z`,
      type: 'voice',
      title: 'meeting',
      durationSec: 3600,
      metadata: { localDate: VIEW, category: 'communication' },
    }]);

    const result = await applyScheduleMutation({
      userId: USER,
      transcript: 'Push my meeting back by an hour',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });

    assert.equal(result.applied, true);
    assert.equal(result.operation?.action, 'shift_start');

    const events = await loadEvents(USER, VIEW);
    assert.equal(events.length, 1);
    assert.equal(events[0].timestamp, `${VIEW}T16:00:00.000Z`);
  });

  it('applies move to tomorrow preserving clock time', async () => {
    resetMemoryStore();
    await appendEvents(USER, VIEW, [{
      id: 'evt_meeting',
      userId: USER,
      timestamp: `${VIEW}T15:00:00.000Z`,
      type: 'voice',
      title: 'team meeting',
      durationSec: 3600,
      metadata: { localDate: VIEW, category: 'communication' },
    }]);

    const result = await applyScheduleMutation({
      userId: USER,
      transcript: 'Move my meeting to tomorrow',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });

    assert.equal(result.applied, true);
    assert.equal(result.operation?.action, 'move_date');

    const today = await loadEvents(USER, VIEW);
    assert.equal(today.length, 0);

    const tomorrow = await loadEvents(USER, '2026-06-21');
    assert.equal(tomorrow.length, 1);
    assert.equal(tomorrow[0].metadata.localDate, '2026-06-21');
    assert.equal(tomorrow[0].timestamp, '2026-06-21T15:00:00.000Z');
  });

  it('applies shorten by an hour', async () => {
    resetMemoryStore();
    await appendEvents(USER, VIEW, [{
      id: 'evt_meeting',
      userId: USER,
      timestamp: `${VIEW}T15:00:00.000Z`,
      type: 'voice',
      title: 'meeting',
      durationSec: 7200,
      metadata: { localDate: VIEW, category: 'communication' },
    }]);

    const result = await applyScheduleMutation({
      userId: USER,
      transcript: 'Shorten my meeting by an hour',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });

    assert.equal(result.applied, true);
    const events = await loadEvents(USER, VIEW);
    assert.equal(events[0].durationSec, 3600);
  });
});
