import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ExtensionStatus, MonitorStatusResponse } from '../models/monitor.model';

@Injectable({ providedIn: 'root' })
export class MonitorService {
  private readonly http = inject(HttpClient);

  getStatus(userId: string, date: string): Observable<MonitorStatusResponse> {
    const params = new HttpParams().set('userId', userId).set('date', date);
    return this.http.get<MonitorStatusResponse>(`${environment.apiUrl}/api/monitor/status`, {
      params
    });
  }

  /** Check extension bridge once (no tight polling). */
  watchExtensionStatus(): Observable<ExtensionStatus> {
    return new Observable<ExtensionStatus>((subscriber) => {
      const domReady =
        document.documentElement.getAttribute('data-tracker-extension') === 'ready';

      const timeoutId = window.setTimeout(() => {
        subscriber.next({ connected: domReady });
        subscriber.complete();
      }, 400);

      const onMessage = (event: MessageEvent) => {
        if (event.source !== window || event.data?.type !== 'time-tracker-status') return;
        window.clearTimeout(timeoutId);
        window.removeEventListener('message', onMessage);
        subscriber.next(event.data as ExtensionStatus);
        subscriber.complete();
      };

      window.addEventListener('message', onMessage);
      window.postMessage({ type: 'time-tracker-ping' }, window.location.origin);
    });
  }

  formatLastSync(iso: string | null): string {
    if (!iso) return 'Never';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Never';
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }
}
