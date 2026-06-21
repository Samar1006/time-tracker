export interface CalendarCell {
  date: string | null;
  day: number | null;
  totalTrackedSec: number;
  isToday: boolean;
  isSelected: boolean;
  isCurrentMonth: boolean;
}

export function monthKeyFromDate(dateString: string): string {
  return dateString.slice(0, 7);
}

export function buildCalendarGrid(
  month: string,
  selectedDate: string,
  totalsByDate: Map<string, number>
): CalendarCell[] {
  const [year, monthNum] = month.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, monthNum - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const startOffset = firstDay.getUTCDay();
  const today = new Date().toISOString().slice(0, 10);
  const cells: CalendarCell[] = [];

  for (let i = 0; i < startOffset; i += 1) {
    cells.push({
      date: null,
      day: null,
      totalTrackedSec: 0,
      isToday: false,
      isSelected: false,
      isCurrentMonth: false
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    cells.push({
      date,
      day,
      totalTrackedSec: totalsByDate.get(date) ?? 0,
      isToday: date === today,
      isSelected: date === selectedDate,
      isCurrentMonth: true
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      date: null,
      day: null,
      totalTrackedSec: 0,
      isToday: false,
      isSelected: false,
      isCurrentMonth: false
    });
  }

  return cells;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNum] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNum - 1 + delta, 1));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function formatMonthLabel(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, monthNum - 1, 1))
  );
}
