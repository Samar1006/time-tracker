import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CategoryContextService } from './category-context.service';
import { scheduleBlocksToEvents, type ScheduleBlock } from '../utils/voice-block.util';
import { LiveSpeechRecognition } from '../utils/live-speech-recognition.util';

export interface VoiceLogResult {
  transcript: string;
  added: number;
  parsed: number;
  updated: number;
  /** When a block was moved to another day, jump the dashboard there. */
  navigateToDate?: string;
}

/** Short-lived context so follow-ups like "actually push it back two hours" work. */
export interface VoiceMutationContext {
  lastEventId?: string;
  lastTargetActivity?: string;
  lastStorageDate?: string;
}

interface MutateResponse {
  applied: boolean;
  intent: 'mutate' | 'create';
  reason?: string;
  voiceContext?: VoiceMutationContext | null;
  navigateToDate?: string;
  operation?: { action?: string; deletedCount?: number };
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
  /** Updates while the mic is open; best-effort via browser SpeechRecognition. */
  readonly liveTranscript = signal('');

  /** Remembers the last voice-created or voice-edited block for follow-up commands. */
  private mutationContext: VoiceMutationContext | null = null;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private liveSpeech: LiveSpeechRecognition | null = null;

  clearMutationContext(): void {
    this.mutationContext = null;
  }

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
    this.liveTranscript.set('');

    this.liveSpeech = new LiveSpeechRecognition((text) => this.liveTranscript.set(text));
    if (this.liveSpeech.supported) {
      this.liveSpeech.start();
    }
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
        this.liveSpeech?.stop();
        this.liveSpeech = null;
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
          const mutateResult = await this.tryMutate(
            transcript,
            referenceDate,
            selectedDate,
            timezone,
          );
          if (mutateResult?.applied) {
            resolve({
              transcript,
              added: 0,
              parsed: 0,
              updated: 1,
              navigateToDate: mutateResult.navigateToDate,
            });
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
            const created = await firstValueFrom(
              this.http.post<{ ids?: string[] }>(`${environment.apiUrl}/api/events`, { events }),
            );
            const firstId = created.ids?.[0];
            const firstTitle = events[0]?.title;
            if (firstId && firstTitle) {
              this.mutationContext = {
                lastEventId: firstId,
                lastTargetActivity: firstTitle,
                lastStorageDate: selectedDate,
              };
            }
          }

          resolve({ transcript, added: events.length, parsed: blocks.length, updated: 0 });
        } catch (err) {
          reject(err);
        } finally {
          this.busy.set(false);
          this.liveTranscript.set('');
        }
      };
      rec.stop();
    });
  }

  private async tryMutate(
    transcript: string,
    referenceDate: string,
    viewDate: string,
    timezone: string,
  ): Promise<MutateResponse | null> {
    try {
      const result = await firstValueFrom(
        this.http.post<MutateResponse>(`${environment.apiUrl}/api/schedule/mutate`, {
          transcript,
          referenceDate,
          viewDate,
          timezone,
          voiceContext: this.mutationContext ?? undefined,
        }),
      );
      if (result.applied && result.voiceContext) {
        this.mutationContext = result.voiceContext;
      } else if (
        result.applied
        && (result.operation?.action === 'cancel' || result.operation?.action === 'clear_schedule')
      ) {
        this.mutationContext = result.voiceContext ?? null;
      }
      return result.applied ? result : null;
    } catch (err) {
      if (err instanceof HttpErrorResponse) {
        if (err.status === 422 && err.error?.intent === 'create') {
          return null;
        }
        if (err.status === 422 && err.error?.intent === 'mutate') {
          throw new Error(
            err.error?.reason === 'ambiguous_target'
              ? 'Could not tell which event to update. Name it, e.g. "move my meeting to Friday".'
              : 'Could not update that event on the timeline.',
          );
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
