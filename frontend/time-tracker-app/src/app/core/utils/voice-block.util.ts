/** A parsed schedule block as returned by POST /api/schedule/parse. */
// Keep in sync with server/src/utils/voiceBlockConversion.js (used in server tests).
export interface ScheduleBlock {
  date?: string | null;
  endDate?: string | null;
  dayLabel?: string | null;
  start?: string | null;
  end?: string | null;
  durationMin?: number | null;
  activity?: string;
  category?: string;
}

/** Metadata attached to voice-ingested events. */
export interface VoiceEventMetadata {
  category?: string;
  sourceClient: string;
  localDate: string;
  endLocalDate?: string;
}

/** A raw activity event as accepted by POST /api/events. */
export interface VoiceRawEvent {
  timestamp: string;
  type: string;
  title: string;
  durationSec: number;
  metadata?: VoiceEventMetadata;
}

/** "9:00 AM" / "9 AM" -> minutes since midnight. Returns null if unparseable. */
export function parseClock(label: string | null | undefined): number | null {
  if (!label) return null;
  const trimmed = label.trim();
  const withMinutes = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (withMinutes) {
    return toMinutesSinceMidnight(
      parseInt(withMinutes[1], 10),
      parseInt(withMinutes[2], 10),
      withMinutes[3],
    );
  }
  const withoutMinutes = trimmed.match(/^(\d{1,2})\s*(AM|PM)$/i);
  if (withoutMinutes) {
    return toMinutesSinceMidnight(parseInt(withoutMinutes[1], 10), 0, withoutMinutes[2]);
  }
  return null;
}

function toMinutesSinceMidnight(hour12: number, minute: number, period: string): number {
  let h = hour12;
  const p = period.toUpperCase();
  if (p === 'PM' && h < 12) h += 12;
  if (p === 'AM' && h === 12) h = 0;
  return h * 60 + minute;
}

/** Local wall-clock on `date` (YYYY-MM-DD) -> UTC ISO timestamp for storage. */
export function localTimestamp(date: string, minutesSinceMidnight: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function totalDurationSec(
  startDate: string,
  endDate: string,
  startMin: number,
  endMin: number | null,
  durationMin: number | null | undefined,
): number {
  if (durationMin != null && durationMin > 0) {
    return Math.max(60, Math.round(durationMin * 60));
  }
  if (endMin != null) {
    if (endDate !== startDate) {
      return Math.max(60, ((24 * 60 - startMin) + endMin) * 60);
    }
    return Math.max(60, (endMin - startMin) * 60);
  }
  return 30 * 60;
}

/**
 * Voice logs should land on the dashboard day the user is viewing unless the
 * parser explicitly shifted the day (tomorrow, weekday, etc.). LLM refine
 * sometimes emits placeholder dates (e.g. 2025-01-01) — ignore those.
 */
export function resolveVoiceStorageDate(block: ScheduleBlock, viewedDate: string): string {
  const parserDate = block.date?.trim();
  if (!parserDate || parserDate === viewedDate) {
    return viewedDate;
  }
  if (block.dayLabel) {
    return parserDate;
  }
  const diffMs = Math.abs(
    Date.parse(`${parserDate}T12:00:00.000Z`) - Date.parse(`${viewedDate}T12:00:00.000Z`),
  );
  const diffDays = diffMs / (24 * 60 * 60 * 1000);
  if (diffDays <= 14) {
    return parserDate;
  }
  return viewedDate;
}

/** Convert one parsed block into a single ingest event spanning the full interval. */
export function blockToEvents(block: ScheduleBlock, fallbackDate: string): VoiceRawEvent[] {
  const startMin = parseClock(block.start);
  if (startMin == null) return [];

  const startDate = resolveVoiceStorageDate(block, fallbackDate);
  const endMin = parseClock(block.end);
  const endDate =
    block.endDate && block.endDate !== startDate ? block.endDate : startDate;

  const durationSec = totalDurationSec(startDate, endDate, startMin, endMin, block.durationMin);

  const metadata: VoiceEventMetadata = {
    category: block.category,
    sourceClient: 'dashboard-voice',
    localDate: startDate,
  };
  if (endDate !== startDate) {
    metadata.endLocalDate = endDate;
  }

  return [{
    timestamp: localTimestamp(startDate, startMin),
    type: 'voice',
    title: block.activity?.trim() || 'Activity',
    durationSec,
    metadata,
  }];
}

/** Convert all parsed blocks into ingest-ready events. */
export function scheduleBlocksToEvents(
  blocks: ScheduleBlock[],
  fallbackDate: string,
): VoiceRawEvent[] {
  return blocks.flatMap((block) => blockToEvents(block, fallbackDate));
}
