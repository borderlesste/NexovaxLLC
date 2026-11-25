import * as Sentry from '@sentry/nextjs';

/** Server-side error monitoring (pages rendered on Vercel). Off without SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN. */
export async function register() {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
    tracesSampleRate: 0,
    // No IP addresses or other personal data (privacy notice).
    beforeSend(event) {
      if (event.user) delete event.user.ip_address;
      if (event.request?.headers) for (const h of Object.keys(event.request.headers)) if (/cookie|authorization|forwarded|real-ip|client-ip|connecting-ip/i.test(h)) delete event.request.headers[h];
      return event;
    },
  });
}

export const onRequestError = Sentry.captureRequestError;
