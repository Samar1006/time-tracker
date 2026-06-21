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

const DURATION_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  half: 0.5, quarter: 0.25,
};

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

function parseFmt(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Extract spoken duration in minutes from a segment (may be partial).
function extractDurationMinutes(text) {
  const lower = text.toLowerCase();
  let mins = 0;

  const durH = lower.match(/(\d+(?:\.\d+)?)\s*hours?/);
  const durM = lower.match(/(\d+)\s*(?:mins?|minutes?)/);
  const wordH = lower.match(/\b(one|two|three|four|five|six|half|quarter)\s*(?:an?\s+)?hours?\b/);
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
  return /\b(lunch|afternoon|evening)\b|\d\s*(?:am|pm)\b|\b\d{1,2}(?:am|pm)\b/i.test(text);
}

// Strip time/duration noise but keep readable activity phrases.
function cleanActivity(text) {
  let s = text
    .replace(
      /\b(?:for\s+)?(?:(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty-five|forty five|half|quarter)\s*(?:hours?|hrs?|mins?|minutes?)|(?:an?\s+hours?))\b/gi,
      ' ',
    )
    .replace(TIME_RE_G, '')
    .replace(/\b(?:until|till|from|to|around|about|at)\b/gi, ' ')
    .replace(/\b(?:i\s+)?spent\s+/gi, '')
    .replace(/\b(am|pm)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  s = s.replace(/^(?:then|after that|after lunch|next|afterwards)\s+/i, '');
  s = s.replace(/^i\s+/i, '');
  s = s.replace(/^[\s,–-]+|[\s,–-]+$/g, '').trim();
  return s;
}

// Pull start/end/duration from one segment before cross-segment inference.
function parseSegmentTimes(seg, contextPm) {
  const lower = seg.toLowerCase();

  // "until 11" / "till 1pm" — end time only
  const untilMatch = seg.match(
    /\b(?:until|till)\s+(?:(noon|midnight)|(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)\b/i,
  );
  if (untilMatch) {
    const end = toMinutes(untilMatch, contextPm);
    return { start: null, end, durationMin: null };
  }

  // Collect up to two bare times (from X to Y, or "at 9 ...")
  const times = [];
  let rest = seg;
  while (times.length < 2) {
    const timeRe = new RegExp(TIME_RE.source, 'i');
    const m = timeRe.exec(rest);
    if (!m) break;
    times.push(toMinutes(m, contextPm));
    rest = rest.slice(m.index + m[0].length);
  }

  let start = times[0] ?? null;
  let end = times[1] ?? null;
  const durationMin = extractDurationMinutes(seg);

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
- break: lunch, coffee, walk, gym, rest, nap
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
          start: { type: 'string', description: '24-hour HH:MM, or "" if unknown' },
          end: { type: 'string', description: '24-hour HH:MM, or "" if unknown' },
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
        'Use 24-hour HH:MM times; use an empty string for any time you cannot infer. ' +
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
      const start = b.start || null;
      const end = b.end || null;
      const startMin = parseFmt(start);
      const endMin = parseFmt(end);
      const durationMin =
        startMin != null && endMin != null ? endMin - startMin : null;
      const block = {
        start,
        end,
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
