import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CategoryContextService } from './category-context.service';
import { scheduleBlocksToEvents, type ScheduleBlock } from '../utils/voice-block.util';

export interface VoiceLogResult {
  transcript: string;
  added: number;
  parsed: number;
  updated: number;
}

interface MutateResponse {
  applied: boolean;
  intent: 'mutate' | 'create';
  reason?: string;
}

/**
 * Records the mic, transcribes it (Deepgram via /api/transcribe), then either
 * mutates an existing block (/api/schedule/mutate) or creates new events
 * (/api/schedule/parse → /api/events).
 */
@Injectable({ providedIn: 'root' })
export class VoiceLogService {
  private readonly http = inject(HttpClient);
  private readonly categoryContext = inject(CategoryContextService);

  readonly recording = signal(false);
  readonly busy = signal(false);

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async toggle(selectedDate: string): Promise<VoiceLogResult | null> {
    if (this.recording()) {
      return this.stopAndProcess(selectedDate);
    }
    await this.start();
    return null;
  }

  private async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recorder = new MediaRecorder(stream);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.recording.set(true);
  }

  private stopAndProcess(selectedDate: string): Promise<VoiceLogResult> {
    return new Promise<VoiceLogResult>((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) {
        reject(new Error('Not recording'));
        return;
      }
      rec.onstop = async () => {
        this.recording.set(false);
        this.busy.set(true);
        try {
          const blob = new Blob(this.chunks, { type: rec.mimeType });
          rec.stream.getTracks().forEach((t) => t.stop());

          if (blob.size < 1000) {
            resolve({ transcript: '', added: 0, parsed: 0, updated: 0 });
            return;
          }

          const audioBase64 = await blobToBase64(blob);
          const tr = await firstValueFrom(
            this.http.post<{ transcript: string }>(`${environment.apiUrl}/api/transcribe`, {
              audioBase64,
            }),
          );
          const transcript = (tr.transcript ?? '').trim();
          if (!transcript) {
            resolve({ transcript: '', added: 0, parsed: 0, updated: 0 });
            return;
          }

          const referenceDate = `${selectedDate}T12:00:00.000Z`;
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const mutated = await this.tryMutate(transcript, referenceDate, selectedDate, timezone);
          if (mutated) {
            resolve({ transcript, added: 0, parsed: 0, updated: 1 });
            return;
          }

          const categoryContext = this.categoryContext.toApiContext();
          const parsed = await firstValueFrom(
            this.http.post<{ blocks: ScheduleBlock[] }>(`${environment.apiUrl}/api/schedule/parse`, {
              transcript,
              referenceDate,
              useLLM: true,
              ...(categoryContext.length ? { categoryContext } : {}),
            }),
          );

          const blocks = parsed.blocks ?? [];
          const events = scheduleBlocksToEvents(blocks, selectedDate);

          if (events.length) {
            await firstValueFrom(
              this.http.post(`${environment.apiUrl}/api/events`, { events }),
            );
          }

          resolve({ transcript, added: events.length, parsed: blocks.length, updated: 0 });
        } catch (err) {
          reject(err);
        } finally {
          this.busy.set(false);
        }
      };
      rec.stop();
    });
  }

  /** Returns true when a mutation was applied. */
  private async tryMutate(
    transcript: string,
    referenceDate: string,
    viewDate: string,
    timezone: string,
  ): Promise<boolean> {
    try {
      const result = await firstValueFrom(
        this.http.post<MutateResponse>(`${environment.apiUrl}/api/schedule/mutate`, {
          transcript,
          referenceDate,
          viewDate,
          timezone,
        }),
      );
      return result.applied === true;
    } catch (err) {
      if (err instanceof HttpErrorResponse) {
        if (err.status === 422 && err.error?.intent === 'create') {
          return false;
        }
        if (err.status === 404) {
          throw new Error(
            err.error?.reason === 'no_matching_event'
              ? 'Could not find a matching event to update. Try naming it, e.g. "my meeting".'
              : 'No events on this day to update.',
          );
        }
      }
      throw err;
    }
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
