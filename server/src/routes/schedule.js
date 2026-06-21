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
      `\\bfrom\\s+(${HOUR_WORD_RE}|\\d{1,2}:\\d{2}|\\d{1,2})\\s+to\\s+(${HOUR_WORD_RE}|\\d{1,2}:\\d{2}|\\d{1,2})(?:\\s*(am|pm))?\\b`,
      'gi',
    ),
    (_, t1, t2, ap) => {
      const h1 = wordToHour(t1) ?? t1;
      const h2 = wordToHour(t2) ?? t2;
      return ap ? `from ${h1} to ${h2} ${ap}` : `from ${h1} to ${h2}`;
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

// "from 2 to 3 am" / "from 7 pm until 9" — share am/pm across both ends when only one side has it.
export function parseFromToRange(seg, contextPm) {
  const rangeRe = new RegExp(
    `\\bfrom\\s+(${FROM_TO_TIME})\\s+(?:to|until|till)\\s+(${FROM_TO_TIME})\\b`,
    'i',
  );
  const m = seg.match(rangeRe);
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
    spansMidnight: end < start,
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

const WEEKDAY_NAMES = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const WEEKDAY_RE =
  'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun';

const MONTH_NAMES = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const MONTH_RE =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function monthNameToNum(name) {
  return MONTH_NAMES[String(name).toLowerCase()] ?? null;
}

function padDateISO(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferYearForMonthDay(referenceDate, month, day) {
  const refISO = toDateISO(referenceDate);
  let year = new Date(`${refISO}T12:00:00.000Z`).getUTCFullYear();
  if (padDateISO(year, month, day) < refISO) year += 1;
  return year;
}

/** Parse explicit calendar dates like "June 23rd" or "on the 23rd". */
export function resolveCalendarDate(text, referenceDate) {
  const lower = text.toLowerCase();

  const monthDay = lower.match(
    new RegExp(`\\b(?:on\\s+)?(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`, 'i'),
  );
  if (monthDay) {
    const month = monthNameToNum(monthDay[1]);
    const day = parseInt(monthDay[2], 10);
    if (month && day >= 1 && day <= 31) {
      const year = monthDay[3]
        ? parseInt(monthDay[3], 10)
        : inferYearForMonthDay(referenceDate, month, day);
      return { date: padDateISO(year, month, day), dayLabel: null };
    }
  }

  const dayOnly = lower.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (dayOnly) {
    const day = parseInt(dayOnly[1], 10);
    if (day >= 1 && day <= 31) {
      const ref = new Date(`${toDateISO(referenceDate)}T12:00:00.000Z`);
      let year = ref.getUTCFullYear();
      let month = ref.getUTCMonth() + 1;
      let dateStr = padDateISO(year, month, day);
      if (dateStr < toDateISO(referenceDate)) {
        const next = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        next.setUTCMonth(next.getUTCMonth() + 1);
        dateStr = toDateISO(next);
      }
      return { date: dateStr, dayLabel: null };
    }
  }

  return null;
}

const CALENDAR_PHRASE_RE = new RegExp(
  `\\b(?:on\\s+)?(?:the\\s+)?(?:${MONTH_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,?\\s*\\d{4})?|\\d{1,2}(?:st|nd|rd|th))\\b`,
  'gi',
);

function stripCalendarForTimeParsing(text) {
  return text.replace(CALENDAR_PHRASE_RE, ' ');
}

// Split a transcript into clause-ish segments we can label individually.
function segment(transcript) {
  return transcript
    .split(
      new RegExp(
        String.raw`(?:\.|;|\bthen\b|\bafter that\b|\bafterwards\b|\bnext\b(?!\s+(?:${WEEKDAY_RE}|week|day)))`,
        'i',
      ),
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

export function toDateISO(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const base = new Date(`${toDateISO(date)}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base;
}

function weekdayToDate(referenceDate, weekdayNum, forceNext = false) {
  const ref = new Date(`${toDateISO(referenceDate)}T12:00:00.000Z`);
  let delta = (weekdayNum - ref.getUTCDay() + 7) % 7;
  if (delta === 0 && forceNext) delta = 7;
  return toDateISO(addDays(ref, delta));
}

export function resolveDayFromSegment(seg, referenceDate, contextDateISO) {
  const calendar = resolveCalendarDate(seg, referenceDate);
  if (calendar) return calendar;

  const lower = seg.toLowerCase();

  if (/\btoday\b/.test(lower)) {
    return { date: toDateISO(referenceDate), dayLabel: 'today' };
  }
  if (/\btomorrow\b/.test(lower)) {
    return { date: toDateISO(addDays(referenceDate, 1)), dayLabel: 'tomorrow' };
  }
  if (/\byesterday\b/.test(lower)) {
    return { date: toDateISO(addDays(referenceDate, -1)), dayLabel: 'yesterday' };
  }

  const weekdayMatch = lower.match(
    new RegExp(`\\b(?:on\\s+)?(next\\s+)?(${WEEKDAY_RE})\\b`, 'i'),
  );
  if (weekdayMatch) {
    const forceNext = Boolean(weekdayMatch[1]);
    const weekdayNum = WEEKDAY_NAMES[weekdayMatch[2].toLowerCase()];
    if (weekdayNum != null) {
      return {
        date: weekdayToDate(referenceDate, weekdayNum, forceNext),
        dayLabel: weekdayMatch[2].toLowerCase(),
      };
    }
  }

  return { date: contextDateISO, dayLabel: null };
}

function marksAfternoon(text) {
  return /\b(lunch|afternoon|evening)\b|\d\s*(?:am|pm)\b|\b\d{1,2}(?:am|pm)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:am|pm)\b/i.test(
    normalizeSpokenTimes(text),
  );
}

// Strip time/duration noise but keep readable activity phrases.
function cleanActivity(text) {
  let s = normalizeSpokenTimes(text);
  s = s.replace(CALENDAR_PHRASE_RE, ' ');
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
    .replace(/\b(?:i'?m|i am)\s+going\s+to\s+/gi, ' ')
    .replace(/\b(?:i'?m|i am)\s+/gi, ' ')
    .replace(/\bthe\s+next\s+day\b/gi, ' ')
    .replace(/\b(?:until|till|from|to|around|about|at)\b/gi, ' ')
    .replace(/\b(?:i'll|i'll|i\s+will\s+be|i\s+will|will\s+be|will|gonna)\s+/gi, ' ')
    .replace(
      new RegExp(`\\b(?:today|tomorrow|yesterday|next\\s+(?:${WEEKDAY_RE}|week)|on\\s+(?:${WEEKDAY_RE}))\\b`, 'gi'),
      ' ',
    )
    .replace(/\b(?:i\s+)?have\s+(?:a\s+)?/gi, '')
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

const LABEL_STOP_WORDS = new Set([
  'on', 'the', 'a', 'an', 'and', 'for', 'at', 'in', 'to', 'of', 'with',
  'api', 'dashboard', 'frontend', 'backend', 'emails', 'email', 'slack',
  'youtube', 'reddit', 'break', 'lunch', 'coffee', 'standup', 'meeting',
  'documentation', 'tutorial', 'game', 'out',
]);

const PRESENT_VERB_FORMS = {
  run: 'running', ran: 'running', walk: 'walking', walked: 'walking',
  work: 'working', worked: 'working', study: 'studying', studied: 'studying',
  sleep: 'sleeping', slept: 'sleeping',
  debug: 'debugging', debugged: 'debugging', code: 'coding', coded: 'coding',
  answer: 'answering', answered: 'answering', reply: 'replying', replied: 'replying',
  browse: 'browsing', browsed: 'browsing', watch: 'watching', watched: 'watching',
  read: 'reading', play: 'playing', played: 'playing', develop: 'developing',
  have: 'having', had: 'having', take: 'taking', took: 'taking',
  meet: 'meeting', met: 'meeting', eat: 'eating', ate: 'eating',
  write: 'writing', wrote: 'writing', build: 'building', built: 'building',
  review: 'reviewing', reviewed: 'reviewing', deploy: 'deploying', deployed: 'deploying',
  learn: 'learning', learned: 'learning', learnt: 'learning',
};

function presentParticiple(word) {
  const w = word.toLowerCase();
  if (!w || LABEL_STOP_WORDS.has(w)) return w;
  if (w.endsWith('ing')) return w;
  if (PRESENT_VERB_FORMS[w]) return PRESENT_VERB_FORMS[w];

  if (w.endsWith('ied')) return `${w.slice(0, -3)}ying`;
  if (w.endsWith('ed')) {
    const stem = w.slice(0, -2);
    if (stem.endsWith('e') && stem.length > 1) return `${stem}ing`;
    return `${stem}ing`;
  }

  if (w.endsWith('e') && w.length > 2 && !w.endsWith('ee')) return `${w.slice(0, -1)}ing`;
  return w;
}

// Normalize labels to present-tense / -ing form: "walked" → "walking", "work out" → "working out".
export function toPresentActivityLabel(text) {
  if (!text?.trim() || text === '(unspecified)') return text;

  let s = text.toLowerCase().trim();
  s = s.replace(/\bworked?\s+out\b/g, 'working out');
  s = s.replace(/\bworked?\s+on\b/g, 'working on');
  s = s.replace(/\bhad\s+a\s+/g, '');
  s = s.replace(/\btook\s+a\s+/g, '');
  s = s.replace(/\bwent\s+for\s+a\s+/g, '');
  s = s.split(/\s+/).map(presentParticiple).join(' ');
  return s.replace(/\s+/g, ' ').trim() || text.trim();
}

// Pull start/end/duration from one segment before cross-segment inference.
export function parseSegmentTimes(seg, contextPm) {
  const normalized = normalizeSpokenTimes(stripCalendarForTimeParsing(seg));
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

// Resolve same-day PM wrap vs cross-midnight span (e.g. 8 pm → 6 am).
export function finalizeBlockSpan(dateISO, startMin, endMin, raw = '') {
  if (startMin == null || endMin == null) {
    return {
      startMin,
      endMin,
      endDate: dateISO,
      durationMin: null,
      spansMidnight: false,
    };
  }

  if (endMin > startMin) {
    return {
      startMin,
      endMin,
      endDate: dateISO,
      durationMin: endMin - startMin,
      spansMidnight: false,
    };
  }

  const pmThenAm =
    /\b\d{1,2}(?::\d{2})?\s*pm\b[\s\S]*\b\d{1,2}(?::\d{2})?\s*am\b/i.test(raw) ||
    (/\bpm\b/i.test(raw) && /\bam\b/i.test(raw) && raw.search(/\bpm\b/i) < raw.search(/\bam\b/i));
  const explicitNextDay = /\b(?:the\s+)?next\s+day\b/i.test(raw);

  const startIsPm = /\bpm\b/i.test(raw) || (startMin != null && startMin >= 12 * 60);
  const endIsAm = /\bam\b/i.test(raw);
  const overnight = pmThenAm || explicitNextDay || (startIsPm && endIsAm && endMin < startMin);

  if (overnight) {
    return {
      startMin,
      endMin,
      endDate: toDateISO(addDays(dateISO, 1)),
      durationMin: (24 * 60 - startMin) + endMin,
      spansMidnight: true,
    };
  }

  const wrappedEnd = endMin + 12 * 60;
  return {
    startMin,
    endMin: wrappedEnd,
    endDate: dateISO,
    durationMin: wrappedEnd - startMin,
    spansMidnight: false,
  };
}

/** Overnight sleep ending in PM is usually a misheard AM (e.g. "5 pm" → 5 am). */
function correctOvernightSleepEnd(endMin, endLabel, raw, spansMidnight) {
  if (!spansMidnight || endMin == null || !/\bsleep/i.test(raw)) return endMin;
  const endHasPm =
    /\bpm\b/i.test(endLabel ?? '') ||
    (endMin >= 12 * 60 && endMin < 24 * 60 && !/\bam\b/i.test(endLabel ?? ''));
  if (!endHasPm) return endMin;
  const hour12 = (Math.floor(endMin / 60) % 12) || 12;
  if (hour12 >= 1 && hour12 <= 11) {
    return endMin - 12 * 60;
  }
  return endMin;
}

// Fill gaps using prior block end, lunch context, and trailing durations.
function inferMissingTimes(blocks) {
  const prevEndByDate = new Map();

  for (const block of blocks) {
    const dateKey = block.date;
    let startMin = parseFmt(block.start);
    let endMin = parseFmt(block.end);
    let duration = block.durationMin;
    let prevEnd = prevEndByDate.get(dateKey) ?? null;

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

    const span = finalizeBlockSpan(dateKey, startMin, endMin, block.raw);
    startMin = span.startMin;
    endMin = span.endMin;
    if (span.spansMidnight) {
      endMin = correctOvernightSleepEnd(endMin, block.end, block.raw, true);
      duration = (24 * 60 - startMin) + endMin;
    } else {
      duration = span.durationMin ?? duration;
    }

    block.start = fmt(startMin);
    block.end = fmt(endMin);
    block.durationMin = duration;
    if (span.spansMidnight) {
      block.endDate = span.endDate;
    } else {
      delete block.endDate;
    }

    if (endMin != null && !span.spansMidnight) {
      prevEnd = endMin;
    } else if (startMin != null && duration != null && !span.spansMidnight) {
      prevEnd = startMin + duration;
    } else if (startMin != null && !span.spansMidnight) {
      prevEnd = startMin;
    }

    prevEndByDate.set(dateKey, prevEnd);
    if (span.spansMidnight && endMin != null) {
      prevEndByDate.set(span.endDate, endMin);
    }
  }

  return blocks;
}

// Core heuristic. Walks each segment, extracts a time range when present,
// labels the activity via the categorization service.
export function parseTranscript(transcript, { referenceDate = new Date() } = {}) {
  if (!transcript || !transcript.trim()) return { blocks: [] };

  const blocks = [];
  let contextPm = false;
  let contextDate = toDateISO(referenceDate);

  for (const seg of segment(transcript)) {
    if (marksAfternoon(seg)) contextPm = true;

    const day = resolveDayFromSegment(seg, referenceDate, contextDate);
    contextDate = day.date;

    const { start, end, durationMin } = parseSegmentTimes(seg, contextPm);
    const activity = toPresentActivityLabel(cleanActivity(seg));
    if (!activity && start == null && end == null && !durationMin) continue;

    const label = categorizeText(cleanActivity(seg) || seg);
    blocks.push({
      date: day.date,
      dayLabel: day.dayLabel,
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
Categories (pick exactly one per block — output MUST use these exact values):
- work: coding, debugging, building features, PR reviews, design docs, project tasks
- communication: email, Slack, calls, standups, syncs, 1:1s, team meetings
- learning: reading docs, courses, tutorials, research, studying
- entertainment: YouTube, games, social media, music, casual browsing
- break: lunch, coffee, walk, gym, rest, nap, sleep, running, jogging, exercise, workout
- uncategorized: only when nothing else fits

Examples:
- "worked on the dashboard" -> work
- "standup meeting" -> communication
- "answered emails" -> communication
- "read documentation" -> learning
- "browsed youtube" -> entertainment
- "coffee break" -> break
`.trim();

export function normalizeCategoryContext(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) return null;
  if (input.length > 12) return null;

  const out = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!label || !description || label.length > 64 || description.length > 256) return null;
    out.push({ label, description });
  }
  return out;
}

function buildCategoryContextPrompt(categoryContext) {
  if (!categoryContext?.length) return '';
  const lines = categoryContext.map(
    (c) => `- "${c.label}": ${c.description}`,
  );
  return (
    '\n\nThe user describes activities in their own terms. Use these groupings to choose ' +
    'the best matching standard category (work, communication, learning, entertainment, ' +
    'break, or uncategorized) for each block:\n' +
    lines.join('\n')
  );
}

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
          date: { type: 'string', description: 'Calendar date YYYY-MM-DD when the block starts' },
          endDate: {
            type: 'string',
            description: 'Optional YYYY-MM-DD when end is on the next day (overnight spans only)',
          },
          activity: { type: 'string', description: 'Short readable activity label' },
          category: {
            type: 'string',
            enum: ['work', 'communication', 'learning', 'entertainment', 'break', 'uncategorized'],
          },
        },
        required: ['start', 'end', 'date', 'activity', 'category'],
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

export async function refineWithLLM(
  transcript,
  fallback,
  { categoryContext = [], referenceDate = new Date() } = {},
) {
  const client = getAnthropic();
  if (!client) return fallback;
  const refIso = toDateISO(referenceDate instanceof Date ? referenceDate : new Date(referenceDate));
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2000,
      system:
        'You extract a daily schedule from a spoken transcript of someone ' +
        'describing how they spent their time. Produce one block per distinct ' +
        'activity segment (split on "then", "after that", "after lunch", etc.). ' +
        'Use 12-hour times with AM/PM (e.g. "9:00 AM", "2:00 PM"); use an empty string for any time you cannot infer. ' +
        `The reference calendar date ("today") is ${refIso}. Default every block to this date unless the transcript explicitly names another day (tomorrow, a weekday, a month-day, etc.). ` +
        'When someone says "at 6 am for 3 hours", the block runs 6:00 AM to 9:00 AM. ' +
        'When they say "from 2 to 3 am", both times are AM. ' +
        'When they say "from 8 pm to 6 am", set endDate to the next calendar day (end stays 6:00 AM). ' +
        'When they say "from 11 pm to 6 am the next day", treat it the same way. ' +
        'When they say "on June 23rd" or "on the 23rd", set date to that calendar day (YYYY-MM-DD) using referenceDate for month/year. ' +
        'Treat spoken number words (one, two, six, etc.) as numeric times and durations. ' +
        'Each block needs a calendar date (YYYY-MM-DD). Infer today/tomorrow/weekday/month-day mentions from the transcript. ' +
        'Infer missing start times from the previous activity end when reasonable. ' +
        'Activity labels must use present tense / -ing form (e.g. "walking", "working out", "studying", "answering emails"). ' +
        'Do not use past tense or future tense in activity labels.\n\n' +
        CATEGORY_GUIDE +
        buildCategoryContextPrompt(categoryContext),
      messages: [{ role: 'user', content: transcript }],
      output_config: { format: { type: 'json_schema', schema: BLOCKS_SCHEMA } },
    });
    const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.blocks) || parsed.blocks.length === 0) return fallback;

    const blocks = parsed.blocks.map((b) => {
      const block = {
        date: b.date || refIso,
        dayLabel: null,
        start: b.start ? fmt(parseFmt(b.start)) : null,
        end: b.end ? fmt(parseFmt(b.end)) : null,
        durationMin: null,
        activity: toPresentActivityLabel(b.activity || '(unspecified)'),
        category: b.category || 'uncategorized',
        confidence: 0,
        raw: transcript,
      };
      if (b.endDate && b.endDate !== block.date) block.endDate = b.endDate;
      block.confidence = Number(llmBlockConfidence(block).toFixed(2));
      return block;
    });
    return { blocks: inferMissingTimes(blocks) };
  } catch {
    return fallback;
  }
}

router.post('/parse', async (req, res) => {
  const {
    transcript,
    useLLM = !!process.env.ANTHROPIC_API_KEY,
    referenceDate,
    categoryContext,
  } = req.body ?? {};
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: 'Body must include a non-empty "transcript" string.' });
  }
  const refDate = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(refDate.getTime())) {
    return res.status(400).json({ error: 'Invalid referenceDate — use ISO 8601 format.' });
  }
  const normalizedContext = normalizeCategoryContext(categoryContext);
  if (normalizedContext === null) {
    return res.status(400).json({
      error: 'Invalid categoryContext — expected an array of { label, description } objects.',
    });
  }
  let result = parseTranscript(transcript, { referenceDate: refDate });
  if (useLLM) {
    result = await refineWithLLM(transcript, result, {
      categoryContext: normalizedContext,
      referenceDate: refDate,
    });
  }
  res.json(result);
});

export default router;
