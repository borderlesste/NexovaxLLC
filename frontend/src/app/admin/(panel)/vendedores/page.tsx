'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Clock, Plus, Search, ShieldCheck, Store, Users } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDate, money } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar, Dialog, Empty, Pagination, Segmented, Spinner } from '@/components/ui/misc';

function NewSellerDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const cities = useQuery({ queryKey: ['cities'], queryFn: () => get('/geo/cities'), staleTime: Infinity });
  const [f, setF] = useState({ ownerName: '', ownerEmail: '', storeName: '', legalName: '', entityType: 'SRL', taxId: '', line1: '', cityId: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const r = await post('/admin/sellers', { ownerName: f.ownerName, ownerEmail: f.ownerEmail, storeName: f.storeName, legalName: f.legalName, entityType: f.entityType, taxId: f.taxId, address: { contactName: f.ownerName, line1: f.line1, cityId: Number(f.cityId), phone: f.phone || undefined } });
      setResult(r);
      qc.invalidateQueries({ queryKey: ['admin-sellers'] });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Nuevo vendedor" description="Crea la cuenta del propietario y la tienda, ya aprobada." size="lg"
      footer={result ? <Button onClick={onClose}>Listo</Button> : <><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={busy}>Crear vendedor</Button></>}>
      {result ? (
        <div className="space-y-2 text-sm">
          <p className="font-bold text-emerald-700">Tienda creada y aprobada.</p>
          <p>Propietario: <b>{result.ownerEmail}</b></p>
          {result.temporaryPassword ? <p>Contraseña temporal: <b className="font-mono">{result.temporaryPassword}</b> (compártela de forma segura; el vendedor debe cambiarla).</p> : <p>El usuario ya tenía cuenta; puede entrar con su contraseña actual.</p>}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre del propietario" required><Input value={f.ownerName} onChange={set('ownerName')} /></Field>
          <Field label="Correo del propietario" required><Input type="email" value={f.ownerEmail} onChange={set('ownerEmail')} /></Field>
          <Field label="Nombre de la tienda" required><Input value={f.storeName} onChange={set('storeName')} /></Field>
          <Field label="Razón social" required><Input value={f.legalName} onChange={set('legalName')} /></Field>
          <Field label="Tipo" required><Select value={f.entityType} onChange={set('entityType')}><option value="PERSONA_FISICA">Persona física</option><option value="SRL">S.R.L.</option><option value="SA">S.A.</option><option value="EIRL">E.I.R.L.</option><option value="OTRO">Otro</option></Select></Field>
          <Field label="RNC o cédula" required><Input value={f.taxId} onChange={set('taxId')} /></Field>
          <Field label="Dirección de despacho" required><Input value={f.line1} onChange={set('line1')} /></Field>
          <Field label="Ciudad" required><Select value={f.cityId} onChange={set('cityId')}><option value="">Selecciona</option>{(cities.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Teléfono"><Input value={f.phone} onChange={set('phone')} /></Field>
        </div>
      )}
    </Dialog>
  );
}

function AdminSellers() {
  const sp = useSearchParams();
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['admin-sellers', status, search, page], queryFn: () => get(`/admin/sellers?status=${status}&search=${encodeURIComponent(search)}&page=${page}`) });
  const c = q.data?.counts;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Inicio' }, { label: 'Vendedores' }]} title="Vendedores" description="Gestiona tiendas, propietarios y solicitudes de acceso." actions={isAdmin && <Button onClick={() => setCreating(true)}><Plus /> Nuevo vendedor</Button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Vendedores registrados" value={c?.total ?? '—'} icon={<Users />} />
        <StatCard label="Tiendas activas" value={c?.active ?? '—'} icon={<Store />} tone="green" />
        <StatCard label="Solicitudes pendientes" value={c?.pending ?? '—'} icon={<Clock />} tone="amber" hint="requieren revisión" />
        <StatCard label="Tiendas suspendidas" value={c?.suspended ?? '—'} icon={<ShieldCheck />} tone="red" />
      </div>
      <Card className="mt-5">
        <Segmented className="px-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[
          { value: '', label: 'Todas las tiendas', count: c?.total }, { value: 'ACTIVE', label: 'Activas' }, { value: 'PENDING_VERIFICATION', label: 'Pendientes', count: c?.pending }, { value: 'SUSPENDED', label: 'Suspendidas' }, { value: 'REJECTED', label: 'Rechazadas' },
        ]} />
        <div className="p-4"><Input icon={<Search />} placeholder="Buscar vendedor, tienda o correo..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" /></div>
        {q.isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : !q.data?.items.length ? <Empty icon={<Store />} title="Sin vendedores" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-surface text-left text-xs font-semibold text-muted"><tr><th className="px-5 py-3">Tienda</th><th>Propietario</th><th>Registro</th><th>Productos</th><th>Ventas totales</th><th>Estado</th><th /></tr></thead>
              <tbody className="divide-y divide-line">
                {q.data.items.map((s: any) => (
                  <tr key={s.id} className="hover:bg-surface/60">
                    <td className="px-5 py-3"><Link href={`/admin/vendedores/${s.id}`} className="flex items-center gap-3"><Avatar name={s.name} src={s.logoUrl} size={38} /><span><b>{s.name}</b><span className="block text-xs text-muted">{s.email}</span></span></Link></td>
                    <td>{s.owner}</td><td className="text-muted">{fmtDate(s.createdAt)}</td><td className="font-semibold">{s.products}</td><td className="font-semibold">{money(s.sales)}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="pr-5 text-right"><Link href={`/admin/vendedores/${s.id}`} className="inline-flex items-center gap-1 font-semibold text-brand-700">Gestionar <ChevronRight className="size-4" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={20} total={q.data.total} onPage={setPage} label="vendedores" />
          </div>
        )}
      </Card>
      {(c?.pending ?? 0) > 0 && (
        <Card className="mt-5 flex flex-wrap items-center gap-4 p-5">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><ShieldCheck className="size-5" /></span>
          <div className="flex-1"><p className="font-bold">Verificación y aprobación de vendedores</p><p className="text-sm text-muted">{c.pending} solicitudes nuevas necesitan comprobar la información de la tienda antes de su activación.</p></div>
          <Button variant="soft" onClick={() => setStatus('PENDING_VERIFICATION')}>Revisar solicitudes <ChevronRight /></Button>
        </Card>
      )}
      {creating && <NewSellerDialog onClose={() => setCreating(false)} />}
    </>
  );
}
export default function Page() { return <Suspense><AdminSellers /></Suspense>; }
