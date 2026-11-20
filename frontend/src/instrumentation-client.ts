// Browser error monitoring. Off without NEXT_PUBLIC_SENTRY_DSN; errors only, no tracing or replays.
// Loaded on demand so visitors don't download the SDK when monitoring is off.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  import('@sentry/nextjs').then((Sentry) =>
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
      tracesSampleRate: 0,
      // Noise from browser extensions and aborted navigations.
      ignoreErrors: ['ResizeObserver loop', 'AbortError', 'Load failed', 'NEXT_REDIRECT', 'NEXT_NOT_FOUND'],
    }),
  );
}
