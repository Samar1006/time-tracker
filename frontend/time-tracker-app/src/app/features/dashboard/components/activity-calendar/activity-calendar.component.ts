import { Component, computed, input, output } from '@angular/core';

import { formatDuration } from '../../../../core/utils/duration.util';
import { CalendarCell } from '../../utils/calendar.util';

@Component({
  selector: 'app-activity-calendar',
  templateUrl: './activity-calendar.component.html',
  styleUrl: './activity-calendar.component.scss'
})
export class ActivityCalendarComponent {
  readonly monthLabel = input.required<string>();
  readonly cells = input.required<CalendarCell[]>();
  readonly weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  readonly prevMonth = output<void>();
  readonly nextMonth = output<void>();
  readonly selectDate = output<string>();

  intensityClass(seconds: number): string {
    if (seconds <= 0) return 'activity-calendar__dot--none';
    if (seconds < 1800) return 'activity-calendar__dot--low';
    if (seconds < 7200) return 'activity-calendar__dot--medium';
    return 'activity-calendar__dot--high';
  }

  tooltip(cell: CalendarCell): string {
    if (!cell.date) return '';
    if (cell.totalTrackedSec <= 0) return `${cell.date}: no tracked time`;
    return `${cell.date}: ${formatDuration(cell.totalTrackedSec)}`;
  }

  onSelect(cell: CalendarCell): void {
    if (cell.date) {
      this.selectDate.emit(cell.date);
    }
  }
}
