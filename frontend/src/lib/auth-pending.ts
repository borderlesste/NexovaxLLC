import { safeNextPath } from './safe-redirect';

/** sessionStorage key: e-mail of a just-registered (unconfirmed) account, used to prefill "Reenviar enlace de confirmación". */
export const PENDING_EMAIL_KEY = 'nx.pendingVerificationEmail';

const PENDING_BADGE_SIGNUP_KEY = 'nx.pendingBadgeSignup';

export function rememberBadgeSignup(email: string, next: string) {
  try { sessionStorage.setItem(PENDING_BADGE_SIGNUP_KEY, JSON.stringify({ email: email.trim().toLowerCase(), next })); } catch {}
}

/** A delayed first sign-in offers the badge only when it matches this tab's signup. */
export function takeBadgeSignup(email?: string): string | null {
  if (!email) return null;
  try {
    const raw = sessionStorage.getItem(PENDING_BADGE_SIGNUP_KEY);
    if (!raw) return null;
    const signup = JSON.parse(raw);
    if (signup?.email !== email.trim().toLowerCase()) return null;
    sessionStorage.removeItem(PENDING_BADGE_SIGNUP_KEY);
    return safeNextPath(typeof signup.next === 'string' ? signup.next : null);
  } catch {
    return null;
  }
}

export function welcomeBadgeIntro(next: string): string {
  return `/auth/bienvenida${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`;
}

export function verificationDestination(next: string): string | undefined {
  return next !== '/' && next.length <= 1024 ? next : undefined;
}
