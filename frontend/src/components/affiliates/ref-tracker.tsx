'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { flushRefs, rememberRef } from '@/lib/affiliates';

/** Captures affiliate links (?ref=CODE) and attributes them once the visitor is signed in. */
export function RefTracker() {
  const pathname = usePathname();
  const { session, me } = useAuth();
  useEffect(() => {
    rememberRef();
    if (session && me) void flushRefs();
  }, [pathname, session, me]);
  return null;
}
