import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from '../src/routes/schedule.js';
import { scheduleBlocksToEvents } from '../src/utils/voiceBlockConversion.js';

const REF = new Date('2026-06-20T12:00:00.000Z');
const FALLBACK = '2026-06-20';

describe('voiceBlockConversion', () => {
  it('keeps same-day blocks as a single event', () => {
    const events = scheduleBlocksToEvents(
      [{
        date: '2026-06-20',
        start: '9:00 AM',
        end: '10:00 AM',
        durationMin: 60,
        activity: 'coding',
        category: 'work',
      }],
      FALLBACK,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].metadata.localDate, '2026-06-20');
    assert.equal(events[0].durationSec, 3600);
  });

  it('stores overnight sleep as one event with full duration', () => {
    const { blocks } = parseTranscript('sleep from 8 pm to 7 am the next day', {
      referenceDate: REF,
    });
    assert.equal(blocks.length, 1);

    const events = scheduleBlocksToEvents(blocks, FALLBACK);
    assert.equal(events.length, 1);
    assert.equal(events[0].metadata.localDate, '2026-06-20');
    assert.equal(events[0].metadata.endLocalDate, '2026-06-21');
    assert.equal(events[0].durationSec, 11 * 3600);
  });

  it('stores 8 pm to 6 am as one spanning event', () => {
    const { blocks } = parseTranscript('from 8 pm to 6 am sleeping', { referenceDate: REF });
    const events = scheduleBlocksToEvents(blocks, FALLBACK);
    assert.equal(events.length, 1);
    assert.equal(events[0].durationSec, 10 * 3600);
  });

  it('places explicit calendar-date meetings on the spoken day', () => {
    const { blocks } = parseTranscript('on June 23rd I have a meeting from 1 pm to 2 pm', {
      referenceDate: REF,
    });
    const events = scheduleBlocksToEvents(blocks, FALLBACK);
    assert.equal(events.length, 1);
    assert.equal(events[0].metadata.localDate, '2026-06-23');
    assert.equal(events[0].durationSec, 3600);
  });

  it('stores 11 pm to 6 am next-day sleep as one event', () => {
    const { blocks } = parseTranscript(
      "I'm going to sleep from 11 pm to 6 am the next day",
      { referenceDate: REF },
    );
    const events = scheduleBlocksToEvents(blocks, FALLBACK);
    assert.equal(events.length, 1);
    assert.equal(events[0].metadata.localDate, '2026-06-20');
    assert.equal(events[0].metadata.endLocalDate, '2026-06-21');
    assert.equal(events[0].durationSec, 7 * 3600);
  });

  it('corrects misheard 5 pm to 5 am for overnight sleep', () => {
    const { blocks } = parseTranscript(
      'im sleeping from 11 pm to 5 pm the next day',
      { referenceDate: REF },
    );
    assert.equal(blocks[0].end, '5:00 AM');
    assert.equal(blocks[0].durationMin, 360);

    const events = scheduleBlocksToEvents(blocks, FALLBACK);
    assert.equal(events.length, 1);
    assert.equal(events[0].durationSec, 6 * 3600);
  });
});
