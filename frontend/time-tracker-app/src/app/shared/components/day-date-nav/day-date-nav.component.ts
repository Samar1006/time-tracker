import {
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal
} from '@angular/core';

import {
  buildCalendarGrid,
  formatMonthLabel,
  monthKeyFromDate,
  shiftMonth
} from '../../../features/dashboard/utils/calendar.util';
import { formatDisplayDate, toDateInputValue } from '../../../features/dashboard/utils/dashboard-stats.util';

@Component({
  selector: 'app-day-date-nav',
  templateUrl: './day-date-nav.component.html',
  styleUrl: './day-date-nav.component.scss'
})
export class DayDateNavComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly date = input.required<string>();
  readonly activityTotalsByDate = input<Map<string, number>>(new Map());
  readonly showTodayButton = input(false);

  readonly prevDay = output<void>();
  readonly nextDay = output<void>();
  readonly selectDate = output<string>();

  readonly calendarOpen = signal(false);
  readonly popupMonth = signal(monthKeyFromDate(toDateInputValue(new Date())));
  readonly popupWeekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  readonly displayTitle = computed(() => formatDisplayDate(this.date()));
  readonly popupMonthLabel = computed(() => formatMonthLabel(this.popupMonth()));
  readonly popupCells = computed(() =>
    buildCalendarGrid(this.popupMonth(), this.date(), this.activityTotalsByDate())
  );
  readonly isToday = computed(() => this.date() === toDateInputValue(new Date()));

  onDatePick(pickedDate: string): void {
    this.selectDate.emit(pickedDate);
    this.calendarOpen.set(false);
  }

  toggleCalendar(event: MouseEvent): void {
    event.stopPropagation();
    const opening = !this.calendarOpen();
    if (opening) {
      this.popupMonth.set(monthKeyFromDate(this.date()));
    }
    this.calendarOpen.set(opening);
  }

  previousPopupMonth(event: MouseEvent): void {
    event.stopPropagation();
    this.popupMonth.update((month) => shiftMonth(month, -1));
  }

  nextPopupMonth(event: MouseEvent): void {
    event.stopPropagation();
    this.popupMonth.update((month) => shiftMonth(month, 1));
  }

  goToToday(event: MouseEvent): void {
    event.stopPropagation();
    this.selectDate.emit(toDateInputValue(new Date()));
    this.calendarOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  closeCalendarOnOutsideClick(event: MouseEvent): void {
    if (!this.calendarOpen()) {
      return;
    }
    if (this.host.nativeElement.contains(event.target as Node)) {
      return;
    }
    this.calendarOpen.set(false);
  }
}
