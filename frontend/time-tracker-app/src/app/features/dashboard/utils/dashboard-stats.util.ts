import { ActivityCategory, TimelineHour, TimelineResponse } from '../../../core/models/timeline.model';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../../../core/constants/categories';
import { formatDuration } from '../../../core/utils/duration.util';

export function hasLiveTrackedData(timeline: TimelineResponse | null): boolean {
  if (!timeline) return false;
  return timeline.hours.some((hour) =>
    hour.blocks.some((block) => block.source === 'tracked' || block.source === 'voice' || block.source === 'manual')
  );
}

export function hasDemoData(timeline: TimelineResponse | null): boolean {
  if (!timeline) return false;
  return timeline.hours.some((hour) => hour.blocks.some((block) => block.source === 'demo'));
}

export interface DashboardStats {
  totalTracked: string;
  mostActiveCategory: string;
  mostActiveDuration: string;
  topApp: string;
}

export function computeDashboardStats(timeline: TimelineResponse): DashboardStats {
  const categoryTotals = new Map<ActivityCategory, number>();
  const activityTotals = new Map<string, number>();

  for (const hour of timeline.hours) {
    for (const block of hour.blocks) {
      categoryTotals.set(
        block.category,
        (categoryTotals.get(block.category) ?? 0) + block.durationSec
      );
      activityTotals.set(
        block.activity,
        (activityTotals.get(block.activity) ?? 0) + block.durationSec
      );
    }
  }

  let topCategory: ActivityCategory = 'work';
  let topCategorySec = 0;

  for (const [category, seconds] of categoryTotals.entries()) {
    if (seconds > topCategorySec) {
      topCategory = category;
      topCategorySec = seconds;
    }
  }

  let topApp = '—';
  let topAppSec = 0;

  for (const [activity, seconds] of activityTotals.entries()) {
    if (seconds > topAppSec) {
      topApp = activity;
      topAppSec = seconds;
    }
  }

  const categoryLabel = CATEGORY_LABELS[topCategory] ?? topCategory;

  return {
    totalTracked: formatDuration(timeline.totalTrackedSec),
    mostActiveCategory: categoryLabel,
    mostActiveDuration: formatDuration(topCategorySec),
    topApp
  };
}

export function getVisibleHours(
  hours: TimelineHour[],
  startHour: number,
  endHour: number
): TimelineHour[] {
  const byHour = new Map(hours.map((hour) => [hour.hour, hour]));

  return Array.from({ length: endHour - startHour + 1 }, (_, index) => {
    const hour = startHour + index;
    return (
      byHour.get(hour) ?? {
        hour,
        label: `${String(hour).padStart(2, '0')}:00`,
        totalTrackedSec: 0,
        blocks: []
      }
    );
  });
}

