'use client';
import { t, getLocale, switchLocale } from '@/lib/i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { ApiError, get, post, postWithCaptcha, setSellerContext } from './api';
import { guestCart } from './guest-cart';
import { toast } from 'sonner';
import { can as canRole, type Permission } from './permissions';


/** The API did not handle the request (down, asleep or not configured), so nothing was consumed. */
function apiUnavailable(e: ApiError) {
  return e.code === 'SERVICE_NOT_CONFIGURED' || (e.status >= 500 && !['AUTH_PROVIDER_ERROR', 'CAPTCHA_UNAVAILABLE'].includes(e.code));
}

/** Parts of the seller panel a team member can be given. */
export type SellerArea = 'PRODUCTS' | 'ORDERS' | 'MESSAGES' | 'MARKETING' | 'FINANCE' | 'STATS' | 'SETTINGS';

export type Role = 'CUSTOMER' | 'SELLER' | 'SUPPORT' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';
export interface Me {
  id: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  locale?: 'es' | 'en' | 'fr' | 'ht';
  /** Saved browsing destination (ISO alpha-2), or null. */
  deliveryCountry?: string | null;
  avatarUrl?: string | null;
  memberSince: string;
  roles: Role[];
  /** Stores the user owns or works in. Owners have every area; team members only the ones they were given. */
  sellers: { id: string; slug: string; status: string; isOwner: boolean; areas: SellerArea[] }[];
  counts: { favorites: number; cart_items: number; unread_conversations: number };
}

interface AuthCtx {
  session: Session | null;
  me: Me | undefined;
  loading: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  /** Whether the user's staff roles allow an admin-panel permission (see lib/permissions). */
  can: (perm: Permission) => boolean;
  seller: Me['sellers'][number] | undefined;
  /** Switches the store the seller panel acts for (users in more than one store). */
  selectSeller: (id: string) => void;
  /** Whether the current store lets the user use a part of the seller panel. */
  sellerCan: (area: SellerArea) => boolean;
  signIn: (email: string, password: string, captchaToken?: string | null) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      qc.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const meQ = useQuery({
    queryKey: ['me', session?.user.id],
    queryFn: () => get<Me>('/me'),
    enabled: !!session,
    staleTime: 30_000,
    retry: 1,
  });

  // Account deleted while signed in: drop the stale session instead of showing broken pages.
  useEffect(() => {
    const e = meQ.error;
    if (e instanceof ApiError && ['ACCOUNT_CLOSED', 'PROFILE_NOT_PROVISIONED'].includes(e.code)) {
      supabase().auth.signOut().finally(() => {
        qc.clear();
        if (!window.location.pathname.startsWith('/auth/')) window.location.assign('/auth/iniciar-sesion?cuenta=eliminada');
      });
    }
  }, [meQ.error, qc]);

  const me = session ? meQ.data : undefined;
  const [sellerPick, setSellerPick] = useState<string | null>(null);
  useEffect(() => {
    try {
      setSellerPick(localStorage.getItem('nx_seller'));
    } catch {}
  }, []);
  const seller = me?.sellers.find((s) => s.id === sellerPick) ?? me?.sellers[0];
  const selectSeller = useCallback(
    (id: string) => {
      setSellerPick(id);
      try {
        localStorage.setItem('nx_seller', id);
      } catch {}
      setSellerContext(id);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
    [qc],
  );
  useEffect(() => setSellerContext(seller?.id ?? null), [seller?.id]);
  // After sign-in, the guest cart (kept in this browser) moves into the account's cart.
  const merging = useRef<string | null>(null);
  useEffect(() => {
    if (!me || merging.current === me.id) return;
    merging.current = me.id;
    const items = guestCart.lines();
    if (!items.length) return;
    post<{ cart: any; skipped: string[] }>('/cart/merge', { items, mergeKey: guestCart.mergeKey() })
      .then((r) => {
        guestCart.clear();
        qc.setQueryData(['cart'], r.cart);
        qc.invalidateQueries({ queryKey: ['me'] });
        qc.invalidateQueries({ queryKey: ['checkout-quote'] });
        if (r.skipped?.length) toast.warning(t('Algunos productos de tu carrito ya no estaban disponibles y no se agregaron.'));
      })
      .catch(() => {
        merging.current = null; // retried on the next load; the guest cart is kept
      });
  }, [me, qc]);

  // Apply the account's saved language once per browser (an explicit choice is kept in the cookie).
  useEffect(() => {
    const saved = (me as any)?.locale;
    if (saved && saved !== getLocale() && !document.cookie.split('; ').some((c) => c.startsWith('nx_locale='))) switchLocale(saved);
  }, [me]);

  const signIn = useCallback(async (email: string, password: string, captchaToken?: string | null) => {
    const mail = email.trim().toLowerCase();
    // Sign in through our API so the browser only talks to our domain; the web keeps the session.
    try {
      const s = await postWithCaptcha<{ access_token: string; refresh_token: string }>('/auth/login', { email: mail, password }, captchaToken ?? null);
      const { error } = await supabase().auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
      if (error) throw new Error(error.message);
      return;
    } catch (e) {
      if (e instanceof ApiError && !apiUnavailable(e)) {
        if (e.code === 'EMAIL_NOT_CONFIRMED') throw Object.assign(new Error(e.message), { code: 'EMAIL_NOT_CONFIRMED' });
        throw new Error(e.message);
      }
      if (!(e instanceof ApiError) && !(e instanceof TypeError)) throw e;
      // API unreachable (asleep, deploying): the Turnstile token was not used, sign in with Supabase directly.
    }
    const { error } = await supabase().auth.signInWithPassword({
      email: mail,
      password,
      // Required once CAPTCHA protection (Turnstile) is enabled in Supabase Auth.
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (error) {
      if (/invalid login/i.test(error.message)) throw new Error(t('Correo o contraseña incorrectos.'));
      if (/captcha/i.test(error.message)) throw new Error(t('No pudimos verificar que eres una persona. Completa la verificación e inténtalo de nuevo.'));
      if (/email not confirmed/i.test(error.message)) throw Object.assign(new Error(t('Debes confirmar tu correo antes de iniciar sesión.')), { code: 'EMAIL_NOT_CONFIRMED' });
      if (/rate limit|too many/i.test(error.message)) throw new Error(t('Demasiados intentos. Espera unos minutos.'));
      throw new Error(t('Ocurrió un error inesperado.'));
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthCtx>(() => {
    const roles = me?.roles ?? [];
    return {
      session,
      me,
      loading: !ready || (!!session && meQ.isLoading),
      isAdmin: roles.includes('ADMIN') || roles.includes('SUPER_ADMIN'),
      isStaff: roles.some((r) => ['ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'SUPPORT'].includes(r)),
      can: (perm: Permission) => canRole(roles, perm),
      seller,
      selectSeller,
      sellerCan: (area: SellerArea) => !!seller && (seller.isOwner || (seller.areas ?? []).includes(area)),
      signIn,
      signOut,
      refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    };
  }, [session, me, ready, meQ.isLoading, seller, selectSeller, signIn, signOut, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
