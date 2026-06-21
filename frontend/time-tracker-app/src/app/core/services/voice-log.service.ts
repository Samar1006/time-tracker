import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';

/** A parsed schedule block as returned by POST /api/schedule/parse. */
interface ScheduleBlock {
  date?: string | null;
  endDate?: string | null;
  start?: string | null;
  end?: string | null;
  durationMin?: number | null;
  activity?: string;
  category?: string;
}

/** A raw activity event as accepted by POST /api/events. */
interface RawEvent {
  timestamp: string;
  type: string;
  title: string;
  durationSec: number;
  metadata?: Record<string, unknown>;
}

export interface VoiceLogResult {
  transcript: string;
  added: number;
  parsed: number;
}

/**
 * Records the mic, transcribes it (Deepgram via /api/transcribe), parses the
 * transcript into schedule blocks (/api/schedule/parse), and stores them as
 * activity events (/api/events) so they appear on the timeline.
 */
@Injectable({ providedIn: 'root' })
export class VoiceLogService {
  private readonly http = inject(HttpClient);

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
            resolve({ transcript: '', added: 0, parsed: 0 });
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
            resolve({ transcript: '', added: 0, parsed: 0 });
            return;
          }

          const referenceDate = `${selectedDate}T12:00:00.000Z`;
          const parsed = await firstValueFrom(
            this.http.post<{ blocks: ScheduleBlock[] }>(`${environment.apiUrl}/api/schedule/parse`, {
              transcript,
              referenceDate,
              useLLM: true,
            }),
          );

          const blocks = parsed.blocks ?? [];
          const events = blocks
            .map((b) => blockToEvent(b, selectedDate))
            .filter((e): e is RawEvent => e !== null);

          if (events.length) {
            await firstValueFrom(
              this.http.post(`${environment.apiUrl}/api/events`, { events }),
            );
          }

          resolve({ transcript, added: events.length, parsed: blocks.length });
        } catch (err) {
          reject(err);
        } finally {
          this.busy.set(false);
        }
      };
      rec.stop();
    });
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

/** "9:00 AM" -> minutes since midnight. Returns null if unparseable. */
function parseClock(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function blockToEvent(block: ScheduleBlock, fallbackDate: string): RawEvent | null {
  const startMin = parseClock(block.start);
  if (startMin == null) return null;

  const date = block.date || fallbackDate;
  const endMin = parseClock(block.end);
  let durationSec: number;
  if (block.durationMin != null && block.durationMin > 0) {
    durationSec = Math.max(60, Math.round(block.durationMin * 60));
  } else if (endMin != null) {
    let span = endMin - startMin;
    if (span <= 0 && block.endDate && block.endDate !== date) {
      span = endMin + 24 * 60 - startMin;
    }
    durationSec = Math.max(60, span * 60);
  } else {
    durationSec = 30 * 60;
  }

  const hh = String(Math.floor(startMin / 60)).padStart(2, '0');
  const mm = String(startMin % 60).padStart(2, '0');
  const timestamp = `${date}T${hh}:${mm}:00.000Z`;

  return {
    timestamp,
    type: 'voice',
    title: block.activity?.trim() || 'Activity',
    durationSec,
    metadata: { category: block.category, sourceClient: 'dashboard-voice' },
  };
}
