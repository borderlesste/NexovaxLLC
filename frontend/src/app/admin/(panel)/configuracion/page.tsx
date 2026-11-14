'use client';
import { useEffect, useState } from 'react';
import { ShippoCarriers } from '@/components/admin/shippo-carriers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Bell, Check, CheckCircle2, Code2, Coins, CreditCard, Database, Globe2, Landmark, Layers, Mail, Percent, Plus, Send, Settings, Shield, ShieldCheck, Star, Store, Trash2, Truck, UserPlus, Users, BookOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, put } from '@/lib/api';
import { cn, fmtDate, money } from '@/lib/utils';
import { countryName, t } from '@/lib/i18n';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageLoader, Switch } from '@/components/ui/misc';
import { CountrySelect } from '@/components/shop/geo-fields';
import { RateZone } from '@/components/admin/rate-zone';
import { HelpEditor } from '@/components/admin/help-editor';
import { ROLE_NAMES, ROLE_SCOPE } from '@/lib/permissions';

const TABS = [
  ['general', 'General', Settings],
  ['taxes', 'Impuestos', Percent],
  ['commissions', 'Comisiones', Coins],
  ['shipping', 'Envíos', Truck],
  ['payments', 'Pagos', Landmark],
  ['notifications', 'Notificaciones', Bell],
  ['help', 'Ayuda y redes', BookOpen],
  ['roles', 'Roles y permisos', Users],
] as const;

