import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { MonthSummaryResponse, TimelineResponse } from '../models/timeline.model';

@Injectable({ providedIn: 'root' })
export class TimelineService {
  private readonly http = inject(HttpClient);

  getTimeline(userId: string, date: string): Observable<TimelineResponse> {
    const params = new HttpParams().set('userId', userId).set('date', date);
    return this.http.get<TimelineResponse>(`${environment.apiUrl}/api/timeline`, { params });
  }

  getMonthSummary(userId: string, month: string): Observable<MonthSummaryResponse> {
    const params = new HttpParams().set('userId', userId).set('month', month);
    return this.http.get<MonthSummaryResponse>(`${environment.apiUrl}/api/timeline/summary`, {
      params
    });
  }
}
