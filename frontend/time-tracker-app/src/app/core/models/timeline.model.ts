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
  /** Full stored event start (may be on a prior calendar day). */
  eventStart?: string;
  /** Full stored event end (may be on a later calendar day). */
  eventEnd?: string;
  /** Event continues past midnight into the next day. */
  spansNextDay?: boolean;
  /** Event started on the previous calendar day. */
  spansFromPrevDay?: boolean;
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

export interface DaySummary {
  date: string;
  totalTrackedSec: number;
}

export interface MonthSummaryResponse {
  userId: string;
  month: string;
  days: DaySummary[];
}
