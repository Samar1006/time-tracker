import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTranscript, extractWords } from '../src/services/deepgramService.js';

// A trimmed-down shape of a real Deepgram prerecorded response.
const fakeResponse = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'From nine to ten I worked on the API.',
            words: [
              { word: 'From', start: 0.1, end: 0.3 },
              { word: 'nine', start: 0.3, end: 0.6 },
            ],
          },
        ],
      },
    ],
  },
};

test('extractTranscript pulls the flat transcript string', () => {
  assert.equal(extractTranscript(fakeResponse), 'From nine to ten I worked on the API.');
});

test('extractTranscript is defensive on bad shapes', () => {
  assert.equal(extractTranscript(null), '');
  assert.equal(extractTranscript({}), '');
  assert.equal(extractTranscript({ results: {} }), '');
});

test('extractWords returns word timings or empty array', () => {
  assert.equal(extractWords(fakeResponse).length, 2);
  assert.deepEqual(extractWords({}), []);
});
