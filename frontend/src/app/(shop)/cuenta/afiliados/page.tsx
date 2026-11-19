'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Handshake, Landmark, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, put } from '@/lib/api';
import { fmtDate, money } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Empty, PageLoader } from '@/components/ui/misc';
import { CountrySelect } from '@/components/shop/geo-fields';
import { affiliateUrl } from '@/lib/affiliates';

/** Wallets paid to an email (Zelle: email or US phone). Keep in sync with WALLET_METHODS in the API. */
const WALLETS: Record<string, { label: string; account: string; hint: string }> = {
  WISE: { label: 'Wise', account: 'Correo de tu cuenta Wise', hint: 'Recibes en tu cuenta Wise y la retiras en tu moneda local.' },
  PAYONEER: { label: 'Payoneer', account: 'Correo de tu cuenta Payoneer', hint: 'Recibes en tu saldo de Payoneer.' },
  ZELLE: { label: 'Zelle', account: 'Correo o teléfono registrado en Zelle', hint: 'Solo para cuentas bancarias de EE. UU.' },
  SKRILL: { label: 'Skrill', account: 'Correo de tu cuenta Skrill', hint: 'Recibes en tu monedero Skrill.' },
};

const STATUS: Record<string, [string, 'amber' | 'green' | 'blue' | 'gray']> = {
  PENDING: ['Pendiente', 'amber'], AVAILABLE: ['Disponible', 'blue'], PAID: ['Pagada', 'green'], REVERSED: ['Revertida', 'gray'],
};

