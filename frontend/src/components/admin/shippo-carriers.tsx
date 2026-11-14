'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/i18n';

type Carrier = { id: string; carrier: string; name: string; active: boolean; status: 'UNKNOWN' | 'OK' | 'BLOCKED'; reason: string | null };

/**
 * Carrier accounts of the Shippo account. Shippo quotes carriers whose registration
 * isn't finished but rejects their labels; those are blocked and not offered to buyers.
 */
export function ShippoCarriers() {
  const q = useQuery<Carrier[]>({ queryKey: ['admin-shippo-carriers'], queryFn: () => get('/admin/shipping/carriers') });
  const [busy, setBusy] = useState<string | null>(null);
  const recheck = async (c: Carrier) => {
    setBusy(c.id);
    try {
      await post(`/admin/shipping/carriers/${c.id}/recheck`);
      toast.success(t('Se volverá a comprobar {c} en la próxima cotización.', { c: c.name }));
      q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <p className="p-5 text-sm text-muted">{t('Cargando transportadoras…')}</p>;
  if (q.isError) return <p className="p-5 text-sm text-red-600">{errorMessage(q.error)}</p>;
  const blocked = (q.data ?? []).filter((c) => c.status === 'BLOCKED');
  return (
    <div className="space-y-3 p-5 text-sm">
      {blocked.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
          {t('Estas transportadoras no se ofrecen en el checkout porque Shippo rechaza sus etiquetas. Actívalas en Shippo (Settings → Carriers → “Activate Account”) y pulsa “Volver a comprobar”.')}
        </p>
      )}
      <div className="divide-y divide-line rounded-xl border border-line">
        {(q.data ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-carrier={c.carrier}>
            <b className="w-40">{c.name}</b>
            <Badge tone={c.status === 'OK' ? 'green' : c.status === 'BLOCKED' ? 'red' : 'gray'}>
              {c.status === 'OK' ? t('Emite etiquetas') : c.status === 'BLOCKED' ? t('Bloqueada') : t('Sin comprobar')}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-muted" title={c.reason ?? undefined}>{(c.reason ?? '').replace(/^An error occurred[^:]*:\s*/i, '').replace(/^registration_error:\s*/i, '')}</span>
            {c.status !== 'UNKNOWN' && (
              <Button size="sm" variant="secondary" onClick={() => recheck(c)} loading={busy === c.id}><RefreshCw /> {t('Volver a comprobar')}</Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
