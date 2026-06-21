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

// Matches "9", "9am", "10:30", "1 pm", "noon", "midnight", and attached "3AM".
const TIME_TOKEN = String.raw`(?:(?:noon|midnight)|(?:\d{1,2}:\d{2}|\d{1,2})(?:\s*(?:am|pm)|(?:am|pm))?)`;
const TIME_RE = new RegExp(`\\b${TIME_TOKEN}\\b`, 'i');
const TIME_RE_G = new RegExp(`\\b${TIME_TOKEN}\\b`, 'gi');

const FROM_TO_TIME = String.raw`(?:(?:noon|midnight)|(?:\d{1,2}:\d{2}|\d{1,2})(?:\s*(?:am|pm)|(?:am|pm))?)`;

const DURATION_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  half: 0.5, quarter: 0.25,
};

const HOUR_WORD_RE = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';

function wordToHour(word) {
  return DURATION_WORDS[String(word).toLowerCase()] ?? null;
}

// Normalize spoken clocks: "5AM" -> "5 am", "from two to three am" -> "from 2 to 3 am".
function normalizeSpokenTimes(text) {
  let s = text;
  s = s.replace(/\b(\d{1,2})(?::(\d{2}))?(am|pm)\b/gi, (_, h, min, ap) =>
    min ? `${h}:${min} ${ap}` : `${h} ${ap}`,
  );
  s = s.replace(
    new RegExp(`\\b(${HOUR_WORD_RE})\\s*(am|pm)\\b`, 'gi'),
    (_, w, ap) => `${wordToHour(w)} ${ap}`,
  );
  s = s.replace(
    new RegExp(
      `\\bfrom\\s+(${HOUR_WORD_RE}|\\d{1,2}:\\d{2}|\\d{1,2})\\s+to\\s+(${HOUR_WORD_RE}|\\d{1,2}:\\d{2}|\\d{1,2})(?:\\s*(?:am|pm)|(?:am|pm))?\\b`,
      'gi',
    ),
    (_, t1, t2, ap) => {
      const h1 = wordToHour(t1) ?? t1;
      const h2 = wordToHour(t2) ?? t2;
      return `from ${h1} to ${h2}${ap ? ` ${ap}` : ''}`;
    },
  );
  s = s.replace(
    new RegExp(`\\bat\\s+(${HOUR_WORD_RE})\\b`, 'gi'),
    (_, w) => `at ${wordToHour(w)}`,
  );
  return s;
}

function toMinutes(match, contextPm = false) {
  if (!match) return null;
  const token = match[0].toLowerCase().replace(/\s+/g, '');
  if (token === 'noon') return 12 * 60;
  if (token === 'midnight') return 0;

  const parsed = token.match(/^(?:(\d{1,2})(?::(\d{2}))?(am|pm)?|(\d{1,2})(am|pm))$/i);
  if (!parsed) return null;

  let hour = parseInt(parsed[1] ?? parsed[4], 10);
  const min = parsed[2] ? parseInt(parsed[2], 10) : 0;
  const ampm = (parsed[3] ?? parsed[5] ?? '').toLowerCase();
  if (Number.isNaN(hour) || hour > 23 || min > 59) return null;

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  else if (!ampm && contextPm && hour < 12 && hour >= 1 && hour <= 7) hour += 12;

  return hour * 60 + min;
}

