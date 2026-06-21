import { Component, computed, input, signal } from '@angular/core';

import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_LEGEND
} from '../../../../core/constants/categories';
import { TimelineBlock, TimelineHour } from '../../../../core/models/timeline.model';
import { formatDuration, formatHourLabel } from '../../../../core/utils/duration.util';

interface TooltipState {
  activity: string;
  duration: string;
  x: number;
  y: number;
}

@Component({
  selector: 'app-timeline-chart',
  templateUrl: './timeline-chart.component.html',
  styleUrl: './timeline-chart.component.scss'
})
export class TimelineChartComponent {
  readonly hours = input.required<TimelineHour[]>();
  readonly startHour = input(8);
  readonly endHour = input(18);
  readonly title = input("Today's timeline");
  readonly subtitle = input('Hour-by-hour activity breakdown');

  readonly tooltip = signal<TooltipState | null>(null);
  readonly categoryLegend = CATEGORY_LEGEND;
  readonly categoryLabels = CATEGORY_LABELS;

  readonly maxTrackedSec = computed(() => {
    const peak = Math.max(...this.hours().map((hour) => hour.totalTrackedSec), 0);
    return peak > 0 ? peak : 3600;
  });

  hourLabel(hour: number): string {
    return formatHourLabel(hour);
  }

  segmentHeight(durationSec: number, totalTrackedSec: number): string {
    if (totalTrackedSec <= 0) {
      return '0%';
    }

    const ratio = durationSec / this.maxTrackedSec();
    return `${Math.max(ratio * 100, 4)}%`;
  }

  categoryColor(category: TimelineBlock['category']): string {
    return CATEGORY_COLORS[category];
  }

  showTooltip(block: TimelineBlock, event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    this.tooltip.set({
      activity: block.activity,
      duration: formatDuration(block.durationSec),
      x: rect.left + rect.width / 2,
      y: rect.top - 8
    });
  }

  hideTooltip(): void {
    this.tooltip.set(null);
  }

  segmentLabel(block: TimelineBlock): string {
    const source = block.source === 'voice' ? 'AI parsed' : block.source;
    return `${block.activity}, ${formatDuration(block.durationSec)}, ${source}`;
  }
}
