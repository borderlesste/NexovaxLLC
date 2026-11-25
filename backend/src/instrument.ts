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
          for (const h of Object.keys(event.request.headers)) if (/authorization|cookie|secret|token|forwarded|real-ip|client-ip|connecting-ip/i.test(h)) delete event.request.headers[h];
        }
        delete (event.request as any).env;
      }
      // No IP addresses (privacy notice): neither the visitor's nor the one Sentry would infer.
      if (event.user) delete event.user.ip_address;
      return event;
    },
  });
}
