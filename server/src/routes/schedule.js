// schedule.js
// Turns a free-form spoken transcript into structured schedule blocks.
//
//   POST /api/schedule/parse   body: { transcript: string }
//   -> { blocks: [{ start, end, durationMin, activity, category, confidence, raw }] }
//
// The heuristic parser (`parseTranscript`) runs fully offline so it can be
// tested against sample transcripts with no API keys. If ANTHROPIC_API_KEY is
// set, `refineWithLLM` can post-process for messier input (best-effort).

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { categorizeText } from '../services/categorizationService.js';

const router = express.Router();

// --- time parsing helpers --------------------------------------------------

// Matches "9", "9am", "10:30", "1 pm", "13:00", "noon", "midnight".
const TIME_RE =
  /\b(?:(noon|midnight)|(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)\b/i;
// Global variant for stripping every time mention out of activity text.
const TIME_RE_G = new RegExp(TIME_RE.source, 'gi');

// Convert a regex match into minutes-since-midnight, or null.
// `contextPm` nudges bare hours (e.g. "from 1 to 3" after "lunch") toward PM.
function toMinutes(match, contextPm = false) {
  if (!match) return null;
  const [, word, hourStr, minStr, ampm] = match;
  if (word) return word.toLowerCase() === 'noon' ? 12 * 60 : 0;

  let hour = parseInt(hourStr, 10);
  const min = minStr ? parseInt(minStr, 10) : 0;
  if (Number.isNaN(hour) || hour > 23 || min > 59) return null;

  if (ampm) {
    const isPm = ampm.toLowerCase() === 'pm';
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  } else if (contextPm && hour < 12 && hour >= 1 && hour <= 7) {
    // afternoon-ish bare hours -> PM (1..7 -> 13..19)
    hour += 12;
  }
  return hour * 60 + min;
}

function fmt(minutes) {
  if (minutes == null) return null;
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Split a transcript into clause-ish segments we can label individually.
function segment(transcript) {
  return transcript
    .split(/(?:\.|;|\bthen\b|\bafter that\b|\bnext\b|\bafterwards\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Strip leading time/connective words so the activity text reads cleanly.
function cleanActivity(text) {
  return text
    .replace(TIME_RE_G, '')
    .replace(/\b(am|pm)\b/gi, '')
    .replace(/\b(from|to|until|till|around|about|at|i|then|spent|for|the|a|an|hours?|hour|mins?|minutes?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,–-]+|[\s,–-]+$/g, '')
    .trim();
}

// Core heuristic. Walks each segment, extracts a time range when present,
// labels the activity via the categorization service.
export function parseTranscript(transcript) {
  if (!transcript || !transcript.trim()) return { blocks: [] };

  const blocks = [];
  let contextPm = false; // flips true once we hit "lunch"/"afternoon"

  for (const seg of segment(transcript)) {
    const lower = seg.toLowerCase();
    if (/\b(lunch|afternoon|evening|pm)\b/.test(lower)) contextPm = true;

    // Find up to two times in the segment for a start/end range.
    const times = [];
    let rest = seg;
    let m;
    while ((m = TIME_RE.exec(rest)) && times.length < 2) {
      times.push(toMinutes(m, contextPm));
      rest = rest.slice(m.index + m[0].length);
    }

    let start = times[0] ?? null;
    let end = times[1] ?? null;

    // "spent two hours" / "for 90 minutes" -> derive end from a duration.
    if (start != null && end == null) {
      const durH = lower.match(/(\d+(?:\.\d+)?)\s*hours?/);
      const durM = lower.match(/(\d+)\s*(?:mins?|minutes?)/);
      const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
      const wordH = lower.match(/\b(one|two|three|four|five)\s*hours?\b/);
      let mins = 0;
      if (durH) mins += parseFloat(durH[1]) * 60;
      else if (wordH) mins += words[wordH[1]] * 60;
      if (durM) mins += parseInt(durM[1], 10);
      if (mins > 0) end = start + mins;
    }

    const activity = cleanActivity(seg);
    if (!activity && start == null) continue; // nothing useful in this segment

    const label = categorizeText(seg);
    blocks.push({
      start: fmt(start),
      end: fmt(end),
      durationMin: start != null && end != null ? end - start : null,
      activity: activity || '(unspecified)',
      category: label.category,
      confidence: Number(label.confidence.toFixed(2)),
      raw: seg,
    });
  }

  return { blocks };
}

// Optional LLM refinement via Claude (Anthropic). Best-effort: any failure
// returns the heuristic result unchanged, so the endpoint never hard-fails on
// a bad/absent key. Lazily constructs the client so importing this module
// (e.g. in tests) never requires ANTHROPIC_API_KEY.
let _anthropic = null;
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) _anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
  return _anthropic;
}

// Structured-output schema — guarantees Claude returns valid, parseable JSON
// in exactly the shape we want. Times are "" when unknown (kept simple; we
// convert "" -> null below).
const BLOCKS_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string', description: '24-hour HH:MM, or "" if unknown' },
          end: { type: 'string', description: '24-hour HH:MM, or "" if unknown' },
          activity: { type: 'string' },
          category: {
            type: 'string',
            enum: ['work', 'communication', 'learning', 'entertainment', 'break', 'uncategorized'],
          },
        },
        required: ['start', 'end', 'activity', 'category'],
        additionalProperties: false,
      },
    },
  },
  required: ['blocks'],
  additionalProperties: false,
};

export async function refineWithLLM(transcript, fallback) {
  const client = getAnthropic();
  if (!client) return fallback;
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2000,
      system:
        'You extract a daily schedule from a spoken transcript of someone ' +
        'describing how they spent their time. Produce one block per distinct ' +
        'activity. Use 24-hour HH:MM times; use an empty string for any time ' +
        'you cannot infer. Label each block with the best-fitting category.',
      messages: [{ role: 'user', content: transcript }],
      output_config: { format: { type: 'json_schema', schema: BLOCKS_SCHEMA } },
    });
    const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.blocks)) return fallback;
    // Normalize to our block shape ("" -> null).
    const blocks = parsed.blocks.map((b) => ({
      start: b.start || null,
      end: b.end || null,
      durationMin: null,
      activity: b.activity || '(unspecified)',
      category: b.category || 'uncategorized',
      confidence: 1,
      raw: transcript,
    }));
    return { blocks };
  } catch {
    return fallback;
  }
}

router.post('/parse', async (req, res) => {
  const { transcript, useLLM = false } = req.body ?? {};
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: 'Body must include a non-empty "transcript" string.' });
  }
  let result = parseTranscript(transcript);
  if (useLLM) result = await refineWithLLM(transcript, result);
  res.json(result);
});

export default router;
