import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { MonthSummaryResponse, TimelineResponse } from '../models/timeline.model';

export interface EventPatchPayload {
  timestamp: string;
  durationSec: number;
  metadata?: { localDate: string; endLocalDate?: string };
}

export interface EventPatchResponse {
  event: {
    id: string;
    timestamp: string;
    durationSec: number;
    metadata?: Record<string, unknown>;
  };
}

export interface CreateEventPayload {
  timestamp: string;
  type: string;
  title: string;
  durationSec: number;
  metadata?: Record<string, unknown>;
}

export interface CreateEventResponse {
  accepted: number;
  ids: string[];
}

@Injectable({ providedIn: 'root' })
export class TimelineService {
  private readonly http = inject(HttpClient);

  getTimeline(userId: string, date: string): Observable<TimelineResponse> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = new HttpParams()
      .set('userId', userId)
      .set('date', date)
      .set('timezone', timezone);
    return this.http.get<TimelineResponse>(`${environment.apiUrl}/api/timeline`, { params });
  }

  getMonthSummary(userId: string, month: string): Observable<MonthSummaryResponse> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = new HttpParams()
      .set('userId', userId)
      .set('month', month)
      .set('timezone', timezone);
    return this.http.get<MonthSummaryResponse>(`${environment.apiUrl}/api/timeline/summary`, {
      params
    });
  }

  updateEvent(eventId: string, payload: EventPatchPayload): Observable<EventPatchResponse> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const params = new HttpParams().set('timezone', timezone);
    return this.http.patch<EventPatchResponse>(
      `${environment.apiUrl}/api/events/${encodeURIComponent(eventId)}`,
      payload,
      { params }
    );
  }

  createEvent(payload: CreateEventPayload): Observable<CreateEventResponse> {
    return this.http.post<CreateEventResponse>(`${environment.apiUrl}/api/events`, payload);
  }
}
