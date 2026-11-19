'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, Clock, Landmark, Lock, MoreHorizontal, Plus, ShieldCheck, Star, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post, put } from '@/lib/api';
import { cn, fmtDate, money } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/input';
import { Checkbox, Empty } from '@/components/ui/misc';
import { CountrySelect } from '@/components/shop/geo-fields';
import { usePublicConfig } from '@/lib/config';
import { countryName, getLocale, t } from '@/lib/i18n';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'DOP', 'COP', 'CLP', 'PEN', 'ARS', 'BRL'];
const currencyName = (c: string) => {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'currency' }).of(c) ?? c;
  } catch {
    return c;
  }
};
type MethodType = 'BANK_ACCOUNT' | 'PAYPAL' | 'WISE' | 'PAYONEER' | 'ZELLE' | 'SKRILL';
/** Email-paid methods: what to ask for and a short note. Keep in sync with SELLER_PAYOUT_METHODS in the API. */
const WALLETS: Record<Exclude<MethodType, 'BANK_ACCOUNT'>, { name: string; field: string; hint?: string }> = {
  PAYPAL: { name: 'PayPal', field: 'Correo de PayPal' },
  WISE: { name: 'Wise', field: 'Correo de tu cuenta Wise', hint: 'Recibes en tu cuenta Wise y la retiras en tu moneda local.' },
  PAYONEER: { name: 'Payoneer', field: 'Correo de tu cuenta Payoneer', hint: 'Recibes en tu saldo de Payoneer.' },
  ZELLE: { name: 'Zelle', field: 'Correo o teléfono registrado en Zelle', hint: 'Solo para cuentas bancarias de EE. UU.' },
  SKRILL: { name: 'Skrill', field: 'Correo de tu cuenta Skrill', hint: 'Recibes en tu monedero Skrill.' },
};

const EMPTY = { holderName: '', bankName: '', accountNumber: '', accountType: 'CHECKING', routingOrSwift: '', countryCode: '', currency: '', documentId: '', alias: '', email: '' };

