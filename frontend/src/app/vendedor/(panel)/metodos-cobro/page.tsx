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

const BANKS = ['Banreservas', 'Banco Popular', 'Banco BHD', 'Scotiabank', 'Banco Santa Cruz', 'Asociación Popular de Ahorros y Préstamos', 'Banco Promerica', 'Banco Caribe', 'Banesco', 'Banco Vimenca', 'Banco López de Haro', 'Citibank'];

export default function PayoutMethodsPage() {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['payout-accounts'], queryFn: () => get('/seller/payout-accounts') });
  const payouts = useQuery({ queryKey: ['seller-payouts'], queryFn: () => get('/seller/payouts') });
  const [type, setType] = useState<'BANK_ACCOUNT' | 'PAYPAL' | 'DIGITAL_WALLET'>('BANK_ACCOUNT');
  const [f, setF] = useState({ holderName: '', bankName: '', accountNumber: '', accountType: 'AHORROS', currency: 'DOP', documentId: '', alias: '', email: '' });
  const [primary, setPrimary] = useState(true);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await post('/seller/payout-accounts', { methodCode: type, holderName: f.holderName, bankName: type === 'BANK_ACCOUNT' ? f.bankName : undefined, accountNumber: type === 'BANK_ACCOUNT' ? f.accountNumber : undefined, accountType: type === 'BANK_ACCOUNT' ? f.accountType : undefined, email: type !== 'BANK_ACCOUNT' ? f.email : undefined, currency: f.currency, alias: f.alias || undefined, isPrimary: primary, documentId: f.documentId || undefined });
      toast.success('Método guardado. Lo verificaremos antes de habilitar retiros.');
      setF({ holderName: '', bankName: '', accountNumber: '', accountType: 'AHORROS', currency: 'DOP', documentId: '', alias: '', email: '' });
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
  const TYPES = [['BANK_ACCOUNT', 'Cuenta bancaria', Landmark], ['PAYPAL', 'PayPal', Wallet], ['DIGITAL_WALLET', 'Billetera digital', Wallet]] as const;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Configuración' }, { label: 'Métodos de cobro' }]} title="Métodos de cobro" description="Registra uno o más métodos para recibir los retiros de tus fondos." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<Plus />} title="Agregar nuevo método de cobro" subtitle="Configura una cuenta bancaria, PayPal o una billetera digital para recibir tus fondos." />
            <div className="p-5">
              <p className="mb-2 text-sm font-semibold">Tipo de método <span className="text-red-500">*</span></p>
              <div className="grid gap-2 sm:grid-cols-3">
                {TYPES.map(([v, l, I]) => (
                  <button key={v} onClick={() => setType(v)} className={cn('flex items-center gap-3 rounded-xl border p-3 text-sm font-semibold', type === v ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200' : 'border-line')}>
                    <I className="size-5 text-brand-600" /> {l} <span className={cn('ml-auto size-4 rounded-full border-2', type === v ? 'border-brand-600 bg-brand-600 ring-2 ring-inset ring-white' : 'border-gray-300')} />
                  </button>
                ))}
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Nombre del titular" required><Input value={f.holderName} onChange={set('holderName')} placeholder="Ej. Juan Pérez García" /></Field>
                {type === 'BANK_ACCOUNT' ? (
                  <>
                    <Field label="Entidad / Banco" required><Select value={f.bankName} onChange={set('bankName')}><option value="">Selecciona una entidad bancaria</option>{BANKS.map((b) => <option key={b}>{b}</option>)}</Select></Field>
                    <Field label="Número de cuenta" required hint="(se guarda cifrado)"><Input value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value.replace(/\D/g, '') })} placeholder="Ej. 9601234821" /></Field>
                    <Field label="Tipo de cuenta" required><Select value={f.accountType} onChange={set('accountType')}><option value="AHORROS">Ahorros</option><option value="CORRIENTE">Corriente</option></Select></Field>
                    <Field label="Documento / Identificación fiscal"><Input value={f.documentId} onChange={set('documentId')} placeholder="Ej. 001-1234567-8 (RNC o cédula)" /></Field>
                  </>
                ) : (
                  <Field label={type === 'PAYPAL' ? 'Correo de PayPal' : 'Correo de la billetera'} required><Input type="email" value={f.email} onChange={set('email')} placeholder="tucorreo@ejemplo.com" /></Field>
                )}
                <Field label="Moneda" required><Select value={f.currency} onChange={set('currency')}><option value="DOP">DOP – Peso dominicano</option><option value="USD">USD – Dólar</option></Select></Field>
                <Field label="Alias" hint="(opcional)"><Input value={f.alias} onChange={set('alias')} placeholder="Ej. Cuenta principal" /></Field>
              </div>
              <div className="mt-4"><Checkbox checked={primary} onChange={setPrimary} label={<span><b>Método principal</b> <span className="text-muted">— se usará por defecto para tus retiros.</span></span>} /></div>
              <div className="mt-4 flex gap-3 rounded-xl bg-brand-50 p-4 text-sm"><Lock className="size-5 shrink-0 text-brand-600" /><span><b className="text-brand-800">Verificación y seguridad.</b> Verificaremos este método antes de habilitar retiros. Tus datos financieros se guardan cifrados y no se comparten con terceros.</span></div>
              <div className="mt-5 flex justify-end"><Button onClick={save} loading={busy}><Check /> Guardar método</Button></div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Métodos guardados" subtitle="Administra tus métodos de cobro y elige el principal." />
            {accounts.data?.length ? (
              <div className="grid gap-3 p-5 md:grid-cols-2 2xl:grid-cols-3">
                {accounts.data.map((a: any) => (
                  <div key={a.id} className={cn('rounded-xl border p-4', a.metadata?.is_primary ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line')}>
                    <div className="flex items-start justify-between">
                      <p className="flex items-center gap-2 font-bold">{a.methodCode === 'BANK_ACCOUNT' ? <Landmark className="size-5 text-brand-600" /> : <Wallet className="size-5 text-brand-600" />} {a.label}</p>
                      <Dropdown.Root>
                        <Dropdown.Trigger className="rounded p-1 hover:bg-surface" aria-label="Acciones"><MoreHorizontal className="size-4" /></Dropdown.Trigger>
                        <Dropdown.Portal><Dropdown.Content align="end" className="z-50 w-48 rounded-xl border border-line bg-white p-1 shadow-xl">
                          <Dropdown.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-brand-50" onSelect={() => action(a.id, 'PRIMARY')}><Star className="size-4" /> Establecer como principal</Dropdown.Item>
                          <Dropdown.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 outline-none hover:bg-red-50" onSelect={() => confirm('¿Eliminar este método?') && action(a.id, 'DISABLE')}><Trash2 className="size-4" /> Eliminar</Dropdown.Item>
                        </Dropdown.Content></Dropdown.Portal>
                      </Dropdown.Root>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {a.metadata?.is_primary && <Badge>Principal</Badge>}
                      {a.verificationStatus === 'VERIFIED' ? <Badge tone="green"><ShieldCheck className="size-3" /> Verificado</Badge> : a.verificationStatus === 'FAILED' ? <Badge tone="red">Rechazado</Badge> : <Badge tone="amber"><Clock className="size-3" /> Pendiente</Badge>}
                    </div>
                    <dl className="mt-3 space-y-0.5 text-xs text-muted">
                      <div>{a.methodCode === 'BANK_ACCOUNT' ? 'Cuenta' : 'Correo'}: <b className="text-ink">{a.methodCode === 'BANK_ACCOUNT' ? `**** ${a.last4}` : a.metadata?.email_hint}</b></div>
                      <div>Titular: {a.metadata?.holder_name}</div>
                      <div>Moneda: {a.metadata?.currency ?? 'DOP'} · País: República Dominicana</div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : <Empty icon={<Landmark />} title="Aún no tienes métodos de cobro" />}
          </Card>
        </div>
        <div className="space-y-5">
          <Card className="p-5">
            <p className="text-lg font-bold">Cómo funciona</p>
            <ol className="mt-4 space-y-4 text-sm">
              {[['Registra tu método', 'Agrega una cuenta bancaria, PayPal o billetera digital con tus datos.'], ['Verificamos tu información', 'Validamos tus datos para garantizar la seguridad de tus fondos.'], ['Recibe tus cobros', 'Solicita retiros de tu saldo disponible directamente a tu método verificado.']].map(([t, d], i) => (
                <li key={t} className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 font-bold text-brand-700">{i + 1}</span><span><b className="block">{t}</b><span className="text-muted">{d}</span></span></li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title="Últimos cobros enviados" />
            {payouts.data?.filter((p: any) => p.status === 'PAID').length ? (
              <ul className="divide-y divide-line text-sm">
                {payouts.data.filter((p: any) => p.status === 'PAID').slice(0, 6).map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between px-5 py-3"><span><span className="text-muted">{fmtDate(p.paidAt)}</span> · {p.accountLabel} (**** {p.accountLast4})</span><b className="text-emerald-700">+ {money(p.amount)}</b></li>
                ))}
              </ul>
            ) : <Empty title="Aún no hay cobros enviados" />}
          </Card>
          <Card className="p-5 text-sm">
            <p className="text-lg font-bold">Tiempos y entidades compatibles</p>
            <p className="mt-2"><b>Tiempos de procesamiento:</b> <span className="text-muted">los retiros se procesan en 1 a 3 días hábiles tras la aprobación de finanzas.</span></p>
            <p className="mt-2"><b>Entidades compatibles:</b> <span className="text-muted">bancos locales de República Dominicana, PayPal y billeteras digitales.</span></p>
            {payouts.data?.some((p: any) => p.status !== 'PAID') && <p className="mt-3"><StatusBadge status="APPROVAL_REQUIRED" label="Tienes retiros en proceso" /></p>}
          </Card>
        </div>
      </div>
    </>
  );
}