/** Pick chart hours so evening activity (e.g. 9 PM YouTube) is visible. */
export function computeVisibleHourRange(
  hours: TimelineHour[],
  selectedDate: string
): { startHour: number; endHour: number } {
  const activeHours = hours.filter((hour) => hour.totalTrackedSec > 0).map((hour) => hour.hour);

  if (activeHours.length > 0) {
    const min = Math.min(...activeHours);
    const max = Math.max(...activeHours);
    return {
      startHour: Math.max(0, min - 1),
      endHour: Math.min(23, max + 1)
    };
  }

  const today = toDateInputValue(new Date());
  const nowHour = new Date().getHours();

  if (selectedDate === today) {
    return {
      startHour: Math.min(8, nowHour),
      endHour: Math.min(23, Math.max(22, nowHour + 1))
    };
  }

  return { startHour: 8, endHour: 23 };
}

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftDate(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

export interface CategoryBreakdownItem {
  category: ActivityCategory;
  label: string;
  seconds: number;
  percent: number;
}

export interface TopActivityItem {
  activity: string;
  seconds: number;
}

export interface ActivityDonutSlice {
  label: string;
  seconds: number;
  percent: number;
  color: string;
}

export const SECONDS_PER_DAY = 24 * 60 * 60;
export const UNTRACKED_SLICE_COLOR = '#d1d5db';

const ACTIVITY_PALETTE = [
  '#6366f1',
  '#3b82f6',
  '#22c55e',
  '#ec4899',
  '#f97316',
  '#8b5cf6',
  '#14b8a6',
  '#eab308',
  '#ef4444',
  '#06b6d4'
];

export function daysInCalendarMonth(referenceDate = new Date()): number {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  return new Date(year, month + 1, 0).getDate();
}

export function computeActivityDonutSlices(
  timelines: TimelineResponse[],
  periodDayCount: number
): ActivityDonutSlice[] {
  const periodCapacitySec = periodDayCount * SECONDS_PER_DAY;
  if (periodCapacitySec <= 0) {
    return [];
  }

  const activityTotals = new Map<string, number>();
  const activityCategories = new Map<string, Map<ActivityCategory, number>>();

  for (const timeline of timelines) {
    for (const hour of timeline.hours) {
      for (const block of hour.blocks) {
        activityTotals.set(
          block.activity,
          (activityTotals.get(block.activity) ?? 0) + block.durationSec
        );

        const categories = activityCategories.get(block.activity) ?? new Map();
        categories.set(block.category, (categories.get(block.category) ?? 0) + block.durationSec);
        activityCategories.set(block.activity, categories);
      }
    }
  }

  const trackedSec = [...activityTotals.values()].reduce((sum, seconds) => sum + seconds, 0);
  const slices: ActivityDonutSlice[] = [];

  const activities = [...activityTotals.entries()].sort((a, b) => b[1] - a[1]);
  activities.forEach(([activity, seconds], index) => {
    const categories = activityCategories.get(activity);
    let dominantCategory: ActivityCategory | null = null;
    let dominantSec = 0;
    if (categories) {
      for (const [category, categorySec] of categories.entries()) {
        if (categorySec > dominantSec) {
          dominantCategory = category;
          dominantSec = categorySec;
        }
      }
    }

    const color =
      dominantCategory != null
        ? CATEGORY_COLORS[dominantCategory]
        : ACTIVITY_PALETTE[index % ACTIVITY_PALETTE.length];

    slices.push({
      label: activity,
      seconds,
      percent: (seconds / periodCapacitySec) * 100,
      color
    });
  });

  const untrackedSec = Math.max(0, periodCapacitySec - trackedSec);
  if (untrackedSec > 0 || slices.length === 0) {
    slices.push({
      label: 'untracked',
      seconds: untrackedSec,
      percent: (untrackedSec / periodCapacitySec) * 100,
      color: UNTRACKED_SLICE_COLOR
    });
  }

  return slices;
}

export function aggregateTimelineSeconds(timelines: TimelineResponse[]): number {
  return timelines.reduce((sum, timeline) => sum + timeline.totalTrackedSec, 0);
}

export function computeCategoryBreakdown(timelines: TimelineResponse[]): CategoryBreakdownItem[] {
  const categoryTotals = new Map<ActivityCategory, number>();
  let total = 0;

  for (const timeline of timelines) {
    for (const hour of timeline.hours) {
      for (const block of hour.blocks) {
        const next = (categoryTotals.get(block.category) ?? 0) + block.durationSec;
        categoryTotals.set(block.category, next);
        total += block.durationSec;
      }
    }
  }

  return (Object.keys(CATEGORY_LABELS) as ActivityCategory[])
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      seconds: categoryTotals.get(category) ?? 0,
      percent: total > 0 ? ((categoryTotals.get(category) ?? 0) / total) * 100 : 0
    }))
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
}

export function computeTopActivities(
  timelines: TimelineResponse[],
  limit = 5
): TopActivityItem[] {
  const activityTotals = new Map<string, number>();

  for (const timeline of timelines) {
    for (const hour of timeline.hours) {
      for (const block of hour.blocks) {
        activityTotals.set(
          block.activity,
          (activityTotals.get(block.activity) ?? 0) + block.durationSec
        );
      }
    }
  }

  return [...activityTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([activity, seconds]) => ({ activity, seconds }));
}

/** Monday–Sunday dates for the week containing `referenceDate`. */
export function getWeekDateRange(referenceDate: string): string[] {
  const date = new Date(`${referenceDate}T12:00:00`);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + index);
    return toDateInputValue(d);
  });
}

export function toMonthInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function formatDisplayDate(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00`);
  const today = toDateInputValue(new Date());

  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);

  if (dateString === today) {
    return `Today, ${formatted}`;
  }

  return formatted;
}
