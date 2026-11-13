'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Home, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Empty, PageLoader } from '@/components/ui/misc';
import { AddressDialog, type Address } from '@/components/shop/address-form';

export default function AddressesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['addresses'], queryFn: () => get<Address[]>('/me/addresses') });
  const [dlg, setDlg] = useState<{ open: boolean; address?: Address | null }>({ open: false });
  const remove = async (id: string) => {
    if (!confirm('¿Eliminar esta dirección?')) return;
    try {
      await del(`/me/addresses/${id}`);
      qc.invalidateQueries({ queryKey: ['addresses'] });
      toast.success('Dirección eliminada.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (q.isLoading) return <PageLoader />;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-extrabold">Direcciones</h1><p className="text-muted">Administra dónde recibes tus pedidos.</p></div>
        <Button onClick={() => setDlg({ open: true, address: null })}><Plus /> Agregar dirección</Button>
      </div>
      {!q.data?.length ? (
        <div className="card mt-6"><Empty icon={<MapPin />} title="No tienes direcciones guardadas" action={<Button onClick={() => setDlg({ open: true, address: null })}>Agregar dirección</Button>} /></div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {q.data.map((a) => (
            <div key={a.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-center gap-2 font-bold"><Home className="size-4 text-brand-600" /> {a.label ?? 'Dirección'}</p>
                {a.isDefaultShipping && <Badge>Predeterminada</Badge>}
              </div>
              <p className="mt-2 text-sm font-semibold">{a.recipientName}</p>
              <p className="text-sm text-muted">{a.line1}{a.line2 ? `, ${a.line2}` : ''}</p>
              <p className="text-sm text-muted">{a.city}{a.region ? `, ${a.region}` : ''}, República Dominicana</p>
              {a.phone && <p className="text-sm text-muted">{a.phone}</p>}
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDlg({ open: true, address: a })}><Pencil /> Editar</Button>
                <Button size="sm" variant="danger" onClick={() => remove(a.id)}><Trash2 /> Eliminar</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {dlg.open && <AddressDialog open onOpenChange={(o) => setDlg({ open: o })} address={dlg.address} onSaved={() => qc.invalidateQueries({ queryKey: ['addresses'] })} />}
    </div>
  );
}
