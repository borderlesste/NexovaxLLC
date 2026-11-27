'use client';
import { useEffect, useState } from 'react';
import { isLocale, LOCALE_COOKIE, type Locale } from '@/lib/i18n/core';

/** The root layout (and with it the dictionaries) failed, so this screen carries its own few strings. */
const COPY: Record<Locale, [title: string, body: string, retry: string]> = {
  es: ['Algo salió mal', 'Ya recibimos el aviso del error. Inténtalo de nuevo.', 'Reintentar'],
  en: ['Something went wrong', 'We were notified of the error. Please try again.', 'Retry'],
  fr: ['Une erreur s’est produite', 'Nous avons été informés de l’erreur. Veuillez réessayer.', 'Réessayer'],
  ht: ['Yon bagay pa mache', 'Nou resevwa avi erè a. Eseye ankò.', 'Eseye ankò'],
};

function cookieLocale(): Locale {
  const v = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`))?.[1];
  if (isLocale(v)) return v;
  const nav = (navigator.language || '').slice(0, 2);
  return isLocale(nav) ? nav : 'es';
}

/** Last-resort screen when the root layout itself fails; the error goes to Sentry. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale, setLocale] = useState<Locale>('es');
  useEffect(() => setLocale(cookieLocale()), []);
  const [title, body, retry] = COPY[locale];
  useEffect(() => {
    import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error)).catch(() => {});
  }, [error]);
  return (
    <html lang={locale}>
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, background: '#f6f8fb', color: '#0b1324' }}>
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>{title}</h1>
          <p style={{ color: '#5b6577', marginBottom: 20 }}>{body}</p>
          <button onClick={reset} style={{ background: '#0a6cf5', color: '#fff', border: 0, borderRadius: 10, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>{retry}</button>
        </div>
      </body>
    </html>
  );
}