export default function AffiliatePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-affiliates'], queryFn: () => get<any>('/me/affiliates') });
  const [p, setP] = useState({ method: 'PAYPAL', paypalEmail: '', walletAccount: '', holderName: '', bankName: '', accountNumber: '', accountType: 'CHECKING', routingCode: '', country: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const pp = q.data?.payoutProfile;
    if (pp) setP({ method: pp.method, paypalEmail: pp.paypalEmail ?? '', walletAccount: pp.bank?.account ?? '', holderName: pp.bank?.holderName ?? '', bankName: pp.bank?.bankName ?? '', accountNumber: pp.bank?.accountNumber ?? '', accountType: pp.bank?.accountType || 'CHECKING', routingCode: pp.bank?.routingCode ?? '', country: pp.bank?.country ?? '' });
  }, [q.data?.payoutProfile]);
  if (q.isLoading || !q.data) return <PageLoader />;
  const d = q.data;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('Enlace copiado.')));
  const saveProfile = async () => {
    setBusy(true);
    try {
      await put('/me/affiliates/payout-profile', p.method === 'PAYPAL'
        ? { method: 'PAYPAL', paypalEmail: p.paypalEmail }
        : WALLETS[p.method]
        ? { method: p.method, wallet: { holderName: p.holderName, account: p.walletAccount } }
        : { method: 'BANK', bank: { holderName: p.holderName, bankName: p.bankName, accountNumber: p.accountNumber, accountType: p.accountType, routingCode: p.routingCode, country: p.country } });
      toast.success(t('Método de cobro guardado.'));
      qc.invalidateQueries({ queryKey: ['my-affiliates'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-affiliate-dashboard>
      <h1 className="text-3xl font-extrabold">{t('Afiliados')}</h1>
      <p className="text-muted">{t('Recomienda productos con tu enlace y gana una comisión por cada compra. La paga la tienda; la plataforma te la transfiere.')}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-sm text-muted">{t('Pendiente')}</p><p className="mt-1 text-2xl font-extrabold" data-aff-pending>{money(d.balances.pending)}</p><p className="text-xs text-muted">{t('Hasta la entrega y el plazo de devolución')}</p></div>
        <div className="card p-5"><p className="text-sm text-muted">{t('Disponible para cobrar')}</p><p className="mt-1 text-2xl font-extrabold text-brand-700" data-aff-available>{money(d.balances.available)}</p><p className="text-xs text-muted">{t('Te lo pagamos a tu método de cobro')}</p></div>
        <div className="card p-5"><p className="text-sm text-muted">{t('Cobrado')}</p><p className="mt-1 text-2xl font-extrabold text-emerald-700">{money(d.balances.paid)}</p></div>
      </div>

      <div className="card mt-6">
        <div className="border-b border-line p-5"><p className="flex items-center gap-2 font-bold"><Handshake className="size-5 text-brand-600" /> {t('Mis enlaces')}</p><p className="text-sm text-muted">{t('Obtén un enlace desde la página de cualquier producto con programa de afiliados.')}</p></div>
        {d.links.length ? (
          <ul className="divide-y divide-line">
            {d.links.map((l: any) => (
              <li key={l.code} className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm" data-aff-link>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold"><Link href={`/tienda/${l.slug}`} className="hover:text-brand-700">{l.store}</Link> {!l.active && <Badge tone="gray">{t('Pausado')}</Badge>}</p>
                  <p className="truncate text-muted">{affiliateUrl(`/tienda/${l.slug}`, l.code)}</p>
                  <p className="text-xs text-muted">{t('{r} % de comisión · enlace válido {d} días · {v} visitas · {o} pedidos', { r: l.ratePercent ?? '—', d: l.windowDays, v: l.visitors, o: l.orders })}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => copy(affiliateUrl(`/tienda/${l.slug}`, l.code))}><Copy /> {t('Copiar enlace')}</Button>
              </li>
            ))}
          </ul>
        ) : <Empty icon={<Handshake />} title={t('Aún no tienes enlaces')} description={t('Busca productos con «Gana recomendando» y genera tu enlace.')} />}
      </div>

      <div className="card mt-6">
        <div className="border-b border-line p-5 font-bold">{t('Comisiones')}</div>
        {d.earnings.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-aff-earnings>
              <thead className="bg-surface text-left text-xs text-muted"><tr><th className="px-5 py-2.5">{t('Fecha')}</th><th>{t('Tienda')}</th><th>{t('Producto')}</th><th>{t('Comisión')}</th><th>{t('Estado')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.earnings.map((e: any) => (
                  <tr key={e.id}>
                    <td className="px-5 py-3 text-muted">{fmtDate(e.createdAt)}</td>
                    <td>{e.store}</td>
                    <td className="max-w-[220px] truncate">{e.product}</td>
                    <td className="font-semibold">{money(e.amount, e.currency)}{Number(e.reversed) > 0 && <span className="block text-xs font-normal text-muted">{t('Revertido: {a}', { a: money(e.reversed, e.currency) })}</span>}</td>
                    <td><Badge tone={STATUS[e.status]?.[1] ?? 'gray'}>{t(STATUS[e.status]?.[0] ?? e.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={<Wallet />} title={t('Todavía no tienes comisiones')} />}
      </div>

      <div className="card mt-6 p-5" data-aff-payout>
        <p className="flex items-center gap-2 font-bold"><Landmark className="size-5 text-brand-600" /> {t('Método de cobro')}</p>
        <p className="text-sm text-muted">{t('Dónde te enviamos tus comisiones disponibles.')}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={t('Cobrar por')} required>
            <Select value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })} data-aff-method>
              <option value="PAYPAL">PayPal</option>
              <option value="BANK">{t('Transferencia bancaria')}</option>
              {Object.entries(WALLETS).map(([k, w]) => <option key={k} value={k}>{w.label}</option>)}
            </Select>
          </Field>
          {p.method === 'PAYPAL' ? (
            <Field label={t('Correo de tu cuenta PayPal')} required><Input type="email" value={p.paypalEmail} onChange={(e) => setP({ ...p, paypalEmail: e.target.value })} data-aff-paypal /></Field>
          ) : WALLETS[p.method] ? (
            <>
              <Field label={t(WALLETS[p.method].account)} required hint={t(WALLETS[p.method].hint)}>
                <Input type={p.method === 'ZELLE' ? 'text' : 'email'} value={p.walletAccount} maxLength={254} onChange={(e) => setP({ ...p, walletAccount: e.target.value })} data-aff-wallet />
              </Field>
              <Field label={t('Titular')} required><Input value={p.holderName} maxLength={80} onChange={(e) => setP({ ...p, holderName: e.target.value })} /></Field>
            </>
          ) : (
            <>
              <Field label={t('Titular')} required><Input value={p.holderName} maxLength={80} onChange={(e) => setP({ ...p, holderName: e.target.value })} /></Field>
              <Field label={t('Banco')} required><Input value={p.bankName} maxLength={80} onChange={(e) => setP({ ...p, bankName: e.target.value })} /></Field>
              <Field label={t('Número de cuenta / IBAN')} required><Input value={p.accountNumber} maxLength={40} onChange={(e) => setP({ ...p, accountNumber: e.target.value.replace(/\s/g, '') })} /></Field>
              <Field label={t('Tipo de cuenta')}>
                <Select value={p.accountType} onChange={(e) => setP({ ...p, accountType: e.target.value })}>
                  <option value="CHECKING">{t('Corriente')}</option><option value="SAVINGS">{t('Ahorros')}</option>
                </Select>
              </Field>
              <Field label={t('Código SWIFT / ruta (opcional)')}><Input value={p.routingCode} maxLength={20} onChange={(e) => setP({ ...p, routingCode: e.target.value })} /></Field>
              <CountrySelect value={p.country} onChange={(v) => setP({ ...p, country: v })} required />
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end"><Button loading={busy} onClick={saveProfile} data-aff-payout-save>{t('Guardar método de cobro')}</Button></div>
      </div>
    </div>
  );
}
