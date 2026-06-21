import { ActivityCategory, TimelineHour, TimelineResponse } from '../../../core/models/timeline.model';
import { formatDuration } from '../../../core/utils/duration.util';

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

  const categoryLabel = topCategory.charAt(0).toUpperCase() + topCategory.slice(1);

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

export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDate(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
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
