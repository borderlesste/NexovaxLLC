'use client';
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { t } from './i18n';

interface MessageSignal {
  conversationId: string;
  messageId: string;
  seq: number;
  senderId: string | null;
  sellerId?: string;
}

/**
 * Live inbox: listens to the private Realtime channels of the signed-in user (user:<id>) and of the
 * stores whose messages they can read (seller:<id>). The database sends a small signal when a message
 * arrives (never its text); the pages then reload the conversation through the API.
 */
export function RealtimeInbox() {
  const { session, me } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const userId = me?.id;
  const sellerIds = (me?.sellers ?? [])
    .filter((s) => s.isOwner || s.areas?.includes('MESSAGES'))
    .map((s) => s.id)
    .sort()
    .join(',');
  const token = session?.access_token;

  useEffect(() => {
    if (!userId || !token) return;
    const sb = supabase();
    const channels: RealtimeChannel[] = [];
    let cancelled = false;

    const onMessage = async (signal: MessageSignal, inbox: 'customer' | 'seller') => {
      await qc.invalidateQueries({ queryKey: ['conversation', signal.conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['notifications-count'] });
      if (!signal.senderId || signal.senderId === userId) return;
      const href = `${inbox === 'seller' ? '/vendedor/mensajes' : '/cuenta/mensajes'}?c=${signal.conversationId}`;
      if (pathRef.current?.endsWith('/mensajes')) return; // the inbox already shows it
      toast(t('Tienes un mensaje nuevo'), {
        id: `msg-${signal.conversationId}`,
        action: { label: t('Ver'), onClick: () => router.push(href) },
      });
    };

    (async () => {
      try {
        await sb.realtime.setAuth(token);
      } catch {
        /* subscribe() retries with the session token */
      }
      if (cancelled) return;
      const topics: [string, 'customer' | 'seller'][] = [
        [`user:${userId}`, 'customer'],
        ...sellerIds.split(',').filter(Boolean).map((id) => [`seller:${id}`, 'seller'] as [string, 'seller']),
      ];
      for (const [topic, inbox] of topics) {
        const ch = sb
          .channel(topic, { config: { private: true } })
          .on('broadcast', { event: 'message' }, ({ payload }) => void onMessage(payload as MessageSignal, inbox))
          .subscribe();
        channels.push(ch);
      }
    })();

    return () => {
      cancelled = true;
      for (const ch of channels) void sb.removeChannel(ch);
    };
  }, [userId, sellerIds, token, qc, router]);

  return null;
}
