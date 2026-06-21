import { Component, computed, input, output, signal } from '@angular/core';

import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_LEGEND
} from '../../../../core/constants/categories';
import { ActivityCategory, TimelineBlock, TimelineHour } from '../../../../core/models/timeline.model';
import { formatDuration, formatHourLabel } from '../../../../core/utils/duration.util';
import {
  computeVisibleHourRange,
  formatDisplayDate
} from '../../utils/dashboard-stats.util';

interface TooltipState {
  category: string;
  duration: string;
  activity: string;
  timeRange: string;
  x: number;
  y: number;
}

/** Vertical event block in Apple Calendar–style day column. */
export interface PositionedBlock {
  block: TimelineBlock;
  /** Distance from top of visible range (0–100%). */
  topPct: number;
  /** Height as share of visible range (0–100%). */
  heightPct: number;
  /** Horizontal column for overlapping events (0-based). */
  column: number;
  /** Columns in this overlap cluster. */
  columnCount: number;
}

export interface HourGuide {
  hour: number;
  label: string;
  topPct: number;
}

const MINUTES_PER_HOUR = 60;
const PX_PER_HOUR = 56;

function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * MINUTES_PER_HOUR + d.getMinutes() + d.getSeconds() / 60;
}

/** Rejoin hour-bucket slices that the server split across consecutive hours. */
function mergeContiguousBlocks(blocks: TimelineBlock[]): TimelineBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));
  const merged: TimelineBlock[] = [];

  for (const block of sorted) {
    const last = merged.at(-1);
    if (
      last &&
      last.end === block.start &&
      last.activity === block.activity &&
      last.category === block.category &&
      last.source === block.source
    ) {
      last.end = block.end;
      last.durationSec += block.durationSec;
    } else {
      merged.push({ ...block });
    }
  }

  return merged;
}

/**
 * Overlapping events share horizontal space side-by-side (Apple Calendar day view).
 * Each event gets a column index; width = 1 / max concurrent columns in its cluster.
 */
function layoutVerticalBlocks(
  blocks: TimelineBlock[],
  rangeStartMin: number,
  rangeSpanMin: number
): PositionedBlock[] {
  if (rangeSpanMin <= 0 || blocks.length === 0) {
    return [];
  }

  const items = blocks
    .map((block) => {
      const startMin = minutesSinceMidnight(block.start);
      const endMin = minutesSinceMidnight(block.end);
      const clipStart = Math.max(startMin, rangeStartMin);
      const clipEnd = Math.min(endMin, rangeStartMin + rangeSpanMin);
      if (clipEnd <= clipStart) {
        return null;
      }
      return {
        block,
        startMin: clipStart,
        endMin: clipEnd,
        topPct: ((clipStart - rangeStartMin) / rangeSpanMin) * 100,
        heightPct: ((clipEnd - clipStart) / rangeSpanMin) * 100,
        column: 0,
        columnCount: 1
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const columnEnds: number[] = [];
  for (const item of items) {
    let column = 0;
    while (column < columnEnds.length && columnEnds[column] > item.startMin + 0.01) {
      column += 1;
    }
    if (column === columnEnds.length) {
      columnEnds.push(0);
    }
    columnEnds[column] = item.endMin;
    item.column = column;
  }

  for (const item of items) {
    let maxColumn = item.column;
    for (const other of items) {
      if (other.startMin < item.endMin - 0.01 && other.endMin > item.startMin + 0.01) {
        maxColumn = Math.max(maxColumn, other.column);
      }
    }
    item.columnCount = maxColumn + 1;
  }

  return items.map((item) => ({
    block: item.block,
    topPct: item.topPct,
    heightPct: Math.max(item.heightPct, 0.6),
    column: item.column,
    columnCount: item.columnCount
  }));
}

@Component({
  selector: 'app-timeline-chart',
  templateUrl: './timeline-chart.component.html',
  styleUrl: './timeline-chart.component.scss'
})
export class TimelineChartComponent {
  readonly hours = input.required<TimelineHour[]>();
  readonly date = input.required<string>();

  readonly prevDay = output<void>();
  readonly nextDay = output<void>();
  readonly selectDate = output<string>();

  readonly tooltip = signal<TooltipState | null>(null);
  readonly categoryLegend = CATEGORY_LEGEND;
  readonly categoryLabels = CATEGORY_LABELS;

  readonly displayTitle = computed(() => formatDisplayDate(this.date()));

  readonly visibleRange = computed(() =>
    computeVisibleHourRange(this.hours(), this.date())
  );

  readonly canvasHeightPx = computed(() => {
    const { startHour, endHour } = this.visibleRange();
    return (endHour - startHour + 1) * PX_PER_HOUR;
  });

  readonly hourGuides = computed((): HourGuide[] => {
    const { startHour, endHour } = this.visibleRange();
    const spanHours = endHour - startHour + 1;
    const guides: HourGuide[] = [];

    for (let hour = startHour; hour <= endHour; hour += 1) {
      guides.push({
        hour,
        label: formatHourLabel(hour),
        topPct: ((hour - startHour) / spanHours) * 100
      });
    }

    return guides;
  });

  readonly halfHourStepPct = computed(() => {
    const { startHour, endHour } = this.visibleRange();
    const spanHours = endHour - startHour + 1;
    return (0.5 / spanHours) * 100;
  });

  readonly rangeEndHour = computed(() => this.visibleRange().endHour);

  readonly positionedBlocks = computed((): PositionedBlock[] => {
    const { startHour, endHour } = this.visibleRange();
    const rangeStartMin = startHour * MINUTES_PER_HOUR;
    const rangeSpanMin = (endHour - startHour + 1) * MINUTES_PER_HOUR;
    const allBlocks = mergeContiguousBlocks(this.hours().flatMap((h) => h.blocks));

    return layoutVerticalBlocks(allBlocks, rangeStartMin, rangeSpanMin);
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

  blockLeftPct(positioned: PositionedBlock): number {
    const gap = 0.8;
    const colWidth = (100 - gap * (positioned.columnCount - 1)) / positioned.columnCount;
    return positioned.column * (colWidth + gap);
  }

  blockWidthPct(positioned: PositionedBlock): number {
    const gap = 0.8;
    return (100 - gap * (positioned.columnCount - 1)) / positioned.columnCount;
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

  onDatePick(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) {
      this.selectDate.emit(value);
    }
  }
}
