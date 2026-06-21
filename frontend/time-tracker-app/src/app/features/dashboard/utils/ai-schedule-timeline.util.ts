import {
  ParsedScheduleBlock,
  TimelineBlock,
  TimelineHour
} from '../../../core/models/timeline.model';

export interface ParsedTimelineDay {
  date: string;
  label: string;
  totalTrackedSec: number;
  hours: TimelineHour[];
  unscheduled: ParsedScheduleBlock[];
}

function emptyHours(): TimelineHour[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    totalTrackedSec: 0,
    blocks: []
  }));
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function parseClock(label: string | null): number | null {
  if (!label) return null;

  const match = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const period = match[3].toUpperCase();

  if (hour === 12) hour = 0;
  if (period === 'PM') hour += 12;

  return hour * 60 + minute;
}

function minuteToDate(dateString: string, minute: number): Date {
  const date = new Date(`${dateString}T00:00:00`);
  date.setMinutes(minute, 0, 0);
  return date;
}

function getOrCreateDay(days: Map<string, ParsedTimelineDay>, date: string): ParsedTimelineDay {
  let day = days.get(date);
  if (!day) {
    day = {
      date,
      label: formatTimelineDayLabel(date),
      totalTrackedSec: 0,
      hours: emptyHours(),
      unscheduled: []
    };
    days.set(date, day);
  }
  return day;
}

export function formatTimelineDayLabel(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

export function scheduleBlocksToTimelineDays(blocks: ParsedScheduleBlock[]): ParsedTimelineDay[] {
  const days = new Map<string, ParsedTimelineDay>();

  for (const block of blocks) {
    const startMin = parseClock(block.start);
    const endMin = parseClock(block.end);

    if (startMin == null || endMin == null) {
      getOrCreateDay(days, block.date).unscheduled.push(block);
      continue;
    }

    const startDate = block.date;
    const endDate = block.endDate ?? block.date;
    let cursor = minuteToDate(startDate, startMin);
    let end = minuteToDate(endDate, endMin);

    if (end.getTime() <= cursor.getTime()) {
      end = minuteToDate(addDays(startDate, 1), endMin);
    }

    while (cursor.getTime() < end.getTime()) {
      const currentDate = formatDate(cursor);
      const currentHour = cursor.getHours();
      const nextHour = new Date(cursor);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(currentHour + 1);

      const segmentEnd = nextHour.getTime() < end.getTime() ? nextHour : end;
      const durationSec = Math.max(
        Math.round((segmentEnd.getTime() - cursor.getTime()) / 1000),
        0
      );

      if (durationSec > 0) {
        const day = getOrCreateDay(days, currentDate);
        const hour = day.hours[currentHour];
        const timelineBlock: TimelineBlock = {
          start: cursor.toISOString(),
          end: segmentEnd.toISOString(),
          activity: block.activity,
          category: block.category,
          source: 'voice',
          confidence: block.confidence,
          durationSec
        };

        hour.blocks.push(timelineBlock);
        hour.totalTrackedSec += durationSec;
        day.totalTrackedSec += durationSec;
      }

      cursor = segmentEnd;
    }
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
