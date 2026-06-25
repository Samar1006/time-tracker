import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { MonthSummaryResponse, TimelineResponse } from '../models/timeline.model';

export interface EventPatchPayload {
  timestamp: string;
  durationSec: number;
  title?: string;
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

export interface CategorizeActivityResponse {
  category: string;
  confidence: number;
  method: string;
  matched?: string[];
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

  categorizeActivity(text: string): Observable<CategorizeActivityResponse> {
    return this.http.post<CategorizeActivityResponse>(
      `${environment.apiUrl}/api/categorize/activity`,
      { text, useVector: false }
    );
  }

  deleteEvent(eventId: string, date: string): Observable<{ deleted: boolean; eventId: string }> {
    const params = new HttpParams().set('date', date);
    return this.http.delete<{ deleted: boolean; eventId: string }>(
      `${environment.apiUrl}/api/events/${encodeURIComponent(eventId)}`,
      { params }
    );
  }
}
