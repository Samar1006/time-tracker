import * as Sentry from '@sentry/angular';

import { environment } from '../../../environments/environment';

export function initSentry(): void {
  if (!environment.sentry.enabled || !environment.sentry.dsn) {
    return;
  }

  Sentry.init({
    dsn: environment.sentry.dsn,
    environment: environment.sentry.environment,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers['Authorization'];
        delete event.request.headers['authorization'];
      }
      return event;
    }
  });
}
