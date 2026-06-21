import { ActivityCategory, TimelineHour, TimelineResponse } from '../../../core/models/timeline.model';
import { CATEGORY_LABELS } from '../../../core/constants/categories';
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
