'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePublicConfig } from '@/lib/config';
import { getLocale } from '@/lib/i18n';

/**
 * Cloudflare Turnstile (anti-bot) for the public auth forms.
 * The site key comes from /api/config/public (TURNSTILE_SITE_KEY on the API) or, as a fallback,
 * from NEXT_PUBLIC_TURNSTILE_SITE_KEY on the web; without either the forms work as before.
 * Each token is single-use: call `reset()` after every submit attempt.
 */
const BUILD_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
      s.onerror = () => {
        loader = null;
        reject(new Error('turnstile'));
      };
      document.head.appendChild(s);
    });
  }
  return loader;
}

function TurnstileWidget({ siteKey, action, onToken, resetSignal }: { siteKey: string; action: string; onToken: (t: string | null) => void; resetSignal: number }) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !el.current) return;
        id.current = ts.render(el.current, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          // Cloudflare has no Haitian Creole: show the widget in French for 'ht'.
          language: getLocale() === 'ht' ? 'fr' : getLocale(),
          callback: (t: string) => cb.current(t),
          'expired-callback': () => cb.current(null),
          'error-callback': () => cb.current(null),
        });
      })
      .catch(() => cb.current(null));
    return () => {
      cancelled = true;
      if (id.current && window.turnstile) window.turnstile.remove(id.current);
      id.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (resetSignal && id.current && window.turnstile) window.turnstile.reset(id.current);
  }, [resetSignal]);

  return <div ref={el} className="min-h-[65px]" data-turnstile />;
}

/** Turnstile state for a form: render `widget`, send `token`, and `reset()` after each attempt. */
export function useCaptcha(action: string) {
  const cfg = usePublicConfig();
  // The build-time key keeps login protected and working even while the API is unreachable
  // (Supabase Auth requires a captcha token once CAPTCHA protection is on).
  const siteKey = cfg?.turnstileSiteKey || BUILD_SITE_KEY;
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setResetSignal((n) => n + 1);
  }, []);
  return {
    /** True once the public config is loaded and, if Turnstile is on, the visitor passed the check. */
    ready: (cfg !== undefined || !!BUILD_SITE_KEY) && (!siteKey || !!token),
    required: !!siteKey,
    token,
    reset,
    widget: siteKey ? <TurnstileWidget siteKey={siteKey} action={action} onToken={setToken} resetSignal={resetSignal} /> : null,
  };
}
