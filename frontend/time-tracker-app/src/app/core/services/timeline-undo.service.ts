import { Injectable, computed, signal } from '@angular/core';

export interface UndoEntry {
  label: string;
  viewDate: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_STACK_DEPTH = 50;
const STATUS_FADE_MS = 3_000;

@Injectable({ providedIn: 'root' })
export class TimelineUndoService {
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  readonly statusMessage = signal<string | null>(null);
  readonly canUndo = computed(() => this.undoStack.length > 0);
  readonly canRedo = computed(() => this.redoStack.length > 0);

  record(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_STACK_DEPTH) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  peekUndo(): UndoEntry | undefined {
    return this.undoStack.at(-1);
  }

  peekRedo(): UndoEntry | undefined {
    return this.redoStack.at(-1);
  }

  async undo(): Promise<UndoEntry | null> {
    const entry = this.undoStack.pop();
    if (!entry) {
      return null;
    }

    try {
      await entry.undo();
      this.redoStack.push(entry);
      if (this.redoStack.length > MAX_STACK_DEPTH) {
        this.redoStack.shift();
      }
      this.showStatus(`Undid ${entry.label.toLowerCase()}`);
      return entry;
    } catch (err) {
      this.undoStack.push(entry);
      throw err;
    }
  }

  async redo(): Promise<UndoEntry | null> {
    const entry = this.redoStack.pop();
    if (!entry) {
      return null;
    }

    try {
      await entry.redo();
      this.undoStack.push(entry);
      if (this.undoStack.length > MAX_STACK_DEPTH) {
        this.undoStack.shift();
      }
      this.showStatus(`Redid ${entry.label.toLowerCase()}`);
      return entry;
    } catch (err) {
      this.redoStack.push(entry);
      throw err;
    }
  }

  private showStatus(message: string): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
    }
    this.statusMessage.set(message);
    this.statusTimer = setTimeout(() => {
      this.statusMessage.set(null);
      this.statusTimer = null;
    }, STATUS_FADE_MS);
  }
}