function TaxRatesCard({ rates, onChanged }: { rates: any[]; onChanged: () => void }) {
  const [rows, setRows] = useState<any[]>(() => rates.map((r) => ({ ...r, ratePct: String(+(Number(r.rate) * 100).toFixed(3)) })));
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ countryCode: '', taxName: '', ratePct: '' });
  useEffect(() => setRows(rates.map((r) => ({ ...r, ratePct: String(+(Number(r.rate) * 100).toFixed(3)) }))), [rates]);
  const saveRow = async (r: any) => {
    setBusy(r.countryCode);
    try {
      await put('/admin/tax-rates', { countryCode: r.countryCode, taxName: r.taxName, rate: Number(r.ratePct || 0) / 100, isActive: r.isActive, notes: r.notes || undefined });
      toast.success(t('Impuesto de {c} guardado.', { c: countryName(r.countryCode) }));
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (code: string) => {
    if (!confirm(t('¿Eliminar el impuesto de {c}? Ese país quedará con 0 %.', { c: countryName(code) }))) return;
    try {
      await del(`/admin/tax-rates/${code}`);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const add = async () => {
    if (!draft.countryCode || !draft.taxName) return toast.error(t('Indica país y nombre del impuesto.'));
    await saveRow({ ...draft, isActive: true });
    setDraft({ countryCode: '', taxName: '', ratePct: '' });
  };
  const sorted = [...rows].sort((a, b) => countryName(a.countryCode).localeCompare(countryName(b.countryCode)));
  return (
    <Card>
      <CardHeader icon={<Percent />} title={t('Impuestos por país de destino')} subtitle={t('Se aplican sobre el precio de los productos según el país de la dirección de envío. Países sin tasa: 0 %.')} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">{t('País')}</th><th>{t('Impuesto')}</th><th className="w-28">{t('Tasa')}</th><th>{t('Activo')}</th><th className="w-40" /></tr></thead>
          <tbody className="divide-y divide-line">
            {sorted.map((r) => {
              const upd = (k: string, v: any) => setRows((rs) => rs.map((x) => (x.countryCode === r.countryCode ? { ...x, [k]: v } : x)));
              return (
                <tr key={r.countryCode}>
                  <td className="px-5 py-2 font-semibold">{countryName(r.countryCode)} <span className="text-xs text-muted">{r.countryCode}</span>{r.notes && <span className="block text-xs font-normal text-muted">{r.notes}</span>}</td>
                  <td className="pr-3"><Input rule="businessName" value={r.taxName} onChange={(e) => upd('taxName', e.target.value)} className="h-9" /></td>
                  <td className="pr-3"><Input rule="percent" inputMode="decimal" value={r.ratePct} onChange={(e) => upd('ratePct', e.target.value.replace(/[^\d.]/g, ''))} suffix="%" className="h-9" /></td>
                  <td><Switch checked={!!r.isActive} onCheckedChange={(v) => upd('isActive', v)} /></td>
                  <td className="pr-5 text-right">
                    <Button size="sm" variant="outline" loading={busy === r.countryCode} onClick={() => saveRow(r)}>{t('Guardar')}</Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r.countryCode)} aria-label={t('Eliminar')}><Trash2 /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-[1.4fr_1fr_120px_auto]">
        <CountrySelect value={draft.countryCode} onChange={(v) => setDraft({ ...draft, countryCode: v })} label={t('Agregar país')} />
        <Field label={t('Nombre del impuesto')}><Input rule="businessName" value={draft.taxName} onChange={(e) => setDraft({ ...draft, taxName: e.target.value })} placeholder={t('IVA, VAT, GST…')} /></Field>
        <Field label={t('Tasa')}><Input rule="percent" inputMode="decimal" value={draft.ratePct} onChange={(e) => setDraft({ ...draft, ratePct: e.target.value.replace(/[^\d.]/g, '') })} suffix="%" /></Field>
        <Button className="self-end" onClick={add}><Plus /> {t('Agregar')}</Button>
      </div>
      <p className="px-5 pb-5 text-xs text-muted">{t('Las tasas iniciales son tasas generales de referencia; confírmalas con tu asesor fiscal. El impuesto aplicado queda guardado como evidencia en cada pedido.')}</p>
    </Card>
  );
}

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
    const changed = Object.fromEntries(Object.entries(s).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(d.settings[k])));
    if (changed['marketplace.currency'] && !confirm(t('Cambiar la moneda del marketplace retira los carritos activos y los productos necesitarán precios en {c}. ¿Continuar?', { c: changed['marketplace.currency'] as string })))
      return;
    setBusy(true);
    try {
      const commissionRate = rate !== '' && d.commission && Math.abs(Number(rate) / 100 - d.commission.rate) > 1e-9 ? Number(rate) / 100 : undefined;
      // Amounts are edited as text (so decimals can be typed) and sent as numbers.
      if (Array.isArray(changed['shipping.rates']))
        changed['shipping.rates'] = (changed['shipping.rates'] as any[]).map((x) => ({ ...x, amount: Number(x.amount || 0), estimated_days: Number(x.estimated_days || 0) }));
      const r = await put('/admin/settings', { settings: changed, commissionRate });
      qc.setQueryData(['admin-settings'], r);
      qc.invalidateQueries({ queryKey: ['public-config'] });
      toast.success(t('Configuración guardada. Cada cambio queda versionado y auditado.'));
      if (changed['marketplace.currency'] || changed['marketplace.locale']) setTimeout(() => window.location.reload(), 600);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const rates = s['shipping.rates'] as any[];
  const bt = s['payments.bank_transfer'] ?? {};
  const setBt = (k: string, v: any) => set('payments.bank_transfer', { ...bt, [k]: v });
  const setRateRow = (i: number, k: string, v: any) => set('shipping.rates', rates.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const SYS_ICON: Record<string, any> = { API: Code2, PAYMENTS: CreditCard, STORAGE: Database, MODERATION: Layers, SHIPPING: Truck, EMAIL: Send };
  const allOk = d.system.every((x: any) => x.status === 'Operativo');
  const cur = s['marketplace.currency'];
  return (
    <>
      <PageHeader crumbs={[{ label: t('Ajustes') }, { label: t('Configuración') }]} title={t('Configuración')} description={t('Administra la configuración general del marketplace multivendedor.')}
        actions={<><Button variant="secondary" onClick={() => { setS(structuredClone(d.settings)); setRate(d.commission ? String(+(d.commission.rate * 100).toFixed(2)) : ''); }}>{t('Cancelar')}</Button><Button onClick={save} loading={busy}><Check /> {t('Guardar cambios')}</Button></>} />
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1">
        {TABS.map(([v, l, I]) => <button key={v} onClick={() => setTab(v)} className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold', tab === v ? 'bg-brand-50 text-brand-700 shadow-sm' : 'text-muted hover:text-ink')}><I className="size-4" /> {t(l)}</button>)}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {tab === 'general' && (
            <>
              <Card>
                <CardHeader icon={<Store />} title={t('Información del marketplace')} subtitle={t('Configura la información básica y la identidad de tu plataforma.')} />
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                  <Field label={t('Nombre del marketplace')} required><Input rule="businessName" value={s['marketplace.name']} onChange={(e) => set('marketplace.name', e.target.value)} /></Field>
                  <Field label={t('URL base')} required><Input value={s['marketplace.base_url']} onChange={(e) => set('marketplace.base_url', e.target.value)} /></Field>
                  <Field label={t('Moneda del marketplace')} required>
                    <Select value={cur} onChange={(e) => set('marketplace.currency', e.target.value)}>
                      {d.currencies.map((c: any) => <option key={c.code} value={c.code}>{c.code} – {c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label={t('Idioma predeterminado')} required>
                    <Select value={s['marketplace.locale']} onChange={(e) => set('marketplace.locale', e.target.value)}><option value="es">{t('Español')}</option><option value="en">{t('English')}</option></Select>
                  </Field>
                  <CountrySelect label={t('País predeterminado')} value={s['marketplace.default_country']} onChange={(v) => set('marketplace.default_country', v)} />
                  <Field label={t('Correo de soporte')} required><Input rule="email" icon={<Mail />} value={s['marketplace.support_email']} onChange={(e) => set('marketplace.support_email', e.target.value)} /></Field>
                  <Field label={t('Comisión por venta')} required><Input rule="percent" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} suffix="%" /></Field>
                </div>
                <p className="px-5 pb-5 text-xs text-muted">{t('El marketplace opera en una sola moneda. Los pedidos anteriores conservan su moneda original. Los impuestos se configuran por país en la pestaña Impuestos.')}</p>
              </Card>
              <Card>
                <CardHeader icon={<Settings />} title={t('Opciones del marketplace')} subtitle={t('Controla las funcionalidades principales de tu plataforma.')} />
                <div className="grid gap-3 p-5 sm:grid-cols-2">
                  {[['features.featured_products', Star, t('Producto destacado'), t('Permite destacar productos en la portada.')], ['features.seller_registration', UserPlus, t('Registro de vendedores'), t('Permite el registro de nuevos vendedores en la plataforma.')], ['features.mandatory_moderation', Shield, t('Moderación obligatoria'), t('Revisa y aprueba productos y cambios antes de publicarlos.')], ['features.email_notifications', Mail, t('Notificaciones por email'), t('Envía notificaciones automáticas a vendedores y clientes.')]].map(([k, I, title, desc]: any) => (
                    <div key={k} className="flex items-start gap-3 rounded-xl border border-line p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><I className="size-5" /></span><span className="flex-1"><b className="block text-sm">{t(title)}</b><span className="text-xs text-muted">{t(desc)}</span></span><Switch checked={!!s[k]} onCheckedChange={(v) => set(k, v)} /></div>
                  ))}
                </div>
              </Card>
            </>
          )}
          {tab === 'taxes' && <TaxRatesCard rates={d.taxRates} onChanged={() => qc.invalidateQueries({ queryKey: ['admin-settings'] })} />}
          {tab === 'commissions' && (
            <Card>
              <CardHeader icon={<Coins />} title={t('Comisiones y política de pagos')} subtitle={t('Reglas comerciales versionadas aplicadas en el checkout.')} />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label={t('Comisión global por venta')}><Input rule="percent" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} suffix="%" /></Field>
                <div className="rounded-xl bg-surface p-4 text-sm"><p className="text-muted">{t('Versión vigente desde')}</p><b>{d.commission ? fmtDate(d.commission.effectiveFrom) : '—'}</b><p className="mt-1 text-xs text-muted">{t('Base: precio del producto después de descuentos (sin envío ni impuestos).')}</p></div>
                {d.payoutPolicy && (
                  <div className="rounded-xl border border-line p-4 text-sm sm:col-span-2">
                    <p className="font-bold">{t('Política de retiros ({c})', { c: d.payoutPolicy.currency })}</p>
                    <ul className="mt-2 space-y-1 text-muted">
                      <li>{t('Liberación de fondos: al entregarse el pedido')}{d.payoutPolicy.hold ? ` + ${Math.round(d.payoutPolicy.hold / 86400)} ${t('días')}` : ''}.</li>
                      <li>{t('Monto mínimo de retiro')}: <b className="text-ink">{money(d.payoutPolicy.minimum, d.payoutPolicy.currency)}</b>.</li>
                      <li>{t('Aprobación')}: {d.payoutPolicy.approval_mode === 'MANUAL' ? t('manual por el equipo de finanzas') : t('automática')}.</li>
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}
          {tab === 'shipping' && (
            <>
              <Card>
                <CardHeader icon={<Truck />} title={t('Transportadoras de Shippo')} subtitle={t('Solo se ofrecen al comprador las que pueden emitir la etiqueta.')} />
                <ShippoCarriers />
              </Card>
              <Card>
                <CardHeader icon={<Globe2 />} title={t('Tarifas en vivo (Shippo)')} subtitle={t('Cotiza con USPS, UPS, DHL Express, Canada Post y más; compra etiquetas y rastrea envíos automáticamente.')} />
                <div className="space-y-3 p-5 text-sm">
                  <div className="flex items-center justify-between rounded-xl border border-line p-4">
                    <span><b className="block">{t('Usar Shippo cuando la ruta tenga cobertura')}</b><span className="text-xs text-muted">{t('Si una ruta no tiene transportadoras disponibles se ofrecen las tarifas del marketplace.')}</span></span>
                    <Switch checked={!!s['shipping.shippo_enabled']} onCheckedChange={(v) => set('shipping.shippo_enabled', v)} />
                  </div>
                  <p className="text-xs text-muted">{t('Las transportadoras y sus cuentas se administran en el panel de Shippo. Webhook de rastreo: /api/webhooks/shippo?token=… (evento track_updated).')}</p>
                </div>
              </Card>
              <Card>
                <CardHeader icon={<Truck />} title={t('Tarifas del marketplace')} subtitle={t('Tarifas fijas de respaldo y retiro en tienda. Cada tarifa se ofrece solo en su zona; si una ruta no tiene tarifa, el comprador no puede pagar ese envío.')} />
                <div className="space-y-3 p-5">
                  {rates.map((r, i) => (
                    <div key={i} className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-[110px_1fr_1.4fr_110px_90px_auto]">
                      <Field label={t('Código')}><Input value={r.code} onChange={(e) => setRateRow(i, 'code', e.target.value.toUpperCase().replace(/[^A-Z_]/g, ''))} /></Field>
                      <Field label={t('Nombre')}><Input rule="businessName" value={r.name} onChange={(e) => setRateRow(i, 'name', e.target.value)} /></Field>
                      <Field label={t('Descripción')}><Input value={r.description} onChange={(e) => setRateRow(i, 'description', e.target.value)} /></Field>
                      <Field label={`${t('Tarifa')} (${cur})`}><Input rule="money" value={String(r.amount)} onChange={(e) => setRateRow(i, 'amount', e.target.value)} /></Field>
                      <Field label={t('Días')}><Input rule="integer" inputMode="numeric" value={String(r.estimated_days)} onChange={(e) => setRateRow(i, 'estimated_days', Number(e.target.value.replace(/\D/g, '') || 0))} /></Field>
                      <Button variant="ghost" size="icon" className="self-end" onClick={() => set('shipping.rates', rates.filter((_, j) => j !== i))} aria-label={t('Eliminar')} disabled={rates.length <= 1}><Trash2 /></Button>
                      {r.code !== 'PICKUP' && <RateZone rate={r} onChange={(patch) => set('shipping.rates', rates.map((x, j) => (j === i ? { ...x, ...patch } : x)))} />}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => set('shipping.rates', [...rates, { code: 'NUEVO', name: t('Nueva tarifa'), description: '', amount: 0, estimated_days: 3, requires_address: true }])}><Plus /> {t('Agregar tarifa')}</Button>
                </div>
              </Card>
            </>
          )}
          {tab === 'payments' && (
            <Card>
              <CardHeader icon={<Landmark />} title={t('Transferencia bancaria')} subtitle={t('Datos que reciben los compradores que pagan por transferencia.')} />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-xl border border-line p-4 sm:col-span-2">
                  <span><b className="block text-sm">{t('Aceptar pagos por transferencia')}</b><span className="text-xs text-muted">{t('El inventario se reserva 72 h hasta que finanzas confirme el pago.')}</span></span>
                  <Switch checked={!!bt.enabled} onCheckedChange={(v) => setBt('enabled', v)} />
                </div>
                <Field label={t('Banco')} required><Input rule="businessName" value={bt.bank_name ?? ''} onChange={(e) => setBt('bank_name', e.target.value)} /></Field>
                <Field label={t('Titular de la cuenta')} required><Input rule="businessName" value={bt.account_holder ?? ''} onChange={(e) => setBt('account_holder', e.target.value)} /></Field>
                <Field label={t('Número de cuenta')} required><Input rule="bankAccount" value={bt.account_number ?? ''} onChange={(e) => setBt('account_number', e.target.value)} /></Field>
                <Field label={t('Routing / SWIFT / BIC')}><Input rule="swift" value={bt.routing_or_swift ?? ''} onChange={(e) => setBt('routing_or_swift', e.target.value || null)} /></Field>
                <Field label={t('IBAN')} className="sm:col-span-2"><Input rule="bankAccount" value={bt.iban ?? ''} onChange={(e) => setBt('iban', e.target.value || null)} /></Field>
                <Field label={t('Instrucciones para el comprador')} className="sm:col-span-2"><Textarea rows={3} value={bt.instructions ?? ''} onChange={(e) => setBt('instructions', e.target.value)} /></Field>
              </div>
            </Card>
          )}
          {tab === 'help' && <HelpEditor settings={s} />}
          {tab === 'notifications' && (
            <Card>
              <CardHeader icon={<Bell />} title={t('Notificaciones')} subtitle={t('Canales de aviso a compradores y vendedores.')} />
              <div className="space-y-3 p-5 text-sm">
                <div className="flex items-center justify-between rounded-xl border border-line p-4"><span><b className="block">{t('Notificaciones por correo')}</b><span className="text-xs text-muted">{t('Pedidos, pagos, envíos, moderación, retiros y soporte, en el idioma de cada usuario.')}</span></span><Switch checked={!!s['features.email_notifications']} onCheckedChange={(v) => set('features.email_notifications', v)} /></div>
                <div className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{t('Los correos se envían con Resend desde el dominio verificado del marketplace.')}</div>
                <div className="flex items-center justify-between rounded-xl border border-line p-4"><span><b className="block">{t('Mensajería en la plataforma')}</b><span className="text-xs text-muted">{t('Avisos de mensajes nuevos en el panel y la campana.')}</span></span><Badge tone="green">{t('Activo')}</Badge></div>
              </div>
            </Card>
          )}
          {tab === 'roles' && (
            <Card>
              <CardHeader icon={<Users />} title={t('Roles y permisos')} subtitle={t('Roles del sistema y permisos asignados (RBAC).')} />
              <table className="w-full text-sm"><thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">{t('Rol')}</th><th>{t('Descripción')}</th><th>{t('Usuarios')}</th><th>{t('Permisos')}</th></tr></thead>
                <tbody className="divide-y divide-line">{d.roles.map((r: any) => <tr key={r.code}><td className="px-5 py-3 font-bold">{t(r.name)}<span className="block text-xs font-normal text-muted">{r.code}</span></td><td className="text-muted">{t(r.description ?? '')}</td><td>{r.users}</td><td>{r.permissions}</td></tr>)}</tbody></table>
              <p className="p-5 text-xs text-muted">{t('Asigna o revoca roles a cada persona desde la sección Usuarios.')}</p>
              <div className="grid gap-4 border-t border-line p-5 lg:grid-cols-2" data-role-scope>
                {(['SUPPORT', 'MODERATOR'] as const).map((r) => (
                  <div key={r} className="rounded-xl border border-line p-4">
                    <p className="font-bold">{t(ROLE_NAMES[r])}</p>
                    <p className="mt-3 text-xs font-bold uppercase text-emerald-700">{t('Puede')}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{ROLE_SCOPE[r]!.can.map((x) => <li key={x}>{t(x)}</li>)}</ul>
                    <p className="mt-3 text-xs font-bold uppercase text-red-700">{t('No puede')}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">{ROLE_SCOPE[r]!.cannot.map((x) => <li key={x}>{t(x)}</li>)}</ul>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader icon={<Activity />} title={t('Estado del sistema')} subtitle={t('Monitorea la disponibilidad de los servicios principales.')} />
          <div className="space-y-3 p-5">
            {d.system.map((x: any) => { const I = SYS_ICON[x.code] ?? Activity; return (
              <div key={x.code} className="flex items-center gap-3 rounded-xl border border-line p-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><I className="size-5" /></span><span className="flex-1"><b className="block text-sm">{t(x.name)}</b><span className="text-xs text-muted">{t(x.description)}</span></span><Badge tone={x.status === 'Operativo' ? 'green' : 'amber'}>{t(x.status)}</Badge></div>
            ); })}
            <p className={cn('flex items-center gap-2 rounded-xl p-3 text-sm', allOk ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>{allOk ? <CheckCircle2 className="size-4" /> : <ShieldCheck className="size-4" />} {allOk ? t('Todos los servicios están funcionando correctamente.') : t('Algunos servicios están en modo prueba o requieren configuración.')}</p>
          </div>
        </Card>
      </div>
    </>
  );
}
