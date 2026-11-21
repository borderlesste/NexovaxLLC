'use client';
import { useEffect } from 'react';
import { usePublicConfig } from '@/lib/config';
import { CONSENT_EVENT } from '@/lib/consent';
import { syncGa } from '@/lib/ga';

/** Loads GA4 when it is on (Admin → Configuración → Google) and the visitor accepted analytics cookies. */
export function GoogleAnalytics() {
  const cfg = usePublicConfig();
  const id = cfg ? cfg.ga4MeasurementId ?? null : undefined;
  useEffect(() => {
    if (id === undefined) return;
    syncGa(id);
    const onConsent = () => syncGa(id);
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, [id]);
  return null;
}
