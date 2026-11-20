import * as Sentry from '@sentry/nestjs';
import { config } from './config';

/**
 * Error monitoring. Loaded before the app so Sentry sees every module. Off without SENTRY_DSN.
 * Only errors (no performance tracing) and no personal data: request bodies, cookies and
 * Authorization headers are dropped before sending.
 */
const dsn = config.sentryDsn;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT || undefined,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          for (const h of Object.keys(event.request.headers)) if (/authorization|cookie|secret|token/i.test(h)) delete event.request.headers[h];
        }
      }
      return event;
    },
  });
}
