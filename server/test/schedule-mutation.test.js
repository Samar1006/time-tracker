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
    assert.equal(isMutationTranscript('Cancel the meeting I have today'), true);
    assert.equal(isMutationTranscript('Clear my schedule today'), true);
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

  it('parses move to explicit calendar date', () => {
    const m = parseMutationTranscript('Move my meeting to June 23rd', REF);
    assert.equal(m?.action, 'move_date');
    assert.equal(m?.newDate, '2026-06-23');
    assert.equal(m?.newStartMin, null);
  });

  it('parses move to date with start time only (duration unchanged later)', () => {
    const m = parseMutationTranscript('Move my meeting to June 23rd at 2 pm', REF);
    assert.equal(m?.action, 'move_date');
    assert.equal(m?.newDate, '2026-06-23');
    assert.equal(m?.newStartMin, 14 * 60);
    assert.equal(m?.startHadAmPm, true);
  });

  it('detects past-tense move commands', () => {
    const ctx = { lastEventId: 'evt_1', lastTargetActivity: 'meeting' };
    assert.equal(isMutationTranscript('Moved it to June 23rd at 5 pm', ctx), true);
    const m = parseMutationTranscript('Moved it to June 23rd at 5 pm', REF, ctx);
    assert.equal(m?.action, 'move_date');
    assert.equal(m?.newDate, '2026-06-23');
    assert.equal(m?.newStartMin, 17 * 60);
  });

  it('parses move to next Friday at 9 am', () => {
    const m = parseMutationTranscript('Move my meeting to next Friday at 9 am', REF);
    assert.equal(m?.newDate, '2026-06-26');
    assert.equal(m?.newStartMin, 9 * 60);
  });

  it('parses follow-up shift using voice context', () => {
    const ctx = { lastEventId: 'evt_1', lastTargetActivity: 'meeting' };
    assert.equal(isMutationTranscript('Actually push it back two hours', ctx), true);
    const m = parseMutationTranscript('Actually push it back two hours', REF, ctx);
    assert.equal(m?.action, 'shift_start');
    assert.equal(m?.deltaMin, 120);
    assert.equal(m?.targetActivity, 'meeting');
  });

  it('strips today from target activity phrase', () => {
    const m = parseMutationTranscript('Push my meeting today back an hour', REF);
    assert.equal(m?.targetActivity, 'meeting');
  });

  it('parses shorten by an hour', () => {
    const m = parseMutationTranscript('Shorten my meeting by an hour', REF);
    assert.equal(m?.action, 'resize');
    assert.equal(m?.deltaMin, 60);
    assert.equal(m?.direction, -1);
  });

  it('parses cancel meeting today', () => {
    assert.equal(isMutationTranscript('Cancel the meeting I have today'), true);
    const m = parseMutationTranscript('Cancel the meeting I have today', REF);
    assert.equal(m?.action, 'cancel');
    assert.equal(m?.targetActivity, 'meeting');
  });

  it('parses clear my schedule today', () => {
    const m = parseMutationTranscript('Clear my schedule today', REF, null, VIEW);
    assert.equal(m?.action, 'clear_schedule');
    assert.equal(m?.clearDate, VIEW);
  });

  it('cancels a matching voice event', async () => {
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
      transcript: 'Cancel the meeting I have today',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });

    assert.equal(result.applied, true);
    assert.equal(result.operation?.action, 'cancel');
    assert.equal(await loadEvents(USER, VIEW).then((e) => e.length), 0);
    assert.equal(result.voiceContext, null);
  });

  it('clears all voice events on the viewed day', async () => {
    resetMemoryStore();
    await appendEvents(USER, VIEW, [
      {
        id: 'evt_meeting',
        userId: USER,
        timestamp: `${VIEW}T15:00:00.000Z`,
        type: 'voice',
        title: 'meeting',
        durationSec: 3600,
        metadata: { localDate: VIEW },
      },
      {
        id: 'evt_lunch',
        userId: USER,
        timestamp: `${VIEW}T12:00:00.000Z`,
        type: 'voice',
        title: 'lunch',
        durationSec: 3600,
        metadata: { localDate: VIEW },
      },
    ]);

    const result = await applyScheduleMutation({
      userId: USER,
      transcript: 'Clear my schedule today',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });

    assert.equal(result.applied, true);
    assert.equal(result.operation?.action, 'clear_schedule');
    assert.equal(result.operation?.deletedCount, 2);
    assert.equal(await loadEvents(USER, VIEW).then((e) => e.length), 0);
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

  it('applies move to next Friday and returns navigation date', async () => {
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
      transcript: 'Move my meeting to next Friday',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });

    assert.equal(result.applied, true);
    assert.equal(result.navigateToDate, '2026-06-26');
    assert.equal(result.voiceContext?.lastTargetActivity, 'meeting');

    const friday = await loadEvents(USER, '2026-06-26');
    assert.equal(friday.length, 1);
    assert.equal(friday[0].metadata.localDate, '2026-06-26');

    const today = await loadEvents(USER, VIEW);
    assert.equal(today.length, 0);
  });

  it('move to new date with start time keeps duration', async () => {
    resetMemoryStore();
    await appendEvents(USER, VIEW, [{
      id: 'evt_meeting',
      userId: USER,
      timestamp: `${VIEW}T15:00:00.000Z`,
      type: 'voice',
      title: 'meeting',
      durationSec: 5400,
      metadata: { localDate: VIEW, category: 'communication' },
    }]);

    const result = await applyScheduleMutation({
      userId: USER,
      transcript: 'Move my meeting to June 23rd at 2 pm',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });

    assert.equal(result.applied, true);
    assert.equal(await loadEvents(USER, VIEW).then((e) => e.length), 0);

    const moved = await loadEvents(USER, '2026-06-23');
    assert.equal(moved.length, 1);
    assert.equal(moved[0].timestamp, '2026-06-23T14:00:00.000Z');
    assert.equal(moved[0].durationSec, 5400);
  });

  it('removes stale duplicate copies when moving across days', async () => {
    resetMemoryStore();
    const event = {
      id: 'evt_meeting',
      userId: USER,
      timestamp: `${VIEW}T15:00:00.000Z`,
      type: 'voice',
      title: 'meeting',
      durationSec: 3600,
      metadata: { localDate: VIEW, category: 'communication' },
    };
    await appendEvents(USER, VIEW, [event]);
    await appendEvents(USER, '2026-06-26', [{ ...event, metadata: { ...event.metadata, localDate: '2026-06-26' } }]);

    const result = await applyScheduleMutation({
      userId: USER,
      transcript: 'Move my meeting to next Friday',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });

    assert.equal(result.applied, true);
    assert.equal(await loadEvents(USER, VIEW).then((e) => e.length), 0);
    assert.equal(await loadEvents(USER, '2026-06-26').then((e) => e.length), 1);
  });

  it('moves across days via past tense and keeps one-hour duration at inferred pm time', async () => {
    resetMemoryStore();
    await appendEvents(USER, VIEW, [{
      id: 'evt_meeting',
      userId: USER,
      timestamp: `${VIEW}T22:00:00.000Z`,
      type: 'voice',
      title: 'meeting',
      durationSec: 3600,
      metadata: { localDate: VIEW, category: 'communication' },
    }]);

    const first = await applyScheduleMutation({
      userId: USER,
      transcript: 'Move my meeting to tomorrow',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });
    assert.equal(first.applied, true);
    assert.equal(await loadEvents(USER, VIEW).then((e) => e.length), 0);
    assert.equal(await loadEvents(USER, '2026-06-21').then((e) => e.length), 1);

    const second = await applyScheduleMutation({
      userId: USER,
      transcript: 'Moved it to June 23rd at 5',
      referenceDate: REF,
      viewDate: '2026-06-21',
      timeZone: 'UTC',
      voiceContext: first.voiceContext,
    });

    assert.equal(second.applied, true);
    assert.equal(await loadEvents(USER, '2026-06-21').then((e) => e.length), 0);
    const moved = await loadEvents(USER, '2026-06-23');
    assert.equal(moved.length, 1);
    assert.equal(moved[0].durationSec, 3600);
    assert.equal(moved[0].timestamp, '2026-06-23T17:00:00.000Z');
  });

  it('follow-up command reuses last event from voice context', async () => {
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

    const first = await applyScheduleMutation({
      userId: USER,
      transcript: 'Push my meeting back by an hour',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
    });
    assert.equal(first.applied, true);

    const second = await applyScheduleMutation({
      userId: USER,
      transcript: 'Actually push it back two hours',
      referenceDate: REF,
      viewDate: VIEW,
      timeZone: 'UTC',
      voiceContext: first.voiceContext,
    });

    assert.equal(second.applied, true);
    const events = await loadEvents(USER, VIEW);
    assert.equal(events[0].timestamp, `${VIEW}T18:00:00.000Z`);
  });
});
