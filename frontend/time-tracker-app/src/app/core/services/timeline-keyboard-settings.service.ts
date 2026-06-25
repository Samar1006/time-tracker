import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'focusflow-vim-motions';

@Injectable({ providedIn: 'root' })
export class TimelineKeyboardSettingsService {
  readonly vimMotionsEnabled = signal(this.readStored());

  setVimMotionsEnabled(enabled: boolean): void {
    this.vimMotionsEnabled.set(enabled);
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // ignore storage errors (private mode, etc.)
    }
  }

  private readStored(): boolean {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === '0') {
        return false;
      }
      if (saved === '1') {
        return true;
      }
    } catch {
      // ignore
    }
    return true;
  }
}
