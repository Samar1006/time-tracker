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

  it('merges duplicate activities within the same hour', () => {
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
    assert.equal(hour11.blocks.length, 1);
    assert.equal(hour11.blocks[0].durationSec, 2100);
  });
});
