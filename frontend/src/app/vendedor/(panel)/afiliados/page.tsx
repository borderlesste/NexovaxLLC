'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Handshake, Info, ShoppingCart, Users, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, put } from '@/lib/api';
import { money } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { PageLoader, Switch } from '@/components/ui/misc';
import { ProductPicker } from '@/components/seller/product-picker';

export default function SellerAffiliatesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seller-affiliates'], queryFn: () => get<any>('/seller/affiliates') });
  const [f, setF] = useState({ enabled: false, ratePercent: '5', windowDays: '30', productIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setF({ enabled: q.data.enabled, ratePercent: String(q.data.ratePercent), windowDays: String(q.data.windowDays), productIds: q.data.productIds });
  }, [q.data]);
  if (q.isLoading || !q.data) return <PageLoader />;
  const s = q.data.stats;
  const save = async () => {
    setBusy(true);
    try {
      await put('/seller/affiliates', { enabled: f.enabled, ratePercent: Number(f.ratePercent), windowDays: Number(f.windowDays), productIds: f.productIds });
      toast.success(f.enabled ? t('Programa de afiliados activo.') : t('Programa de afiliados pausado.'));
      qc.invalidateQueries({ queryKey: ['seller-affiliates'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader crumbs={[{ label: t('Inicio') }, { label: t('Afiliados') }]} title={t('Programa de afiliados')}
        description={t('Deja que otras personas recomienden tus productos con su enlace y págales una comisión solo por las ventas que generen.')} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Afiliados con ventas')} value={s.affiliates} icon={<Users />} />
        <StatCard label={t('Pedidos por afiliados')} value={s.orders} icon={<ShoppingCart />} hint={t('Ventas: {a}', { a: money(s.sales) })} />
        <StatCard label={t('Comisiones pendientes')} value={money(s.pending)} icon={<Coins />} hint={t('Hasta la entrega y el plazo de devolución')} />
        <StatCard label={t('Comisiones confirmadas')} value={money(s.confirmed)} icon={<Wallet />} hint={t('Revertidas: {a}', { a: money(s.reversed) })} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card data-affiliate-program>
          <CardHeader icon={<Handshake />} title={t('Configuración')} subtitle={t('Tú decides si pagas a afiliados, cuánto y por qué productos.')} />
          <div className="space-y-5 p-5">
            <label className="flex items-center gap-3 text-sm font-semibold"><Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} /> {f.enabled ? t('Programa activo') : t('Programa pausado')}</label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Comisión para el afiliado (%)')} required hint={t('Sobre el precio de venta del producto (después de cupones, sin envío ni impuestos).')}>
                <Input type="number" min={0.5} max={50} step="0.01" value={f.ratePercent} onChange={(e) => setF({ ...f, ratePercent: e.target.value })} data-affiliate-rate />
              </Field>
              <Field label={t('Vigencia del enlace (días)')} required hint={t('Si el cliente compra dentro de este plazo después de entrar por el enlace, la venta cuenta para el afiliado.')}>
                <Input type="number" min={1} max={90} step="1" value={f.windowDays} onChange={(e) => setF({ ...f, windowDays: e.target.value })} />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">{t('Productos incluidos')}</p>
              <ProductPicker value={f.productIds} onChange={(ids) => setF({ ...f, productIds: ids })} />
            </div>
            <div className="flex justify-end"><Button loading={busy} onClick={save} data-affiliate-save>{t('Guardar programa')}</Button></div>
          </div>
        </Card>
        <Card className="h-fit">
          <CardHeader icon={<Info />} title={t('Cómo funciona')} />
          <ol className="list-decimal space-y-2 p-5 pl-9 text-sm text-muted">
            <li>{t('Cualquier usuario registrado obtiene su enlace desde la página de tus productos.')}</li>
            <li>{t('Si un cliente compra con ese enlace, el afiliado gana la comisión que definiste sobre los productos incluidos.')}</li>
            <li>{t('La comisión se descuenta de lo que recibes por esa venta; la plataforma se la paga al afiliado.')}</li>
            <li>{t('Queda pendiente hasta que el pedido se entrega y pasa el plazo de devolución. Si se cancela o se devuelve, la comisión se revierte y vuelve a tu saldo.')}</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
