import { Component, computed, input, signal } from '@angular/core';

import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_LEGEND
} from '../../../../core/constants/categories';
import { ActivityCategory, TimelineBlock, TimelineHour } from '../../../../core/models/timeline.model';
import { formatDuration, formatHourLabel } from '../../../../core/utils/duration.util';

interface TooltipState {
  category: string;
  duration: string;
  activity: string;
  timeRange: string;
  x: number;
  y: number;
}

export interface HourSegment {
  category: ActivityCategory;
  durationSec: number;
  /** Share of the 60-minute hour (0–100). */
  widthPct: number;
  sampleBlock: TimelineBlock;
}

export interface HourRow {
  hour: number;
  label: string;
  totalTrackedSec: number;
  segments: HourSegment[];
  /** Untracked portion of the hour (0–100). */
  unusedPct: number;
}

const SECONDS_PER_HOUR = 3600;

@Component({
  selector: 'app-timeline-chart',
  templateUrl: './timeline-chart.component.html',
  styleUrl: './timeline-chart.component.scss'
})
export class TimelineChartComponent {
  readonly hours = input.required<TimelineHour[]>();
  readonly date = input.required<string>();

  readonly tooltip = signal<TooltipState | null>(null);
  readonly categoryLegend = CATEGORY_LEGEND;
  readonly categoryLabels = CATEGORY_LABELS;

  readonly hourRows = computed(() => {
    const byHour = new Map(this.hours().map((hour) => [hour.hour, hour]));
    const rows: HourRow[] = [];

    for (let hour = 0; hour <= 23; hour += 1) {
      const bucket = byHour.get(hour) ?? {
        hour,
        label: `${String(hour).padStart(2, '0')}:00`,
        totalTrackedSec: 0,
        blocks: []
      };

      const categoryTotals = new Map<ActivityCategory, { durationSec: number; block: TimelineBlock }>();
      for (const block of bucket.blocks) {
        const existing = categoryTotals.get(block.category);
        if (existing) {
          existing.durationSec += block.durationSec;
        } else {
          categoryTotals.set(block.category, { durationSec: block.durationSec, block });
        }
      }

      const segments: HourSegment[] = [...categoryTotals.entries()]
        .map(([category, { durationSec, block }]) => ({
          category,
          durationSec,
          widthPct: (durationSec / SECONDS_PER_HOUR) * 100,
          sampleBlock: block
        }))
        .sort((a, b) => b.durationSec - a.durationSec);

      const trackedPct = Math.min(
        100,
        segments.reduce((sum, segment) => sum + segment.widthPct, 0)
      );

      rows.push({
        hour,
        label: formatHourLabel(hour),
        totalTrackedSec: bucket.totalTrackedSec,
        segments,
        unusedPct: Math.max(0, 100 - trackedPct)
      });
    }

    return rows;
  });

  readonly hasActivity = computed(() =>
    this.hours().some((hour) => hour.totalTrackedSec > 0)
  );

  formatBlockDuration(seconds: number): string {
    return formatDuration(seconds);
  }

  formatTimeRange(block: TimelineBlock): string {
    const fmt = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    });
    return `${fmt.format(new Date(block.start))} – ${fmt.format(new Date(block.end))}`;
  }

  categoryColor(category: ActivityCategory): string {
    return CATEGORY_COLORS[category];
  }

  showSegmentTooltip(segment: HourSegment, event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    this.tooltip.set({
      category: CATEGORY_LABELS[segment.category],
      duration: formatDuration(segment.durationSec),
      activity: segment.sampleBlock.activity,
      timeRange: this.formatTimeRange(segment.sampleBlock),
      x: rect.left + rect.width / 2,
      y: rect.top - 8
    });
  }

  hideTooltip(): void {
    this.tooltip.set(null);
  }

  unusedLabel(unusedPct: number): string {
    return formatDuration(Math.round((unusedPct / 100) * SECONDS_PER_HOUR));
  }
}
