'use client';
import { t, getLocale, switchLocale } from '@/lib/i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { ApiError, get, setSellerContext } from './api';
import { can as canRole, type Permission } from './permissions';

export type Role = 'CUSTOMER' | 'SELLER' | 'SUPPORT' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';
export interface Me {
  id: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  locale?: 'es' | 'en';
  avatarUrl?: string | null;
  memberSince: string;
  roles: Role[];
  sellers: { id: string; slug: string; status: string; isOwner: boolean }[];
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
  signIn: (email: string, password: string) => Promise<void>;
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
  const seller = me?.sellers[0];
  useEffect(() => setSellerContext(seller?.id ?? null), [seller?.id]);
  // Apply the account's saved language once per browser (an explicit choice is kept in the cookie).
  useEffect(() => {
    const saved = (me as any)?.locale;
    if (saved && saved !== getLocale() && !document.cookie.split('; ').some((c) => c.startsWith('nx_locale='))) switchLocale(saved);
  }, [me]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      if (/invalid login/i.test(error.message)) throw new Error(t('Correo o contraseña incorrectos.'));
      if (/email not confirmed/i.test(error.message)) throw Object.assign(new Error(t('Debes confirmar tu correo antes de iniciar sesión.')), { code: 'EMAIL_NOT_CONFIRMED' });
      throw new Error(error.message);
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
      signIn,
      signOut,
      refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    };
  }, [session, me, ready, meQ.isLoading, seller, signIn, signOut, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
