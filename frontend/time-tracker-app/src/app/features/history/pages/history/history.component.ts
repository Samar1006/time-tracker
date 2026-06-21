import { Component, signal } from '@angular/core';

import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_LEGEND } from '../../../../core/constants/categories';
import { formatDuration } from '../../../../core/utils/duration.util';
import { DashboardHeaderComponent } from '../../../dashboard/components/dashboard-header/dashboard-header.component';
import { DashboardSidebarComponent } from '../../../dashboard/components/dashboard-sidebar/dashboard-sidebar.component';
import { shiftDate, toDateInputValue } from '../../../dashboard/utils/dashboard-stats.util';

interface DaySegment {
  category: string;
  pct: number;
}

interface DayBar {
  date: string;
  label: string;
  totalSec: number;
  heightPct: number;
  segments: DaySegment[];
}

const DAYS = 7;

// Illustrative per-weekday category minutes. Multi-day history isn't persisted
// yet (only the current day is tracked), so the History view shows a realistic
// sample week — weekdays are work-heavy, weekends lean to entertainment/break.
// Keyed by JS getUTCDay() (0 = Sunday … 6 = Saturday).
const WEEKDAY_PROFILE: Record<number, Record<string, number>> = {
  0: { work: 20, communication: 15, learning: 55, entertainment: 130, break: 70 },   // Sun
  1: { work: 215, communication: 55, learning: 40, entertainment: 25, break: 35 },    // Mon
  2: { work: 300, communication: 45, learning: 30, entertainment: 20, break: 25 },    // Tue
  3: { work: 180, communication: 75, learning: 80, entertainment: 40, break: 35 },    // Wed
  4: { work: 260, communication: 40, learning: 35, entertainment: 35, break: 20 },    // Thu
  5: { work: 160, communication: 60, learning: 25, entertainment: 115, break: 55 },   // Fri
  6: { work: 45, communication: 20, learning: 85, entertainment: 160, break: 95 }     // Sat
};

@Component({
  selector: 'app-history-page',
  imports: [DashboardHeaderComponent, DashboardSidebarComponent],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss'
})
export class HistoryComponent {
  readonly displayDate = 'Last 7 days';
  readonly legend = CATEGORY_LEGEND;
  readonly days = signal<DayBar[]>(this.buildWeek());

  private buildWeek(): DayBar[] {
    const today = toDateInputValue(new Date());
    const dates = Array.from({ length: DAYS }, (_, i) => shiftDate(today, i - (DAYS - 1)));
    const bars = dates.map((date) => this.toBar(date));
    const max = Math.max(1, ...bars.map((b) => b.totalSec));
    bars.forEach((b) => (b.heightPct = Math.round((b.totalSec / max) * 100)));
    return bars;
  }

  private toBar(date: string): DayBar {
    const d = new Date(`${date}T12:00:00.000Z`);
    const profile = WEEKDAY_PROFILE[d.getUTCDay()] ?? {};

    let totalMin = 0;
    for (const min of Object.values(profile)) totalMin += min;

    // Stack segments in legend order for consistent colors.
    const segments: DaySegment[] = this.legend
      .map((category) => ({
        category,
        pct: totalMin > 0 ? ((profile[category] ?? 0) / totalMin) * 100 : 0
      }))
      .filter((s) => s.pct > 0);

    return {
      date,
      label: this.shortLabel(d),
      totalSec: totalMin * 60,
      heightPct: 0,
      segments
    };
  }

  private shortLabel(d: Date): string {
    const weekday = d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
    return `${weekday} ${d.getUTCDate()}`;
  }

  color(category: string): string {
    return CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] ?? CATEGORY_COLORS.uncategorized;
  }

  label(category: string): string {
    return CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category;
  }

  duration(seconds: number): string {
    return seconds > 0 ? formatDuration(seconds) : '—';
  }
}
