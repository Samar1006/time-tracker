import { Injectable } from '@angular/core';
import * as Sentry from '@sentry/angular';

import { environment } from '../../../environments/environment';
import { AuthUser } from '../models/auth.model';

@Injectable({ providedIn: 'root' })
export class SentryService {
  readonly enabled = environment.sentry.enabled && !!environment.sentry.dsn;

  syncUser(user: AuthUser | null): void {
    if (!this.enabled) {
      return;
    }

    if (user) {
      Sentry.setUser({
        id: user.userId,
        email: user.email,
        username: user.displayName
      });
    } else {
      Sentry.setUser(null);
    }
  }

  /** Sends a test error to Sentry — each click uses a unique message so alert rules fire again. */
  async sendTestError(): Promise<void> {
    if (!this.enabled) {
      console.warn('[Sentry] Disabled — check environment.sentry config');
      return;
    }

    const testId = new Date().toISOString();
    Sentry.captureException(
      new Error(`Sentry test error — Time Tracker demo (${testId})`),
      {
        tags: { source: 'settings-test-button', testId },
        level: 'error'
      }
    );
    await Sentry.flush(3000);
  }

  captureApiFailure(url: string, status: number, message: string): void {
    if (!this.enabled) {
      return;
    }

    Sentry.captureMessage(`API failure: ${message}`, {
      level: 'error',
      tags: { source: 'http-interceptor', status: String(status) },
      extra: { url, status }
    });
  }
}
