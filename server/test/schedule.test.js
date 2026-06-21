import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from '../src/routes/schedule.js';
import { sampleTranscripts } from '../src/data/sampleTranscripts.js';

test('parses a time range into a block with start/end', () => {
  const { blocks } = parseTranscript('From 9 to 10:30 I worked on the dashboard.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, '9:00 AM');
  assert.equal(blocks[0].end, '10:30 AM');
  assert.equal(blocks[0].durationMin, 90);
  assert.equal(blocks[0].category, 'work');
  assert.match(blocks[0].activity, /dashboard/i);
});

test('derives end time from a spoken duration', () => {
  const { blocks } = parseTranscript('At 9 I spent two hours debugging the api.');
  assert.equal(blocks[0].start, '9:00 AM');
  assert.equal(blocks[0].end, '11:00 AM');
  assert.equal(blocks[0].durationMin, 120);
});

test('handles am/pm and noon context', () => {
  const { blocks } = parseTranscript('After lunch around 1pm I answered emails for 30 minutes.');
  assert.equal(blocks[0].start, '1:00 PM');
  assert.equal(blocks[0].end, '1:30 PM');
  assert.equal(blocks[0].category, 'communication');
  assert.match(blocks[0].activity, /email/i);
});

test('labels future-tense activities and uses shared am/pm on ranges', () => {
  const { blocks } = parseTranscript('From 2 to 3 am i will be running');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, '2:00 AM');
  assert.equal(blocks[0].end, '3:00 AM');
  assert.equal(blocks[0].durationMin, 60);
  assert.equal(blocks[0].activity, 'running');
  assert.equal(blocks[0].category, 'break');
});

test('derives end from start plus spoken duration with am/pm', () => {
  const { blocks } = parseTranscript('at 6 am I will work out for 3 hours');
  assert.equal(blocks[0].start, '6:00 AM');
  assert.equal(blocks[0].end, '9:00 AM');
  assert.equal(blocks[0].durationMin, 180);
  assert.match(blocks[0].activity, /work out/i);
});

test('parses "until" as end time and chains from previous block', () => {
  const { blocks } = parseTranscript(sampleTranscripts[3].text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].end, '10:30 AM');
  assert.equal(blocks[1].start, '10:30 AM');
  assert.equal(blocks[1].end, '11:00 AM');
  assert.equal(blocks[1].category, 'communication');
  assert.match(blocks[1].activity, /standup/i);
});

test('infers times for duration-only segments from prior end', () => {
  const { blocks } = parseTranscript(sampleTranscripts[4].text);
  assert.equal(blocks[0].start, null);
  assert.equal(blocks[0].end, null);
  assert.equal(blocks[0].durationMin, 120);
  assert.match(blocks[0].activity, /debugging/i);
  assert.equal(blocks[1].start, null);
  assert.equal(blocks[1].end, null);
  assert.equal(blocks[1].durationMin, 30);
});

test('after lunch without clock time gets implicit start and duration', () => {
  const { blocks } = parseTranscript(sampleTranscripts[5].text);
  assert.equal(blocks[0].start, '1:00 PM');
  assert.equal(blocks[0].end, '1:30 PM');
  assert.equal(blocks[0].durationMin, 30);
  assert.match(blocks[0].activity, /email/i);
});

test('multi-clause morning transcript chains standup and lunch blocks', () => {
  const { blocks } = parseTranscript(sampleTranscripts[6].text);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].start, '9:00 AM');
  assert.equal(blocks[0].end, '10:00 AM');
  assert.equal(blocks[1].start, '10:00 AM');
  assert.equal(blocks[1].end, '11:00 AM');
  assert.equal(blocks[1].category, 'communication');
  assert.equal(blocks[2].start, '1:00 PM');
  assert.equal(blocks[2].end, '1:30 PM');
});

test('full sample workday yields multiple labeled blocks', () => {
  const { blocks } = parseTranscript(sampleTranscripts[0].text);
  assert.ok(blocks.length >= 4, `expected >=4 blocks, got ${blocks.length}`);
  const cats = new Set(blocks.map((b) => b.category));
  assert.ok(cats.has('work'));
  assert.ok(cats.has('communication'));
  assert.ok(cats.has('entertainment'));
  assert.ok(blocks.some((b) => b.activity.includes('debugging')));
});

test('transcript with no times still produces categorized blocks', () => {
  const { blocks } = parseTranscript(sampleTranscripts[2].text);
  assert.ok(blocks.length >= 1);
  assert.ok(blocks.every((b) => typeof b.category === 'string'));
  assert.ok(blocks.every((b) => b.activity !== '(unspecified)'));
});

test('empty transcript returns no blocks', () => {
  assert.deepEqual(parseTranscript('').blocks, []);
  assert.deepEqual(parseTranscript('   ').blocks, []);
});
