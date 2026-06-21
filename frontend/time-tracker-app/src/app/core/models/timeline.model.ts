export type ActivityCategory =
  | 'work'
  | 'communication'
  | 'learning'
  | 'entertainment'
  | 'break'
  | 'uncategorized';

export interface TimelineBlock {
  start: string;
  end: string;
  activity: string;
  category: ActivityCategory;
  source: string;
  confidence: number;
  durationSec: number;
}

export interface TimelineHour {
  hour: number;
  label: string;
  totalTrackedSec: number;
  blocks: TimelineBlock[];
}

export interface TimelineResponse {
  userId: string;
  date: string;
  timezone: string;
  totalTrackedSec: number;
  hours: TimelineHour[];
}

export interface ParsedScheduleBlock {
  date: string;
  endDate?: string;
  dayLabel: string | null;
  start: string | null;
  end: string | null;
  durationMin: number | null;
  activity: string;
  category: ActivityCategory;
  confidence: number;
  raw: string;
}

export interface ParsedScheduleResponse {
  blocks: ParsedScheduleBlock[];
}
