'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { flushRefs, rememberRef } from '@/lib/affiliates';
import { rememberPath } from '@/lib/analytics';

/** Captures affiliate links (?ref=CODE) and attributes them once the visitor is signed in. */
export function RefTracker() {
  const pathname = usePathname();
  const { session, me } = useAuth();
  useEffect(() => {
    rememberRef();
    rememberPath(window.location.pathname, window.location.search);
    if (session && me) void flushRefs();
  }, [pathname, session, me]);
  return null;
}
