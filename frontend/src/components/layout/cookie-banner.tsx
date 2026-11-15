'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cookie } from 'lucide-react';
import { t } from '@/lib/i18n';
import { getConsent, OPEN_CONSENT_EVENT, setConsent } from '@/lib/consent';
import { Button } from '@/components/ui/button';

/** Asks once for analytics cookies; reopened from "Preferencias de cookies" in the footer. */
export function CookieBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!getConsent()) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);
  if (!open) return null;
  const choose = (analytics: boolean) => {
    setConsent(analytics);
    setOpen(false);
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4" role="dialog" aria-label={t('Preferencias de cookies')} data-cookie-banner>
      <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl border border-line bg-white p-4 shadow-xl sm:flex-row sm:items-center">
        <Cookie className="hidden size-8 shrink-0 text-brand-600 sm:block" />
        <p className="flex-1 text-sm text-muted">
          {t('Usamos cookies esenciales para que el sitio funcione. Con tu permiso, también medimos qué productos visitas para mejorar las recomendaciones; las tiendas solo ven cifras totales, nunca quién eres.')}{' '}
          <Link href="/ayuda#cookies" className="font-semibold text-brand-700">{t('Más información')}</Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => choose(false)} data-cookie-essential>{t('Solo necesarias')}</Button>
          <Button size="sm" onClick={() => choose(true)} data-cookie-accept>{t('Aceptar')}</Button>
        </div>
      </div>
    </div>
  );
}