export default function PayoutMethodsPage() {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['payout-accounts'], queryFn: () => get('/seller/payout-accounts') });
  const payouts = useQuery({ queryKey: ['seller-payouts'], queryFn: () => get('/seller/payouts') });
  const [type, setType] = useState<MethodType>('BANK_ACCOUNT');
  const finance = useQuery({ queryKey: ['seller-finance-policy'], queryFn: () => get<any>('/seller/finance?days=7'), staleTime: 5 * 60_000 });
  const policy = finance.data?.payoutPolicy as { minimum?: string; approvalMode?: string } | null | undefined;
  const cfg = usePublicConfig();
  const store = useQuery({ queryKey: ['seller-store'], queryFn: () => get('/seller/store') });
  const [f, setF] = useState(EMPTY);
  const country = f.countryCode || store.data?.countryCode || '';
  const currency = f.currency || cfg?.currency || 'USD';
  const [primary, setPrimary] = useState(true);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const bank = type === 'BANK_ACCOUNT';
      await post('/seller/payout-accounts', {
        methodCode: type, holderName: f.holderName, bankName: bank ? f.bankName : undefined, accountNumber: bank ? f.accountNumber : undefined,
        accountType: bank ? f.accountType : undefined, routingOrSwift: bank ? f.routingOrSwift || undefined : undefined, countryCode: country || undefined,
        email: !bank ? f.email : undefined, currency, alias: f.alias || undefined, isPrimary: primary, documentId: f.documentId || undefined,
      });
      toast.success(t('Método guardado. Lo verificaremos antes de habilitar retiros.'));
      setF(EMPTY);
      qc.invalidateQueries({ queryKey: ['payout-accounts'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const action = async (id: string, a: 'PRIMARY' | 'DISABLE') => {
    try {
      await put(`/seller/payout-accounts/${id}`, { action: a });
      qc.invalidateQueries({ queryKey: ['payout-accounts'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const TYPES: [MethodType, string, typeof Landmark][] = [['BANK_ACCOUNT', t('Cuenta bancaria'), Landmark], ...Object.entries(WALLETS).map(([k, w]) => [k as MethodType, w.name, Wallet] as [MethodType, string, typeof Landmark])];
  const wallet = type !== 'BANK_ACCOUNT' ? WALLETS[type] : null;
  return (
    <>
      <PageHeader crumbs={[{ label: t('Configuración') }, { label: t('Métodos de cobro') }]} title={t('Métodos de cobro')} description={t('Registra uno o más métodos para recibir los retiros de tus fondos.')} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<Plus />} title={t('Agregar nuevo método de cobro')} subtitle={t('Configura una cuenta bancaria, PayPal, Wise, Payoneer, Zelle o Skrill para recibir tus fondos.')} />
            <div className="p-5">
              <p className="mb-2 text-sm font-semibold">{t('Tipo de método')}{' '}<span className="text-red-500">*</span></p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TYPES.map(([v, l, I]) => (
                  <button key={v} onClick={() => setType(v)} className={cn('flex items-center gap-3 rounded-xl border p-3 text-sm font-semibold', type === v ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200' : 'border-line')}>
                    <I className="size-5 text-brand-600" /> {l} <span className={cn('ml-auto size-4 rounded-full border-2', type === v ? 'border-brand-600 bg-brand-600 ring-2 ring-inset ring-white' : 'border-gray-300')} />
                  </button>
                ))}
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label={t('Nombre del titular')} required><Input rule="businessName" value={f.holderName} onChange={set('holderName')} placeholder={t('Ej. Juan Pérez García')} /></Field>
                {type === 'BANK_ACCOUNT' ? (
                  <>
                    <Field label={t('Banco')} required><Input rule="businessName" value={f.bankName} onChange={set('bankName')} placeholder={t('Ej. Chase, BBVA, Banco Popular')} /></Field>
                    <Field label={t('Número de cuenta o IBAN')} required hint={t('(se guarda cifrado)')}><Input rule="bankAccount" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder={t('ES91 2100 0418 4502 0005 1332')} /></Field>
                    <Field label={t('Tipo de cuenta')} required><Select value={f.accountType} onChange={set('accountType')}><option value="CHECKING">{t('Corriente')}</option><option value="SAVINGS">{t('Ahorros')}</option></Select></Field>
                    <Field label={t('Routing / SWIFT / BIC')}><Input rule="swift" value={f.routingOrSwift} onChange={set('routingOrSwift')} placeholder={t('021000021 · BBVAESMM')} /></Field>
                    <CountrySelect label={t('País del banco')} value={country} onChange={(v) => setF({ ...f, countryCode: v })} />
                    <Field label={t('Identificación fiscal del titular')}><Input rule="documentId" value={f.documentId} onChange={set('documentId')} /></Field>
                  </>
                ) : (
                  <Field label={t(wallet!.field)} required hint={wallet!.hint ? t(wallet!.hint) : undefined}>
                    {type === 'ZELLE'
                      ? <Input value={f.email} maxLength={254} onChange={set('email')} placeholder={t('tucorreo@ejemplo.com · +1 555 123 4567')} />
                      : <Input rule="email" type="email" value={f.email} onChange={set('email')} placeholder={t('tucorreo@ejemplo.com')} />}
                  </Field>
                )}
                <Field label={t('Moneda')} required><Select value={currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c} value={c}>{c} – {currencyName(c)}</option>)}</Select></Field>
                <Field label={t('Alias')} hint={t('(opcional)')}><Input value={f.alias} onChange={set('alias')} placeholder={t('Ej. Cuenta principal')} /></Field>
              </div>
              <div className="mt-4"><Checkbox checked={primary} onChange={setPrimary} label={<span><b>{t('Método principal')}</b> <span className="text-muted">{t('— se usará por defecto para tus retiros.')}</span></span>} /></div>
              <div className="mt-4 flex gap-3 rounded-xl bg-brand-50 p-4 text-sm"><Lock className="size-5 shrink-0 text-brand-600" /><span><b className="text-brand-800">{t('Verificación y seguridad.')}</b> {t('Verificaremos este método antes de habilitar retiros. Tus datos financieros se guardan cifrados y no se comparten con terceros.')}</span></div>
              <div className="mt-5 flex justify-end"><Button onClick={save} loading={busy}><Check /> {t('Guardar método')}</Button></div>
            </div>
          </Card>
          <Card>
            <CardHeader title={t('Métodos guardados')} subtitle={t('Administra tus métodos de cobro y elige el principal.')} />
            {accounts.data?.length ? (
              <div className="grid gap-3 p-5 md:grid-cols-2 2xl:grid-cols-3">
                {accounts.data.map((a: any) => (
                  <div key={a.id} className={cn('rounded-xl border p-4', a.metadata?.is_primary ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line')}>
                    <div className="flex items-start justify-between">
                      <p className="flex items-center gap-2 font-bold">{a.methodCode === 'BANK_ACCOUNT' ? <Landmark className="size-5 text-brand-600" /> : <Wallet className="size-5 text-brand-600" />} {a.label}</p>
                      <Dropdown.Root>
                        <Dropdown.Trigger className="rounded p-1 hover:bg-surface" aria-label={t('Acciones')}><MoreHorizontal className="size-4" /></Dropdown.Trigger>
                        <Dropdown.Portal><Dropdown.Content align="end" className="z-50 w-48 rounded-xl border border-line bg-white p-1 shadow-xl">
                          <Dropdown.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-brand-50" onSelect={() => action(a.id, 'PRIMARY')}><Star className="size-4" /> {t('Establecer como principal')}</Dropdown.Item>
                          <Dropdown.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 outline-none hover:bg-red-50" onSelect={() => confirm(t('¿Eliminar este método?')) && action(a.id, 'DISABLE')}><Trash2 className="size-4" /> {t('Eliminar')}</Dropdown.Item>
                        </Dropdown.Content></Dropdown.Portal>
                      </Dropdown.Root>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {a.metadata?.is_primary && <Badge>{t('Principal')}</Badge>}
                      {a.verificationStatus === 'VERIFIED' ? <Badge tone="green"><ShieldCheck className="size-3" /> {t('Verificado')}</Badge> : a.verificationStatus === 'FAILED' ? <Badge tone="red">{t('Rechazado')}</Badge> : <Badge tone="amber"><Clock className="size-3" /> {t('Pendiente')}</Badge>}
                    </div>
                    {a.verificationStatus === 'FAILED' && <p className="mt-2 text-xs text-red-600">{t('Finanzas no pudo verificar este método. Revisa los datos, elimínalo y agrégalo de nuevo.')}</p>}
                    <dl className="mt-3 space-y-0.5 text-xs text-muted">
                      <div>{a.methodCode === 'BANK_ACCOUNT' ? t('Cuenta') : a.metadata?.email_hint?.startsWith('***-') ? t('Teléfono') : t('Correo')}: <b className="text-ink">{a.methodCode === 'BANK_ACCOUNT' ? `**** ${a.last4}` : a.metadata?.email_hint}</b></div>
                      {a.methodCode !== 'BANK_ACCOUNT' && a.label !== (WALLETS as any)[a.methodCode]?.name && <div>{t('Método')}: {(WALLETS as any)[a.methodCode]?.name ?? t('Billetera digital')}</div>}
                      <div>{t('Titular:')}{' '}{a.metadata?.holder_name}</div>
                      <div>{t('Moneda')}: {a.metadata?.currency ?? '—'} · {t('País')}: {countryName(a.countryCode)}</div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : <Empty icon={<Landmark />} title={t('Aún no tienes métodos de cobro')} />}
          </Card>
        </div>
        <div className="space-y-5">
          <Card className="p-5">
            <p className="text-lg font-bold">{t('Cómo funciona')}</p>
            <ol className="mt-4 space-y-4 text-sm">
              {[[t('Registra tu método'), t('Agrega una cuenta bancaria, PayPal, Wise, Payoneer, Zelle o Skrill con tus datos.')], [t('Verificamos tu información'), t('Validamos tus datos para garantizar la seguridad de tus fondos.')], [t('Recibe tus cobros'), t('Solicita retiros de tu saldo disponible directamente a tu método verificado.')]].map(([title, d], i) => (
                <li key={title} className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 font-bold text-brand-700">{i + 1}</span><span><b className="block">{t(title)}</b><span className="text-muted">{t(d)}</span></span></li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title={t('Últimos cobros enviados')} />
            {payouts.data?.filter((p: any) => p.status === 'PAID').length ? (
              <ul className="divide-y divide-line text-sm">
                {payouts.data.filter((p: any) => p.status === 'PAID').slice(0, 6).map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between px-5 py-3"><span><span className="text-muted">{fmtDate(p.paidAt)}</span> · {p.accountLabel} (**** {p.accountLast4})</span><b className="text-emerald-700">+ {money(p.amount, p.currency)}</b></li>
                ))}
              </ul>
            ) : <Empty title={t('Aún no hay cobros enviados')} />}
          </Card>
          <Card className="p-5 text-sm">
            <p className="text-lg font-bold">{t('Tiempos y entidades compatibles')}</p>
            <p className="mt-2"><b>{t('Cómo se envían:')}</b> <span className="text-muted">{policy?.approvalMode && policy.approvalMode !== 'MANUAL' ? t('los retiros se aprueban automáticamente y finanzas envía el dinero a tu método; verás la referencia en Últimos cobros enviados.') : t('finanzas revisa y aprueba cada retiro, envía el dinero a tu método y registra la referencia, que verás en Últimos cobros enviados.')}</span></p>
            {policy?.minimum && Number(policy.minimum) > 0 && <p className="mt-2"><b>{t('Retiro mínimo:')}</b> <span className="text-muted">{money(policy.minimum)}</span></p>}
            <p className="mt-2"><b>{t('Entidades compatibles:')}</b> <span className="text-muted">{t('cuentas bancarias nacionales e internacionales (IBAN/SWIFT), PayPal, Wise, Payoneer, Zelle (EE. UU.) y Skrill.')}</span></p>
            {payouts.data?.some((p: any) => p.status !== 'PAID') && <p className="mt-3"><StatusBadge status="APPROVAL_REQUIRED" label={t('Tienes retiros en proceso')} /></p>}
          </Card>
        </div>
      </div>
    </>
  );
}
