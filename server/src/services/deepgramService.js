// deepgramService.js
// Wraps Deepgram speech-to-text. Two entry points:
//   - transcribeUrl(url)      : transcribe a hosted audio file
//   - transcribeBuffer(buf)   : transcribe raw audio bytes (e.g. an upload)
//
// The pure helper `extractTranscript(response)` is exported separately so it
// can be unit-tested against a recorded Deepgram response without any network
// call or API key.

import { createClient } from '@deepgram/sdk';

const DEFAULT_OPTIONS = {
  model: 'nova-2',
  smart_format: true, // adds punctuation + capitalization, easier to parse downstream
  punctuate: true,
  paragraphs: true,
};

let _client = null;

// Lazily build the client so importing this module never throws when the key
// is missing — only the actual transcribe calls require it.
function getClient() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    throw new Error(
      'DEEPGRAM_API_KEY is not set. Add it to server/.env (see .env.example).'
    );
  }
  if (!_client) _client = createClient(key);
  return _client;
}

// Pull the flat transcript string out of a Deepgram prerecorded response.
// Pure + defensive: returns '' rather than throwing on an unexpected shape.
export function extractTranscript(response) {
  const alt = response?.results?.channels?.[0]?.alternatives?.[0];
  return alt?.transcript?.trim() ?? '';
}

// Pull per-word timing if present — useful later for aligning schedule blocks
// to wall-clock time. Returns [] when the response has no word data.
export function extractWords(response) {
  const alt = response?.results?.channels?.[0]?.alternatives?.[0];
  return Array.isArray(alt?.words) ? alt.words : [];
}

export async function transcribeUrl(url, options = {}) {
  const deepgram = getClient();
  const { result, error } = await deepgram.listen.prerecorded.transcribeUrl(
    { url },
    { ...DEFAULT_OPTIONS, ...options }
  );
  if (error) throw error;
  return { transcript: extractTranscript(result), words: extractWords(result), raw: result };
}

export async function transcribeBuffer(buffer, options = {}) {
  const deepgram = getClient();
  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    buffer,
    { ...DEFAULT_OPTIONS, ...options }
  );
  if (error) throw error;
  return { transcript: extractTranscript(result), words: extractWords(result), raw: result };
}

export default { transcribeUrl, transcribeBuffer, extractTranscript, extractWords };
