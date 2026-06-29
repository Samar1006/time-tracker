import { Injectable } from '@angular/core';

const STORAGE_KEY = 'focusflow-timeline-viewport';

export interface TimelineDateViewport {
  scrollRatio: number;
  cursorMin: number;
}

interface StoredTimelineViewport {
  v: 1;
  zoom: number;
  selectedDate: string;
  dates: Record<string, TimelineDateViewport>;
}

const DEFAULT_STATE: StoredTimelineViewport = {
  v: 1,
  zoom: 1,
  selectedDate: '',
  dates: {}
};

@Injectable({ providedIn: 'root' })
export class TimelineViewportStorageService {
  private state: StoredTimelineViewport = this.load();

  getZoom(): number | null {
    const zoom = this.state.zoom;
    return Number.isFinite(zoom) && zoom > 0 ? zoom : null;
  }

  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom) || zoom <= 0) {
      return;
    }
    this.state = { ...this.state, zoom };
    this.persist();
  }

  getSelectedDate(): string | null {
    const date = this.state.selectedDate;
    return this.isValidDate(date) ? date : null;
  }

  setSelectedDate(date: string): void {
    if (!this.isValidDate(date)) {
      return;
    }
    this.state = { ...this.state, selectedDate: date };
    this.persist();
  }

  getDateViewport(date: string): TimelineDateViewport | null {
    if (!this.isValidDate(date)) {
      return null;
    }
    const entry = this.state.dates[date];
    if (!entry) {
      return null;
    }
    const scrollRatio = Number(entry.scrollRatio);
    const cursorMin = Number(entry.cursorMin);
    if (!Number.isFinite(scrollRatio) || !Number.isFinite(cursorMin)) {
      return null;
    }
    return {
      scrollRatio: Math.min(1, Math.max(0, scrollRatio)),
      cursorMin: Math.min(24 * 60, Math.max(0, cursorMin))
    };
  }

  saveDateViewport(date: string, viewport: TimelineDateViewport): void {
    this.patchDateViewport(date, viewport);
  }

  /** Merge partial updates so scroll saves do not clobber cursor and vice versa. */
  patchDateViewport(date: string, patch: Partial<TimelineDateViewport>): void {
    if (!this.isValidDate(date)) {
      return;
    }

    const existing = this.getDateViewport(date);
    const scrollRatio = Number(patch.scrollRatio ?? existing?.scrollRatio ?? 0);
    const cursorMin = Number(patch.cursorMin ?? existing?.cursorMin ?? 0);
    if (!Number.isFinite(scrollRatio) || !Number.isFinite(cursorMin)) {
      return;
    }

    this.state = {
      ...this.state,
      dates: {
        ...this.state.dates,
        [date]: {
          scrollRatio: Math.min(1, Math.max(0, scrollRatio)),
          cursorMin: Math.min(24 * 60, Math.max(0, cursorMin))
        }
      }
    };
    this.persist();
  }

  private isValidDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  private load(): StoredTimelineViewport {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...DEFAULT_STATE };
      }
      const parsed = JSON.parse(raw) as Partial<StoredTimelineViewport>;
      if (parsed.v !== 1 || typeof parsed !== 'object' || parsed === null) {
        return { ...DEFAULT_STATE };
      }
      return {
        v: 1,
        zoom: Number.isFinite(Number(parsed.zoom)) ? Number(parsed.zoom) : 1,
        selectedDate:
          typeof parsed.selectedDate === 'string' ? parsed.selectedDate : '',
        dates:
          parsed.dates && typeof parsed.dates === 'object' ? parsed.dates : {}
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }
}
