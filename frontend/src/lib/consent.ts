'use client';

/** Cookie consent: essential cookies always; analytics only if the visitor accepts. */
const KEY = 'nx.consent';
const VID = 'nx.vid';
const VERSION = 1;
export const CONSENT_EVENT = 'nx:consent';
export const OPEN_CONSENT_EVENT = 'nx:consent-open';

export type Consent = { analytics: boolean; at: number; v: number };
/** Essential cookie that only says "already answered", so the server knows whether to render the banner. */
export const CONSENT_COOKIE = 'nx_consent';

export function markConsentCookie() {
  try {
    document.cookie = `${CONSENT_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch {
    /* cookies unavailable */
  }
}

export function getConsent(): Consent | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return c && c.v === VERSION && typeof c.analytics === 'boolean' ? c : null;
  } catch {
    return null;
  }
}

export const analyticsAllowed = () => getConsent()?.analytics === true;

export function setConsent(analytics: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ analytics, at: Date.now(), v: VERSION }));
    if (!analytics) localStorage.removeItem(VID);
  } catch {
    /* storage unavailable */
  }
  markConsentCookie();
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { analytics } }));
}

/** Anonymous visitor id, created only with analytics consent. */
export function visitorId(): string | null {
  if (!analyticsAllowed()) return null;
  try {
    let v = localStorage.getItem(VID);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(VID, v);
    }
    return v;
  } catch {
    return null;
  }
}

export const openConsent = () => window.dispatchEvent(new CustomEvent(OPEN_CONSENT_EVENT));
