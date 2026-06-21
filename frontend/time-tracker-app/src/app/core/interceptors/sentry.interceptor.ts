import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { SentryService } from '../services/sentry.service';

export const sentryInterceptor: HttpInterceptorFn = (req, next) => {
  const sentry = inject(SentryService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (sentry.enabled && error instanceof HttpErrorResponse) {
        const shouldReport = error.status === 0 || error.status >= 500;
        if (shouldReport) {
          sentry.captureApiFailure(
            req.url,
            error.status,
            error.error?.error ?? error.message ?? 'HTTP error'
          );
        }
      }
      return throwError(() => error);
    })
  );
};
