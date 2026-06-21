import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript, toDateISO } from '../src/routes/schedule.js';
import { sampleTranscripts } from '../src/data/sampleTranscripts.js';

const REF = new Date('2026-06-20T12:00:00.000Z');
const parse = (text) => parseTranscript(text, { referenceDate: REF });

test('parses a time range into a block with start/end', () => {
  const { blocks } = parse('From 9 to 10:30 I worked on the dashboard.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].date, '2026-06-20');
  assert.equal(blocks[0].start, '9:00 AM');
  assert.equal(blocks[0].end, '10:30 AM');
  assert.equal(blocks[0].durationMin, 90);
  assert.equal(blocks[0].category, 'work');
  assert.equal(blocks[0].activity, 'working on the dashboard');
});

test('derives end time from a spoken duration', () => {
  const { blocks } = parse('At 9 I spent two hours debugging the api.');
  assert.equal(blocks[0].start, '9:00 AM');
  assert.equal(blocks[0].end, '11:00 AM');
  assert.equal(blocks[0].durationMin, 120);
});

test('handles am/pm and noon context', () => {
  const { blocks } = parse('After lunch around 1pm I answered emails for 30 minutes.');
  assert.equal(blocks[0].start, '1:00 PM');
  assert.equal(blocks[0].end, '1:30 PM');
  assert.equal(blocks[0].category, 'communication');
  assert.equal(blocks[0].activity, 'answering emails');
});

test('labels future-tense activities and uses shared am/pm on ranges', () => {
  const { blocks } = parse('From 2 to 3 am i will be running');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, '2:00 AM');
  assert.equal(blocks[0].end, '3:00 AM');
  assert.equal(blocks[0].durationMin, 60);
  assert.equal(blocks[0].activity, 'running');
  assert.equal(blocks[0].category, 'break');
});

test('derives end from start plus spoken duration with am/pm', () => {
  const { blocks } = parse('at 6 am I will work out for 3 hours');
  assert.equal(blocks[0].start, '6:00 AM');
  assert.equal(blocks[0].end, '9:00 AM');
  assert.equal(blocks[0].durationMin, 180);
  assert.equal(blocks[0].activity, 'working out');
});

test('parses spoken hour words in from-to ranges and attached am/pm', () => {
  const { blocks } = parse('I will be running from two to 3AM.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, '2:00 AM');
  assert.equal(blocks[0].end, '3:00 AM');
  assert.equal(blocks[0].durationMin, 60);
  assert.equal(blocks[0].activity, 'running');
  assert.equal(blocks[0].category, 'break');
});

test('parses spoken duration words after attached am/pm start times', () => {
  const { blocks } = parse("At 5AM, I'll run for six hours.");
  assert.equal(blocks[0].start, '5:00 AM');
  assert.equal(blocks[0].end, '11:00 AM');
  assert.equal(blocks[0].durationMin, 360);
  assert.equal(blocks[0].activity, 'running');
  assert.equal(blocks[0].category, 'break');
});

test('parses "until" as end time and chains from previous block', () => {
  const { blocks } = parse(sampleTranscripts[3].text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].end, '10:30 AM');
  assert.equal(blocks[1].start, '10:30 AM');
  assert.equal(blocks[1].end, '11:00 AM');
  assert.equal(blocks[1].category, 'communication');
  assert.equal(blocks[1].activity, 'standup');
});

test('infers times for duration-only segments from prior end', () => {
  const { blocks } = parse(sampleTranscripts[4].text);
  assert.equal(blocks[0].start, null);
  assert.equal(blocks[0].end, null);
  assert.equal(blocks[0].durationMin, 120);
  assert.equal(blocks[0].activity, 'debugging the api');
  assert.equal(blocks[1].start, null);
  assert.equal(blocks[1].end, null);
  assert.equal(blocks[1].durationMin, 30);
});

test('after lunch without clock time gets implicit start and duration', () => {
  const { blocks } = parse(sampleTranscripts[5].text);
  assert.equal(blocks[0].start, '1:00 PM');
  assert.equal(blocks[0].end, '1:30 PM');
  assert.equal(blocks[0].durationMin, 30);
  assert.equal(blocks[0].activity, 'answering emails');
});

test('multi-clause morning transcript chains standup and lunch blocks', () => {
  const { blocks } = parse(sampleTranscripts[6].text);
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
  const { blocks } = parse(sampleTranscripts[0].text);
  assert.ok(blocks.length >= 4, `expected >=4 blocks, got ${blocks.length}`);
  const cats = new Set(blocks.map((b) => b.category));
  assert.ok(cats.has('work'));
  assert.ok(cats.has('communication'));
  assert.ok(cats.has('entertainment'));
  assert.ok(blocks.some((b) => b.activity === 'debugging the api'));
});

test('transcript with no times still produces categorized blocks', () => {
  const { blocks } = parse(sampleTranscripts[2].text);
  assert.ok(blocks.length >= 1);
  assert.ok(blocks.every((b) => typeof b.category === 'string'));
  assert.ok(blocks.every((b) => b.activity !== '(unspecified)'));
});

test('assigns tomorrow when spoken in the segment', () => {
  const { blocks } = parse('Tomorrow at 2 am to 3 am I will study.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].date, '2026-06-21');
  assert.equal(blocks[0].dayLabel, 'tomorrow');
  assert.equal(blocks[0].category, 'learning');
  assert.equal(blocks[0].activity, 'studying');
});

test('strips day words from activity labels', () => {
  const { blocks } = parse('I will run today from 3 am to 6 am.');
  assert.equal(blocks[0].activity, 'running');
  assert.equal(blocks[0].category, 'break');
});

test('activity labels use present tense', () => {
  assert.equal(parse('From 9 to 10 I worked on the dashboard.').blocks[0].activity, 'working on the dashboard');
  assert.equal(parse('I will run today from 3 am to 6 am.').blocks[0].activity, 'running');
  assert.equal(parse('Yesterday at 5 am to 6 am I worked out.').blocks[0].activity, 'working out');
});

test('empty transcript returns no blocks', () => {
  assert.deepEqual(parseTranscript('').blocks, []);
  assert.deepEqual(parseTranscript('   ').blocks, []);
});
