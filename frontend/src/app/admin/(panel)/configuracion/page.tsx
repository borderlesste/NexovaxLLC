'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bell, Check, CheckCircle2, Code2, CreditCard, Database, Layers, Mail, Plus, Settings, Shield, ShieldCheck, Star, Store, Trash2, Truck, UserPlus, Users, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, put } from '@/lib/api';
import { cn, fmtDate, money } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageLoader, Switch } from '@/components/ui/misc';

const TABS = [['general', 'General', Settings], ['commissions', 'Comisiones', Coins], ['shipping', 'Envíos', Truck], ['notifications', 'Notificaciones', Bell], ['roles', 'Roles y permisos', Users]] as const;

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => get('/admin/settings') });
  const [tab, setTab] = useState<string>('general');
  const [s, setS] = useState<any>(null);
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) { setS(structuredClone(q.data.settings)); setRate(q.data.commission ? String(+(q.data.commission.rate * 100).toFixed(2)) : ''); }
  }, [q.data]);
  if (q.isLoading || !s) return <PageLoader />;
  const d = q.data;
  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const save = async () => {
    setBusy(true);
    try {
      const changed = Object.fromEntries(Object.entries(s).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(d.settings[k])));
      const commissionRate = rate !== '' && d.commission && Math.abs(Number(rate) / 100 - d.commission.rate) > 1e-9 ? Number(rate) / 100 : undefined;
      const r = await put('/admin/settings', { settings: changed, commissionRate });
      qc.setQueryData(['admin-settings'], r);
      qc.invalidateQueries({ queryKey: ['public-config'] });
      toast.success('Configuración guardada. Cada cambio queda versionado y auditado.');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const rates = s['shipping.rates'] as any[];
  const setRateRow = (i: number, k: string, v: any) => set('shipping.rates', rates.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const SYS_ICON: Record<string, any> = { API: Code2, PAYMENTS: CreditCard, STORAGE: Database, MODERATION: Layers };
  const allOk = d.system.every((x: any) => x.status === 'Operativo');
  return (
    <>
      <PageHeader crumbs={[{ label: 'Ajustes' }, { label: 'Configuración' }]} title="Configuración" description="Administra la configuración general del marketplace multivendedor."
        actions={<><Button variant="secondary" onClick={() => { setS(structuredClone(d.settings)); setRate(d.commission ? String(+(d.commission.rate * 100).toFixed(2)) : ''); }}>Cancelar</Button><Button onClick={save} loading={busy}><Check /> Guardar cambios</Button></>} />
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1">
        {TABS.map(([v, l, I]) => <button key={v} onClick={() => setTab(v)} className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold', tab === v ? 'bg-brand-50 text-brand-700 shadow-sm' : 'text-muted hover:text-ink')}><I className="size-4" /> {l}</button>)}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {tab === 'general' && (
            <>
              <Card>
                <CardHeader icon={<Store />} title="Información del marketplace" subtitle="Configura la información básica y la identidad de tu plataforma." />
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                  <Field label="Nombre del marketplace" required><Input value={s['marketplace.name']} onChange={(e) => set('marketplace.name', e.target.value)} /></Field>
                  <Field label="URL base" required><Input value={s['marketplace.base_url']} onChange={(e) => set('marketplace.base_url', e.target.value)} /></Field>
                  <Field label="Moneda" required><Select value={s['marketplace.currency']} disabled><option value="DOP">Peso dominicano (DOP)</option></Select></Field>
                  <Field label="Idioma" required><Select value={s['marketplace.locale']} onChange={(e) => set('marketplace.locale', e.target.value)}><option value="es-DO">Español (RD)</option></Select></Field>
                  <Field label="Correo de soporte" required><Input icon={<Mail />} value={s['marketplace.support_email']} onChange={(e) => set('marketplace.support_email', e.target.value)} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Comisión por venta" required><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} suffix="%" /></Field>
                    <Field label="Impuestos (ITBIS)" required><Input inputMode="decimal" value={String(+(Number(s['tax.itbis_rate']) * 100).toFixed(2))} onChange={(e) => set('tax.itbis_rate', Number(e.target.value.replace(/[^\d.]/g, '') || 0) / 100)} suffix="%" /></Field>
                  </div>
                </div>
                <p className="px-5 pb-5 text-xs text-muted">La moneda principal es fija mientras existan pedidos en DOP. La comisión se publica como una nueva versión de la regla comercial y aplica a las compras nuevas.</p>
              </Card>
              <Card>
                <CardHeader icon={<Settings />} title="Opciones del marketplace" subtitle="Controla las funcionalidades principales de tu plataforma." />
                <div className="grid gap-3 p-5 sm:grid-cols-2">
                  {[['features.featured_products', Star, 'Producto destacado', 'Permite destacar productos en la portada.'], ['features.seller_registration', UserPlus, 'Registro de vendedores', 'Permite el registro de nuevos vendedores en la plataforma.'], ['features.mandatory_moderation', Shield, 'Moderación obligatoria', 'Revisa y aprueba productos y cambios antes de publicarlos.'], ['features.email_notifications', Mail, 'Notificaciones por email', 'Envía notificaciones automáticas a vendedores y clientes.']].map(([k, I, t, desc]: any) => (
                    <div key={k} className="flex items-start gap-3 rounded-xl border border-line p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><I className="size-5" /></span><span className="flex-1"><b className="block text-sm">{t}</b><span className="text-xs text-muted">{desc}</span></span><Switch checked={!!s[k]} onCheckedChange={(v) => set(k, v)} /></div>
                  ))}
                </div>
              </Card>
            </>
          )}
          {tab === 'commissions' && (
            <Card>
              <CardHeader icon={<Coins />} title="Comisiones y política de pagos" subtitle="Reglas comerciales versionadas aplicadas en el checkout." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Comisión global por venta"><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} suffix="%" /></Field>
                <div className="rounded-xl bg-surface p-4 text-sm"><p className="text-muted">Versión vigente desde</p><b>{d.commission ? fmtDate(d.commission.effectiveFrom) : '—'}</b><p className="mt-1 text-xs text-muted">Base: precio del producto después de descuentos (sin envío ni ITBIS).</p></div>
                {d.payoutPolicy && (
                  <div className="rounded-xl border border-line p-4 text-sm sm:col-span-2">
                    <p className="font-bold">Política de retiros (DOP)</p>
                    <ul className="mt-2 space-y-1 text-muted"><li>Liberación de fondos: al entregarse el pedido{d.payoutPolicy.hold ? ` + ${Math.round(d.payoutPolicy.hold / 86400)} días` : ''}.</li><li>Monto mínimo de retiro: <b className="text-ink">{money(d.payoutPolicy.minimum)}</b>.</li><li>Aprobación: {d.payoutPolicy.approval_mode === 'MANUAL' ? 'manual por el equipo de finanzas' : 'automática'}.</li></ul>
                  </div>
                )}
              </div>
            </Card>
          )}
          {tab === 'shipping' && (
            <Card>
              <CardHeader icon={<Truck />} title="Tarifas de envío nacionales" subtitle="Opciones que ven los compradores por cada tienda en el checkout." />
              <div className="space-y-3 p-5">
                {rates.map((r, i) => (
                  <div key={i} className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-[110px_1fr_1.4fr_110px_90px_auto]">
                    <Field label="Código"><Input value={r.code} onChange={(e) => setRateRow(i, 'code', e.target.value.toUpperCase().replace(/[^A-Z_]/g, ''))} /></Field>
                    <Field label="Nombre"><Input value={r.name} onChange={(e) => setRateRow(i, 'name', e.target.value)} /></Field>
                    <Field label="Descripción"><Input value={r.description} onChange={(e) => setRateRow(i, 'description', e.target.value)} /></Field>
                    <Field label="Tarifa (RD$)"><Input inputMode="decimal" value={String(r.amount)} onChange={(e) => setRateRow(i, 'amount', Number(e.target.value.replace(/[^\d.]/g, '') || 0))} /></Field>
                    <Field label="Días"><Input inputMode="numeric" value={String(r.estimated_days)} onChange={(e) => setRateRow(i, 'estimated_days', Number(e.target.value.replace(/\D/g, '') || 0))} /></Field>
                    <Button variant="ghost" size="icon" className="self-end" onClick={() => set('shipping.rates', rates.filter((_, j) => j !== i))} aria-label="Eliminar" disabled={rates.length <= 1}><Trash2 /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => set('shipping.rates', [...rates, { code: 'NUEVO', name: 'Nueva tarifa', description: '', amount: 0, estimated_days: 3, requires_address: true }])}><Plus /> Agregar tarifa</Button>
              </div>
            </Card>
          )}
          {tab === 'notifications' && (
            <Card>
              <CardHeader icon={<Bell />} title="Notificaciones" subtitle="Canales de aviso a compradores y vendedores." />
              <div className="space-y-3 p-5 text-sm">
                <div className="flex items-center justify-between rounded-xl border border-line p-4"><span><b className="block">Notificaciones por correo</b><span className="text-xs text-muted">Pedidos, pagos, moderación y retiros.</span></span><Switch checked={!!s['features.email_notifications']} onCheckedChange={(v) => set('features.email_notifications', v)} /></div>
                <div className="rounded-xl bg-amber-50 p-4 text-amber-800">Para entregar correos a cualquier destinatario configura un proveedor SMTP transaccional (p. ej. Resend) en Supabase Auth. Con el SMTP por defecto solo se entregan correos al equipo del proyecto.</div>
                <div className="flex items-center justify-between rounded-xl border border-line p-4"><span><b className="block">Mensajería en la plataforma</b><span className="text-xs text-muted">Avisos de mensajes nuevos en el panel y la campana.</span></span><Badge tone="green">Activo</Badge></div>
              </div>
            </Card>
          )}
          {tab === 'roles' && (
            <Card>
              <CardHeader icon={<Users />} title="Roles y permisos" subtitle="Roles del sistema y permisos asignados (RBAC)." />
              <table className="w-full text-sm"><thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">Rol</th><th>Descripción</th><th>Usuarios</th><th>Permisos</th></tr></thead>
                <tbody className="divide-y divide-line">{d.roles.map((r: any) => <tr key={r.code}><td className="px-5 py-3 font-bold">{r.name}<span className="block text-xs font-normal text-muted">{r.code}</span></td><td className="text-muted">{r.description}</td><td>{r.users}</td><td>{r.permissions}</td></tr>)}</tbody></table>
              <p className="p-5 text-xs text-muted">Asigna o revoca roles a cada persona desde la sección Usuarios.</p>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader icon={<Activity />} title="Estado del sistema" subtitle="Monitorea la disponibilidad de los servicios principales." />
          <div className="space-y-3 p-5">
            {d.system.map((x: any) => { const I = SYS_ICON[x.code] ?? Activity; return (
              <div key={x.code} className="flex items-center gap-3 rounded-xl border border-line p-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><I className="size-5" /></span><span className="flex-1"><b className="block text-sm">{x.name}</b><span className="text-xs text-muted">{x.description}</span></span><Badge tone={x.status === 'Operativo' ? 'green' : 'amber'}>{x.status}</Badge></div>
            ); })}
            <p className={cn('flex items-center gap-2 rounded-xl p-3 text-sm', allOk ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>{allOk ? <CheckCircle2 className="size-4" /> : <ShieldCheck className="size-4" />} {allOk ? 'Todos los servicios están funcionando correctamente.' : 'Algunos servicios requieren configuración.'}</p>
          </div>
        </Card>
      </div>
    </>
  );
}