function fmt(minutes) {
  if (minutes == null) return null;
  const total = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  let h = Math.floor(total / 60);
  const m = total % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  let displayH = h % 12;
  if (displayH === 0) displayH = 12;
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`;
}

function parseFmt(label) {
  if (!label) return null;
  const ampm = label.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    if (ampm[3].toUpperCase() === 'PM' && h < 12) h += 12;
    if (ampm[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  const h24 = label.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return parseInt(h24[1], 10) * 60 + parseInt(h24[2], 10);
  return null;
}

function isDurationToken(seg, index, length) {
  const before = seg.slice(Math.max(0, index - 5), index).toLowerCase();
  const after = seg.slice(index + length, index + length + 12).toLowerCase();
  const token = seg.slice(index, index + length).toLowerCase();
  if (/\bfor\s$/.test(before)) return true;
  if (/^\s*(?:hours?|hrs?|mins?|minutes?)\b/.test(after)) return true;
  if (wordToHour(token) != null && /^\s*(?:hours?|hrs?|mins?|minutes?)\b/.test(after)) return true;
  return false;
}

// "from 2 to 3 am" — share am/pm across both ends of the range.
function parseFromToRange(seg, contextPm) {
  const normalized = normalizeSpokenTimes(seg);
  const m = normalized.match(
    new RegExp(`\\bfrom\\s+(${FROM_TO_TIME})\\s+to\\s+(${FROM_TO_TIME})\\b`, 'i'),
  );
  if (!m) return null;

  const endToken = m[2];
  const endAmpm = endToken.match(/(?:am|pm)/i)?.[0]?.toLowerCase();
  const startToken = endAmpm && !/(?:am|pm)/i.test(m[1])
    ? `${m[1]} ${endAmpm}`
    : m[1];

  const start = toMinutes([startToken], contextPm && !endAmpm);
  const end = toMinutes([endToken], contextPm && !endAmpm);
  if (start == null || end == null) return null;

  return {
    start,
    end,
    durationMin: end > start ? end - start : null,
  };
}

// Extract spoken duration in minutes from a segment (may be partial).
function extractDurationMinutes(text) {
  const lower = text.toLowerCase();
  let mins = 0;

  const durH = lower.match(/(\d+(?:\.\d+)?)\s*hours?/);
  const durM = lower.match(/(\d+)\s*(?:mins?|minutes?)/);
  const wordH = lower.match(
    new RegExp(`\\b(${HOUR_WORD_RE}|half|quarter)\\s*(?:an?\\s+)?hours?\\b`),
  );
  const wordM = lower.match(/\b(one|two|three|four|five|ten|fifteen|twenty|thirty|forty|five|forty-five|forty five)\s*(?:mins?|minutes?)\b/);
  const anHour = /\b(?:an?\s+)?hour\b/.test(lower);

  if (durH) mins += parseFloat(durH[1]) * 60;
  else if (wordH) mins += (DURATION_WORDS[wordH[1]] ?? 0) * 60;
  else if (anHour) mins += 60;

  if (durM) mins += parseInt(durM[1], 10);
  else if (wordM) {
    const wordMinMap = {
      one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10,
      fifteen: 15, twenty: 20, thirty: 30, forty: 40,
      'forty-five': 45, 'forty five': 45,
    };
    mins += wordMinMap[wordM[1]] ?? 0;
  }

  return mins > 0 ? mins : null;
}

// Split a transcript into clause-ish segments we can label individually.
function segment(transcript) {
  return transcript
    .split(/(?:\.|;|\bthen\b|\bafter that\b|\bnext\b|\bafterwards\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function marksAfternoon(text) {
  return /\b(lunch|afternoon|evening)\b|\d\s*(?:am|pm)\b|\b\d{1,2}(?:am|pm)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:am|pm)\b/i.test(
    normalizeSpokenTimes(text),
  );
}

// Strip time/duration noise but keep readable activity phrases.
function cleanActivity(text) {
  let s = normalizeSpokenTimes(text);
  s = s.replace(
    new RegExp(
      `\\bfrom\\s+(?:${HOUR_WORD_RE}|\\d{1,2}:\\d{2}|\\d{1,2})\\s+to\\s+(?:${HOUR_WORD_RE}|\\d{1,2}:\\d{2}|\\d{1,2})(?:\\s*(?:am|pm)|(?:am|pm))?\\b`,
      'gi',
    ),
    ' ',
  );
  s = s
    .replace(
      new RegExp(
        `\\b(?:for\\s+)?(?:(?:\\d+(?:\\.\\d+)?|${HOUR_WORD_RE}|half|quarter|fifteen|twenty|thirty|forty|forty-five|forty five)\\s*(?:hours?|hrs?|mins?|minutes?)|(?:an?\\s+hours?))\\b`,
        'gi',
      ),
      ' ',
    )
    .replace(TIME_RE_G, '')
    .replace(/\b(?:until|till|from|to|around|about|at)\b/gi, ' ')
    .replace(/\b(?:i'll|i'll|i\s+will\s+be|i\s+will|will\s+be|will|going\s+to|gonna)\s+/gi, ' ')
    .replace(/\b(?:i\s+)?spent\s+/gi, '')
    .replace(/\b(am|pm)\b/gi, '')
    .replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  s = s.replace(/^(?:then|after that|after lunch|next|afterwards)\s+/i, '');
  s = s.replace(/^i\s+/i, '');
  s = s.replace(/^[\s,–-]+|[\s,–-]+$/g, '').trim();
  return s;
}

// Pull start/end/duration from one segment before cross-segment inference.
function parseSegmentTimes(seg, contextPm) {
  const normalized = normalizeSpokenTimes(seg);
  const range = parseFromToRange(normalized, contextPm);
  if (range) return range;

  // "until 11" / "till 1pm" — end time only
  const untilMatch = normalized.match(
    new RegExp(`\\b(?:until|till)\\s+(${FROM_TO_TIME})\\b`, 'i'),
  );
  if (untilMatch) {
    const end = toMinutes([untilMatch[1]], contextPm);
    return { start: null, end, durationMin: null };
  }

  // Collect up to two clock times; skip numbers that belong to durations.
  const times = [];
  let rest = normalized;
  let searchFrom = 0;
  while (times.length < 2) {
    const timeRe = new RegExp(TIME_RE.source, 'i');
    const slice = rest.slice(searchFrom);
    const m = timeRe.exec(slice);
    if (!m) break;
    const absIndex = searchFrom + m.index;
    if (isDurationToken(normalized, absIndex, m[0].length)) {
      searchFrom = absIndex + m[0].length;
      continue;
    }
    times.push(toMinutes(m, contextPm));
    searchFrom = absIndex + m[0].length;
  }

  let start = times[0] ?? null;
  let end = times[1] ?? null;
  const durationMin = extractDurationMinutes(normalized);

  // "from 9 to 10" already captured; derive end from duration when only start known
  if (start != null && end == null && durationMin != null) {
    end = start + durationMin;
  }

  // Duration-only segment (no explicit clock times)
  if (start == null && end == null && durationMin != null) {
    return { start: null, end: null, durationMin };
  }

  return {
    start,
    end,
    durationMin: start != null && end != null ? end - start : durationMin,
  };
}

// Fill gaps using prior block end, lunch context, and trailing durations.
function inferMissingTimes(blocks) {
  let prevEnd = null;

  for (const block of blocks) {
    const lower = block.raw.toLowerCase();
    let startMin = parseFmt(block.start);
    let endMin = parseFmt(block.end);
    let duration = block.durationMin;

    // "after lunch" with no clock time → assume ~1pm start
    if (/\bafter lunch\b/i.test(block.raw) && startMin == null) {
      startMin = 13 * 60;
    }

    if (startMin == null && prevEnd != null) {
      startMin = prevEnd;
    }

    if (startMin != null && endMin == null && duration != null) {
      endMin = startMin + duration;
    }

    if (startMin != null && endMin == null && duration == null) {
      duration = extractDurationMinutes(block.raw);
      if (duration != null) endMin = startMin + duration;
    }

    block.start = fmt(startMin);
    block.end = fmt(endMin);
    block.durationMin =
      startMin != null && endMin != null ? endMin - startMin : duration;

    // "until 9" after 7pm — bare end hour earlier than start means same-day PM
    if (startMin != null && endMin != null && endMin <= startMin) {
      endMin += 12 * 60;
      block.end = fmt(endMin);
      block.durationMin = endMin - startMin;
    }

    if (endMin != null) prevEnd = endMin;
    else if (startMin != null && block.durationMin != null) {
      prevEnd = startMin + block.durationMin;
    } else if (startMin != null) prevEnd = startMin;
  }

  return blocks;
}

// Core heuristic. Walks each segment, extracts a time range when present,
// labels the activity via the categorization service.
export function parseTranscript(transcript) {
  if (!transcript || !transcript.trim()) return { blocks: [] };

  const blocks = [];
  let contextPm = false;

  for (const seg of segment(transcript)) {
    if (marksAfternoon(seg)) contextPm = true;

    const { start, end, durationMin } = parseSegmentTimes(seg, contextPm);
    const activity = cleanActivity(seg);
    if (!activity && start == null && end == null && !durationMin) continue;

    const label = categorizeText(seg);
    blocks.push({
      start: fmt(start),
      end: fmt(end),
      durationMin: durationMin ?? null,
      activity: activity || '(unspecified)',
      category: label.category,
      confidence: Number(label.confidence.toFixed(2)),
      raw: seg,
    });
  }

  return { blocks: inferMissingTimes(blocks) };
}

// Optional LLM refinement via Claude (Anthropic). Best-effort: any failure
// returns the heuristic result unchanged, so the endpoint never hard-fails on
// a bad/absent key. Lazily constructs the client so importing this module
// (e.g. in tests) never requires ANTHROPIC_API_KEY.
let _anthropic = null;
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

const CATEGORY_GUIDE = `
Categories (pick exactly one per block):
- work: coding, debugging, building features, PR reviews, design docs, project tasks
- communication: email, Slack, calls, standups, syncs, 1:1s, team meetings
- learning: reading docs, courses, tutorials, research, studying
- entertainment: YouTube, games, social media, music, casual browsing
- break: lunch, coffee, walk, gym, rest, nap, running, jogging, exercise, workout
- uncategorized: only when nothing else fits

Examples:
- "worked on the dashboard" -> work
- "standup meeting" -> communication
- "answered emails" -> communication
- "read documentation" -> learning
- "browsed youtube" -> entertainment
- "coffee break" -> break
`.trim();

const BLOCKS_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string', description: '12-hour time like "9:00 AM", or "" if unknown' },
          end: { type: 'string', description: '12-hour time like "10:30 AM", or "" if unknown' },
          activity: { type: 'string', description: 'Short readable activity label' },
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

function llmBlockConfidence(block) {
  let score = 0.75;
  if (block.start && block.end) score += 0.1;
  else if (block.start || block.end) score += 0.05;
  if (block.activity && block.activity !== '(unspecified)') score += 0.05;
  return Math.min(0.95, score);
}

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
        'activity segment (split on "then", "after that", "after lunch", etc.). ' +
        'Use 12-hour times with AM/PM (e.g. "9:00 AM", "2:00 PM"); use an empty string for any time you cannot infer. ' +
        'When someone says "at 6 am for 3 hours", the block runs 6:00 AM to 9:00 AM. ' +
        'When they say "from 2 to 3 am", both times are AM. ' +
        'Treat spoken number words (one, two, six, etc.) as numeric times and durations. ' +
        'Infer missing start times from the previous activity end when reasonable. ' +
        'Activity labels should be short, natural, and readable (e.g. "Worked on the dashboard", ' +
        '"Standup meeting", "Answered emails"). Do not strip verbs or produce fragments.\n\n' +
        CATEGORY_GUIDE,
      messages: [{ role: 'user', content: transcript }],
      output_config: { format: { type: 'json_schema', schema: BLOCKS_SCHEMA } },
    });
    const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.blocks) || parsed.blocks.length === 0) return fallback;

    const blocks = parsed.blocks.map((b) => {
      const startMin = parseFmt(b.start);
      const endMin = parseFmt(b.end);
      const durationMin =
        startMin != null && endMin != null ? endMin - startMin : null;
      const block = {
        start: fmt(startMin),
        end: fmt(endMin),
        durationMin,
        activity: b.activity || '(unspecified)',
        category: b.category || 'uncategorized',
        confidence: 0,
        raw: transcript,
      };
      block.confidence = Number(llmBlockConfidence(block).toFixed(2));
      return block;
    });
    return { blocks };
  } catch {
    return fallback;
  }
}

router.post('/parse', async (req, res) => {
  const { transcript, useLLM = !!process.env.ANTHROPIC_API_KEY } = req.body ?? {};
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: 'Body must include a non-empty "transcript" string.' });
  }
  let result = parseTranscript(transcript);
  if (useLLM) result = await refineWithLLM(transcript, result);
  res.json(result);
});

export default router;
