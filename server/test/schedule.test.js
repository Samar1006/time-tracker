import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from '../src/routes/schedule.js';
import { sampleTranscripts } from '../src/data/sampleTranscripts.js';

test('parses a time range into a block with start/end', () => {
  const { blocks } = parseTranscript('From 9 to 10:30 I worked on the dashboard.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, '09:00');
  assert.equal(blocks[0].end, '10:30');
  assert.equal(blocks[0].durationMin, 90);
  assert.equal(blocks[0].category, 'work');
});

test('derives end time from a spoken duration', () => {
  const { blocks } = parseTranscript('At 9 I spent two hours debugging the api.');
  assert.equal(blocks[0].start, '09:00');
  assert.equal(blocks[0].end, '11:00');
  assert.equal(blocks[0].durationMin, 120);
});

test('handles am/pm and noon context', () => {
  const { blocks } = parseTranscript('After lunch around 1pm I answered emails for 30 minutes.');
  assert.equal(blocks[0].start, '13:00');
  assert.equal(blocks[0].end, '13:30');
  assert.equal(blocks[0].category, 'communication');
});

test('full sample workday yields multiple labeled blocks', () => {
  const { blocks } = parseTranscript(sampleTranscripts[0].text);
  assert.ok(blocks.length >= 4, `expected >=4 blocks, got ${blocks.length}`);
  const cats = new Set(blocks.map((b) => b.category));
  assert.ok(cats.has('work'));
  assert.ok(cats.has('entertainment'));
});

test('transcript with no times still produces categorized blocks', () => {
  const { blocks } = parseTranscript(sampleTranscripts[2].text);
  assert.ok(blocks.length >= 1);
  assert.ok(blocks.every((b) => typeof b.category === 'string'));
});

test('empty transcript returns no blocks', () => {
  assert.deepEqual(parseTranscript('').blocks, []);
  assert.deepEqual(parseTranscript('   ').blocks, []);
});
