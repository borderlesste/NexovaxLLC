'use client';
import { entityLabel } from '@/lib/entities';
import { countryName, t } from '@/lib/i18n';
import { cityLine } from '@/components/shop/geo-fields';
import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, Check, ExternalLink, Landmark, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDate, fmtDateTime, money } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Dialog, Empty, ErrorBox, PageLoader } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/input';
import { statusInfo } from '@/lib/status';

export default function SellerAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isAdmin } = useAuth();
  const q = useQuery({ queryKey: ['admin-seller', id], queryFn: () => get(`/admin/sellers/${id}`) });
  const [dlg, setDlg] = useState<null | 'REJECT' | 'SUSPEND'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorBox message="Vendedor no encontrado." />;
  const { store, owner, finance, payoutAccounts, history } = q.data;
  const act = async (action: string, r?: string) => {
    setBusy(action);
    try {
      await post(`/admin/sellers/${id}/action`, { action, reason: r || undefined });
      toast.success(t('Tienda actualizada.'));
      setDlg(null); setReason('');
      q.refetch();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const verify = async (accId: string, approve: boolean) => {
    try { await post(`/admin/payout-accounts/${accId}/verify`, { approve }); toast.success(approve ? t('Método verificado.') : t('Método rechazado.')); q.refetch(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <>
      <PageHeader crumbs={[{ label: t('Vendedores'), href: '/admin/vendedores' }, { label: store.displayName }]} title={store.displayName} description={t('{a} · registrada el {b}', { a: store.legalName ?? '', b: fmtDate(store.createdAt) })}
        actions={<>
          {store.status === 'ACTIVE' && <Button variant="secondary" asChild><Link href={`/tienda/${store.slug}`} target="_blank"><ExternalLink /> {t('Ver tienda')}</Link></Button>}
          {['PENDING_VERIFICATION', 'DRAFT', 'REJECTED'].includes(store.status) && <Button onClick={() => act('APPROVE')} loading={busy === 'APPROVE'}><Check /> {t('Aprobar tienda')}</Button>}
          {['PENDING_VERIFICATION', 'DRAFT'].includes(store.status) && <Button variant="danger" onClick={() => setDlg('REJECT')}><X /> {t('Rechazar')}</Button>}
          {store.status === 'ACTIVE' && <Button variant="danger" onClick={() => setDlg('SUSPEND')}><Ban /> {t('Suspender')}</Button>}
          {store.status === 'SUSPENDED' && <Button onClick={() => act('REACTIVATE')} loading={busy === 'REACTIVATE'}><RotateCcw /> {t('Reactivar')}</Button>}
        </>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Estado')} value={<StatusBadge status={store.status} className="text-sm" />} />
        <StatCard label={t('Ventas (12 meses)')} value={money(finance.period.gross)} />
        <StatCard label={t('Saldo disponible')} value={money(finance.balances.available)} hint={t('Pendiente: {a}', { a: money(finance.balances.pending) })} />
        <StatCard label={t('Comisión generada')} value={money(finance.period.commission)} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title={t('Propietario y tienda')} />
          <dl className="grid gap-3 p-5 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">{t('Propietario')}</dt><dd className="font-semibold">{owner.name}</dd></div>
            <div><dt className="text-muted">{t('Correo')}</dt><dd className="font-semibold">{owner.email}</dd></div>
            <div><dt className="text-muted">{t('Teléfono')}</dt><dd className="font-semibold">{owner.phone ?? store.supportPhone ?? '—'}</dd></div>
            <div><dt className="text-muted">{t('Tipo de entidad')}</dt><dd className="font-semibold">{entityLabel(store.entityType)}{store.countryCode ? ` · ${countryName(store.countryCode)}` : ''}</dd></div>
            <div><dt className="text-muted">{t('Verificación')}</dt><dd><StatusBadge status={store.verificationStatus === 'VERIFIED' ? 'VERIFIED' : 'PENDING'} /></dd></div>
            <div><dt className="text-muted">{t('Despacho')}</dt><dd className="font-semibold">{store.shipFrom ? `${store.shipFrom.line1} · ${cityLine(store.shipFrom)}` : '—'}</dd></div>
            {store.shortDescription && <div className="sm:col-span-2"><dt className="text-muted">{t('Descripción')}</dt><dd>{store.shortDescription}</dd></div>}
          </dl>
        </Card>
        <Card>
          <CardHeader icon={<Landmark />} title={t('Métodos de cobro')} subtitle={t('Verifica las cuentas antes de habilitar retiros.')} />
          {payoutAccounts.length ? (
            <ul className="divide-y divide-line">
              {payoutAccounts.map((a: any) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="flex-1"><b>{a.label}</b> {a.last4 && <span className="text-muted">**** {a.last4}</span>}<p className="text-xs text-muted">{a.metadata?.holder_name} · {a.metadata?.account_type ?? a.methodCode} · {a.metadata?.currency}</p></div>
                  {a.verificationStatus === 'VERIFIED' ? <Badge tone="green"><ShieldCheck className="size-3" /> {t('Verificado')}</Badge> : a.verificationStatus === 'FAILED' ? <Badge tone="red">{t('Rechazado')}</Badge> : isAdmin ? (
                    <span className="flex gap-1"><Button size="sm" onClick={() => verify(a.id, true)}><Check /> {t('Verificar')}</Button><Button size="sm" variant="danger" onClick={() => verify(a.id, false)}><X /></Button></span>
                  ) : <Badge tone="amber">{t('Pendiente')}</Badge>}
                </li>
              ))}
            </ul>
          ) : <Empty title={t('Sin métodos de cobro registrados')} />}
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title={t('Historial de estado')} />
        {history.length ? (
          <ul className="divide-y divide-line text-sm">{history.map((h: any, i: number) => (
            <li key={i} className="flex flex-wrap items-center gap-3 px-5 py-3"><span className="text-muted">{fmtDateTime(h.created_at)}</span><span>{statusInfo(h.from_status)[0]} → <b>{statusInfo(h.to_status)[0]}</b></span><span className="text-muted">{h.reason}</span></li>
          ))}</ul>
        ) : <Empty title={t('Sin cambios registrados')} />}
      </Card>
      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} title={dlg === 'REJECT' ? t('Rechazar solicitud') : t('Suspender tienda')} description={t('El motivo se registra en el historial.')}
        footer={<><Button variant="secondary" onClick={() => setDlg(null)}>{t('Cancelar')}</Button><Button variant="dangerSolid" onClick={() => act(dlg!, reason)} loading={!!busy} disabled={!reason.trim()}>{t('Confirmar')}</Button></>}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Motivo…')} maxLength={300} />
        {dlg === 'SUSPEND' && <p className="mt-2 text-xs text-muted">{t('Los productos publicados de la tienda quedarán pausados.')}</p>}
      </Dialog>
    </>
  );
}
