import { Component, computed, input } from '@angular/core';

import { ActivityDonutSlice } from '../../../dashboard/utils/dashboard-stats.util';
import { formatDuration } from '../../../../core/utils/duration.util';

export interface DonutSegment {
  label: string;
  seconds: number;
  percent: number;
  color: string;
  path: string;
}

@Component({
  selector: 'app-activity-donut-chart',
  templateUrl: './activity-donut-chart.component.html',
  styleUrl: './activity-donut-chart.component.scss'
})
export class ActivityDonutChartComponent {
  readonly slices = input.required<ActivityDonutSlice[]>();
  readonly formatDuration = formatDuration;

  private readonly cx = 120;
  private readonly cy = 120;
  private readonly outerRadius = 100;
  private readonly innerRadius = 62;

  readonly segments = computed(() => this.buildSegments(this.slices()));

  private buildSegments(slices: ActivityDonutSlice[]): DonutSegment[] {
    if (!slices.length) {
      return [];
    }

    let cursor = 0;
    return slices.map((slice) => {
      const sweep = (slice.percent / 100) * 360;
      const start = cursor;
      const end = cursor + sweep;
      cursor = end;

      return {
        ...slice,
        path: this.describeDonutSlice(start, end)
      };
    });
  }

  private describeDonutSlice(startAngle: number, endAngle: number): string {
    if (endAngle - startAngle >= 359.99) {
      endAngle = startAngle + 359.99;
    }

    const outerStart = this.polar(this.outerRadius, endAngle);
    const outerEnd = this.polar(this.outerRadius, startAngle);
    const innerEnd = this.polar(this.innerRadius, startAngle);
    const innerStart = this.polar(this.innerRadius, endAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${this.outerRadius} ${this.outerRadius} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A ${this.innerRadius} ${this.innerRadius} 0 ${largeArc} 1 ${innerStart.x} ${innerStart.y}`,
      'Z'
    ].join(' ');
  }

  private polar(radius: number, angleDeg: number): { x: number; y: number } {
    const radians = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: this.cx + radius * Math.cos(radians),
      y: this.cy + radius * Math.sin(radians)
    };
  }
}
