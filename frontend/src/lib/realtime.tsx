'use client';
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
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
 * The user's private inbox receives customer signals and authorized seller signals.
 * The pages then reload the conversation through the API.
 */
export function RealtimeInbox() {
  const { session, me } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const userId = me?.id;
  const token = session?.access_token;

  useEffect(() => {
    if (!userId || !token) return;
    const sb = supabase();
    let channel: ReturnType<typeof sb.channel> | undefined;
    let cancelled = false;

    const onMessage = async (signal: MessageSignal) => {
      await qc.invalidateQueries({ queryKey: ['conversation', signal.conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['notifications-count'] });
      if (!signal.senderId || signal.senderId === userId) return;
      const href = `${signal.sellerId ? '/vendedor/mensajes' : '/cuenta/mensajes'}?c=${signal.conversationId}`;
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
      channel = sb
        .channel(`user:${userId}`, { config: { private: true } })
        .on('broadcast', { event: 'message' }, ({ payload }) => void onMessage(payload as MessageSignal))
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void sb.removeChannel(channel);
    };
  }, [userId, token, qc, router]);

  return null;
}
