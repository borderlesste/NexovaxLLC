'use client';
import { useEffect } from 'react';

/** Last-resort screen when the root layout itself fails; the error goes to Sentry. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error)).catch(() => {});
  }, [error]);
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, background: '#f6f8fb', color: '#0b1324' }}>
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Algo salió mal / Something went wrong</h1>
          <p style={{ color: '#5b6577', marginBottom: 20 }}>Ya recibimos el aviso del error. Inténtalo de nuevo. / We were notified. Please try again.</p>
          <button onClick={reset} style={{ background: '#0a6cf5', color: '#fff', border: 0, borderRadius: 10, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>Reintentar / Retry</button>
        </div>
      </body>
    </html>
  );
}
