import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateTimeline,
  eventInterval,
  splitEventAcrossHours,
} from '../src/services/aggregationService.js';
import { sampleActivityEvents } from '../src/data/sampleActivityEvents.js';

const DATE = '2026-06-20';
const USER = 'user-demo-1';

describe('aggregationService', () => {
  it('computes event interval from durationSec', () => {
    const event = sampleActivityEvents(USER, DATE)[0];
    const { durationSec } = eventInterval(event);
    assert.equal(durationSec, 4500);
  });

  it('splits an event that spans two hours', () => {
    const event = {
      id: 'span',
      userId: USER,
      timestamp: `${DATE}T09:45:00.000Z`,
      type: 'app_focus',
      app: 'Test App',
      durationSec: 2700,
    };

    const slices = splitEventAcrossHours(event, DATE);
    assert.equal(slices.length, 2);
    assert.equal(slices[0].hour, 9);
    assert.equal(slices[0].durationSec, 900);
    assert.equal(slices[1].hour, 10);
    assert.equal(slices[1].durationSec, 1800);
  });

  it('aggregates sample events into contract timeline shape', () => {
    const events = sampleActivityEvents(USER, DATE);
    const result = aggregateTimeline(events, DATE, { userId: USER });

    assert.equal(result.userId, USER);
    assert.equal(result.date, DATE);
    assert.equal(result.hours.length, 24);

    const hour9 = result.hours[9];
    assert.equal(hour9.totalTrackedSec, 3600);
    assert.equal(hour9.blocks[0].activity, 'Visual Studio Code');
    assert.equal(hour9.blocks[0].source, 'tracked');

    const hour14 = result.hours[14];
    assert.ok(hour14.totalTrackedSec >= 3600);
    assert.equal(hour14.blocks[0].activity, 'Xcode');

    assert.ok(result.totalTrackedSec > 10000);
  });

  it('coalesces adjacent browser extension events into one continuous block', () => {
    const events = [
      {
        id: 'ext-1',
        userId: USER,
        timestamp: `${DATE}T10:00:00.000Z`,
        type: 'domain_visit',
        app: 'Chrome',
        domain: 'github.com',
        durationSec: 60,
      },
      {
        id: 'ext-2',
        userId: USER,
        timestamp: `${DATE}T10:01:00.000Z`,
        type: 'domain_visit',
        app: 'Chrome',
        domain: 'github.com',
        durationSec: 60,
      },
      {
        id: 'ext-3',
        userId: USER,
        timestamp: `${DATE}T10:02:00.000Z`,
        type: 'domain_visit',
        app: 'Chrome',
        domain: 'github.com',
        durationSec: 60,
      },
    ];

    const hour10 = aggregateTimeline(events, DATE, { userId: USER }).hours[10];
    assert.equal(hour10.blocks.length, 1);
    assert.equal(hour10.blocks[0].activity, 'github.com');
    assert.equal(hour10.blocks[0].durationSec, 180);
    assert.equal(hour10.blocks[0].start, `${DATE}T10:00:00.000Z`);
    assert.equal(hour10.blocks[0].end, `${DATE}T10:03:00.000Z`);
  });

  it('coalesces extension events with a short gap or overlap', () => {
    const events = [
      {
        id: 'ext-a',
        userId: USER,
        timestamp: `${DATE}T10:05:17.196Z`,
        type: 'domain_visit',
        app: 'Chrome',
        domain: 'localhost',
        durationSec: 20,
      },
      {
        id: 'ext-b',
        userId: USER,
        timestamp: `${DATE}T10:05:38.398Z`,
        type: 'domain_visit',
        app: 'Chrome',
        domain: 'localhost',
        durationSec: 16,
      },
      {
        id: 'ext-c',
        userId: USER,
        timestamp: `${DATE}T10:05:54.248Z`,
        type: 'domain_visit',
        app: 'Chrome',
        domain: 'localhost',
        durationSec: 7,
      },
    ];

    const hour10 = aggregateTimeline(events, DATE, { userId: USER, timezone: 'UTC' }).hours[10];
    assert.equal(hour10.blocks.length, 1);
    assert.equal(hour10.blocks[0].activity, 'localhost');
    assert.equal(hour10.blocks[0].durationSec, 44);
  });

  it('keeps distinct stored events separate even when activity matches', () => {
    const events = [
      {
        id: 'a',
        userId: USER,
        timestamp: `${DATE}T11:00:00.000Z`,
        type: 'app_focus',
        app: 'Slack',
        durationSec: 1200,
      },
      {
        id: 'b',
        userId: USER,
        timestamp: `${DATE}T11:25:00.000Z`,
        type: 'app_focus',
        app: 'Slack',
        durationSec: 900,
      },
    ];

    const hour11 = aggregateTimeline(events, DATE, { userId: USER }).hours[11];
    assert.equal(hour11.blocks.length, 2);
    assert.equal(hour11.blocks[0].eventId, 'a');
    assert.equal(hour11.blocks[1].eventId, 'b');
  });

  it('includes full event span metadata on overnight blocks', () => {
    const events = [{
      id: 'sleep',
      userId: USER,
      timestamp: `${DATE}T23:00:00.000Z`,
      type: 'voice',
      title: 'sleeping',
      durationSec: 7 * 3600,
      metadata: { localDate: DATE, endLocalDate: '2026-06-21' },
    }];

    const startDay = aggregateTimeline(events, DATE, { userId: USER, timezone: 'UTC' });
    const nightBlock = startDay.hours[23].blocks.find((b) => b.activity === 'sleeping');
    assert.ok(nightBlock);
    assert.equal(nightBlock.spansNextDay, true);
    assert.equal(nightBlock.spansFromPrevDay, false);
    assert.equal(nightBlock.eventEnd, '2026-06-21T06:00:00.000Z');

    const nextDay = aggregateTimeline(events, '2026-06-21', { userId: USER, timezone: 'UTC' });
    const morningBlock = nextDay.hours[5].blocks.find((b) => b.activity === 'sleeping');
    assert.ok(morningBlock);
    assert.equal(morningBlock.spansFromPrevDay, true);
    assert.equal(morningBlock.spansNextDay, false);
    assert.equal(morningBlock.eventStart, `${DATE}T23:00:00.000Z`);
  });
});
