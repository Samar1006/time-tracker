import { Component, computed, input, signal } from '@angular/core';

import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_LEGEND
} from '../../../../core/constants/categories';
import { ActivityCategory, TimelineBlock, TimelineHour } from '../../../../core/models/timeline.model';
import { formatDuration, formatHourLabel } from '../../../../core/utils/duration.util';
import {
  computeVisibleHourRange,
  formatDisplayDate,
  getVisibleHours
} from '../../utils/dashboard-stats.util';

interface TooltipState {
  category: string;
  duration: string;
  activity: string;
  timeRange: string;
  x: number;
  y: number;
}

/** Block positioned within an hour row by clock time (start/end). */
export interface PositionedBlock {
  block: TimelineBlock;
  /** Offset from hour :00 as a percentage of the 60-minute row (0–100). */
  leftPct: number;
  /** Width as a percentage of the hour row (0–100). */
  widthPct: number;
  /** Vertical lane index when blocks overlap in the same hour. */
  lane: number;
  /** Total lanes needed for this hour (for equal-height stacking). */
  laneCount: number;
}

export interface HourRow {
  hour: number;
  label: string;
  totalTrackedSec: number;
  blocks: PositionedBlock[];
}

const SECONDS_PER_HOUR = 3600;
const MS_PER_HOUR = SECONDS_PER_HOUR * 1000;

/**
 * Overlapping blocks in the same hour are stacked vertically (calendar-style lanes).
 * Each lane gets an equal share of the row height; blocks never shrink horizontally.
 */
function assignStackLanes(
  blocks: Omit<PositionedBlock, 'lane' | 'laneCount'>[]
): PositionedBlock[] {
  const sorted = [...blocks].sort(
    (a, b) => a.leftPct - b.leftPct || a.block.start.localeCompare(b.block.start)
  );

  const laneEnds: number[] = [];
  const positioned: PositionedBlock[] = [];

  for (const entry of sorted) {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] > entry.leftPct + 0.05) {
      lane += 1;
    }
    if (lane === laneEnds.length) {
      laneEnds.push(0);
    }
    laneEnds[lane] = entry.leftPct + entry.widthPct;
    positioned.push({ ...entry, lane, laneCount: 0 });
  }

  const laneCount = Math.max(1, laneEnds.length);
  return positioned.map((entry) => ({ ...entry, laneCount }));
}

function blockLayoutInHour(
  block: TimelineBlock,
  hour: number,
  dateStr: string
): { leftPct: number; widthPct: number } | null {
  const blockStartMs = new Date(block.start).getTime();
  const blockEndMs = new Date(block.end).getTime();
  if (!Number.isFinite(blockStartMs) || !Number.isFinite(blockEndMs) || blockEndMs <= blockStartMs) {
    return null;
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const hourStartMs = new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
  const hourEndMs = hourStartMs + MS_PER_HOUR;

  const clipStartMs = Math.max(blockStartMs, hourStartMs);
  const clipEndMs = Math.min(blockEndMs, hourEndMs);
  if (clipEndMs <= clipStartMs) {
    return null;
  }

  const offsetSec = (clipStartMs - hourStartMs) / 1000;
  const durationSec = (clipEndMs - clipStartMs) / 1000;

  return {
    leftPct: (offsetSec / SECONDS_PER_HOUR) * 100,
    widthPct: (durationSec / SECONDS_PER_HOUR) * 100
  };
}

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

  readonly displayTitle = computed(() => formatDisplayDate(this.date()));

  readonly visibleHours = computed(() => {
    const { startHour, endHour } = computeVisibleHourRange(this.hours(), this.date());
    return getVisibleHours(this.hours(), startHour, endHour);
  });

  readonly hourRows = computed(() => {
    const dateStr = this.date();
    const rows: HourRow[] = [];

    for (const bucket of this.visibleHours()) {
      const rawBlocks: Omit<PositionedBlock, 'lane' | 'laneCount'>[] = [];

      for (const block of bucket.blocks) {
        const layout = blockLayoutInHour(block, bucket.hour, dateStr);
        if (!layout || layout.widthPct <= 0) {
          continue;
        }
        rawBlocks.push({ block, ...layout });
      }

      rows.push({
        hour: bucket.hour,
        label: formatHourLabel(bucket.hour),
        totalTrackedSec: bucket.totalTrackedSec,
        blocks: assignStackLanes(rawBlocks)
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

  showBlockTooltip(positioned: PositionedBlock, event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const { block } = positioned;

    this.tooltip.set({
      category: CATEGORY_LABELS[block.category],
      duration: formatDuration(block.durationSec),
      activity: block.activity,
      timeRange: this.formatTimeRange(block),
      x: rect.left + rect.width / 2,
      y: rect.top - 8
    });
  }

  hideTooltip(): void {
    this.tooltip.set(null);
  }

  blockTrackKey(positioned: PositionedBlock): string {
    const { block } = positioned;
    return `${block.start}|${block.end}|${block.activity}|${block.category}`;
  }
}
