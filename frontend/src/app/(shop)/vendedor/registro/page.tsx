'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Building2, Check, Clock, FileText, MapPin, Store, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/misc';
import { CountrySelect, GeoFields, PhoneInput } from '@/components/shop/geo-fields';
import { ENTITY_TYPES, entityLabel, fiscalPayload, taxIdHint } from '@/lib/entities';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Draft kept in this browser so a visitor who must create an account first does not lose what they typed.
// The tax id is never stored here.
const DRAFT_KEY = 'nx_seller_draft';
const readDraft = (): Record<string, string> | null => {
  try { const v = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
};
const writeDraft = (v: Record<string, string> | null) => {
  try { v ? window.localStorage.setItem(DRAFT_KEY, JSON.stringify(v)) : window.localStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked */ }
};

export default function SellerOnboardingPage() {
  const { session, loading, seller, me, refresh } = useAuth();
  const router = useRouter();
  const cfg = useQuery({ queryKey: ['public-config'], queryFn: () => get('/config/public'), staleTime: 60_000 });
  const [f, setF] = useState({ storeName: '', shortDescription: '', supportEmail: '', supportPhone: '', legalName: '', entityType: 'COMPANY', countryCode: '', taxId: '', contactName: '', line1: '', line2: '', city: '', region: '', postalCode: '', phone: '' });
  const [shipCountry, setShipCountry] = useState('');
  const geo = { countryCode: shipCountry || f.countryCode, city: f.city, region: f.region, postalCode: f.postalCode };
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const d = readDraft();
    if (d) {
      const { shipCountry: sc, ...rest } = d;
      setF((s) => { const n: any = { ...s }; for (const k of Object.keys(s)) if (k !== 'taxId' && typeof rest[k] === 'string') n[k] = rest[k]; return n; });
      if (typeof sc === 'string') setShipCountry(sc);
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored || seller) return;
    const { taxId: _omit, ...rest } = f;
    writeDraft(Object.values(rest).some((v) => v.trim()) ? { ...rest, shipCountry } : null);
  }, [f, shipCountry, restored, seller]);
  const closed = !!cfg.data && !cfg.data.sellerRegistration;
  const missing = [
    [!f.storeName.trim(), t('Nombre de la tienda')],
    [!!f.taxId.trim() && !f.legalName.trim(), t('Nombre o razón social')],
    [!f.contactName.trim() && !me?.displayName, t('Persona de contacto')],
    [!f.phone, t('Teléfono')],
    [!f.line1.trim(), t('Dirección')],
    [!geo.countryCode, t('País')],
    [!f.city.trim(), t('Ciudad')],
  ].filter(([m]) => m).map(([, l]) => l as string);
  if (loading) return <PageLoader />;
  if (seller)
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <div className="card p-8 text-center">
          {seller.status === 'ACTIVE' ? <BadgeCheck className="mx-auto size-14 text-emerald-500" /> : <Clock className="mx-auto size-14 text-amber-500" />}
          <h1 className="mt-4 text-2xl font-extrabold">{seller.status === 'ACTIVE' ? t('Tu tienda está activa') : t('Tu solicitud está en revisión')}</h1>
          <p className="mt-2 text-muted">{seller.status === 'ACTIVE' ? t('Gestiona productos, pedidos y finanzas desde tu panel.') : t('Nuestro equipo está revisando tu tienda. Mientras tanto puedes preparar tus productos.')}</p>
          <Button className="mt-6" asChild><Link href="/vendedor/dashboard">{t('Ir al panel de vendedor')}</Link></Button>
        </div>
      </div>
    );
  const submit = async () => {
    if (!session) return router.push('/auth/registrarse?next=/vendedor/registro');
    if (missing.length) return toast.error(t('Falta completar: {a}.', { a: missing.join(', ') }));
    if (!accept) return toast.error(t('Debes aceptar los términos para vendedores.'));
    setBusy(true);
    try {
      await post('/seller/onboarding', {
        acceptTerms: accept,
        storeName: f.storeName, shortDescription: f.shortDescription || undefined, supportEmail: f.supportEmail || undefined, supportPhone: f.supportPhone || undefined,
        ...fiscalPayload(f),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        address: { contactName: f.contactName || me?.displayName, line1: f.line1, line2: f.line2 || undefined, countryCode: geo.countryCode, city: f.city, region: f.region || undefined, postalCode: f.postalCode || undefined, phone: f.phone },
      });
      toast.success(t('¡Tu tienda está activa! Ya puedes publicar tus productos.'));
      writeDraft(null);
      refresh();
      setTimeout(() => router.push('/vendedor/dashboard'), 600);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 lg:px-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="card p-6 sm:p-8">
          <h1 className="text-3xl font-extrabold">{t('Abre tu tienda en NEXOVAX')}</h1>
          <p className="mt-1 text-muted">{t('Completa tus datos y tu tienda quedará activa al instante.')}</p>
          {!session && <p className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-sm" data-need-account>{t('Necesitas una cuenta.')}{' '}<Link href="/auth/registrarse?next=/vendedor/registro" className="font-semibold text-brand-700 underline">{t('Crea tu cuenta')}</Link>{' '}{t('o')}{' '}<Link href="/auth/iniciar-sesion?next=/vendedor/registro" className="font-semibold text-brand-700 underline">{t('inicia sesión')}</Link>.{' '}{t('Lo que escribas aquí se guarda en este navegador mientras tanto.')}</p>}
          {closed && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" data-registration-closed>{t('El registro de nuevos vendedores está cerrado temporalmente. Vuelve pronto.')}</p>}
          <fieldset disabled={closed} className={cn('m-0 min-w-0 border-0 p-0', closed && 'pointer-events-none opacity-50')}>
          <h2 className="mt-8 flex items-center gap-2 text-lg font-bold"><Store className="size-5 text-brand-600" /> {t('Tu tienda')}</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('Nombre de la tienda')} required><Input rule="businessName" value={f.storeName} onChange={set('storeName')} placeholder={t('Ej. Urban Style Co.')} /></Field>
            <Field label={t('Descripción corta')}><Input value={f.shortDescription} onChange={set('shortDescription')} placeholder={t('Qué vendes en una frase')} maxLength={200} /></Field>
            <Field label={t('Correo de atención')}><Input rule="email" type="email" value={f.supportEmail} onChange={set('supportEmail')} placeholder={t('ventas@mitienda.com')} /></Field>
            <Field label={t('Teléfono de atención')}><PhoneInput countryCode={f.countryCode || geo.countryCode} value={f.supportPhone} onChange={(v) => setF((s) => ({ ...s, supportPhone: v }))} /></Field>
          </div>
          <h2 className="mt-8 flex items-center gap-2 text-lg font-bold"><FileText className="size-5 text-brand-600" /> {t('Datos fiscales')} <span className="text-sm font-normal text-muted">{t('(opcional)')}</span></h2>
          <p className="text-sm text-muted">{t('Puedes completarlos ahora o más tarde desde Configuración. Con los datos fiscales completos, tus recibos muestran tu razón social e identificación fiscal. Escribirlos no verifica tu identidad.')}</p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('Nombre o razón social')} hint={f.taxId ? t('(requerido con la identificación fiscal)') : undefined}><Input rule="businessName" value={f.legalName} onChange={set('legalName')} placeholder={t('Ej. Urban Style LLC')} /></Field>
            <Field label={t('Tipo de entidad')}>
              <Select value={f.entityType} onChange={set('entityType')}>{ENTITY_TYPES.map((e) => <option key={e} value={e}>{entityLabel(e)}</option>)}</Select>
            </Field>
            <CountrySelect label={t('País de registro')} value={f.countryCode} onChange={(v) => setF({ ...f, countryCode: v })} />
            <Field label={taxIdHint(f.countryCode)} hint={t('(se guarda cifrado)')}><Input rule="taxId" value={f.taxId} onChange={set('taxId')} /></Field>
          </div>
          <h2 className="mt-8 flex items-center gap-2 text-lg font-bold"><MapPin className="size-5 text-brand-600" /> {t('Dirección de despacho')}</h2>
          <p className="text-sm text-muted">{t('Desde aquí se calculan las tarifas de envío y se generan las etiquetas.')}</p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('Persona de contacto')} required><Input rule="personName" value={f.contactName} onChange={set('contactName')} placeholder={me?.displayName ?? ''} /></Field>
            <Field label={t('Teléfono')} required><PhoneInput countryCode={geo.countryCode} value={f.phone} onChange={(v) => setF((s) => ({ ...s, phone: v }))} required /></Field>
            <Field label={t('Dirección')} required className="sm:col-span-2"><Input value={f.line1} onChange={set('line1')} placeholder={t('Calle y número')} /></Field>
            <Field label={t('Apartamento, suite o referencia')} className="sm:col-span-2"><Input value={f.line2} onChange={set('line2')} /></Field>
            <GeoFields value={geo} onChange={(p) => { if (p.countryCode !== undefined) setShipCountry(p.countryCode); setF((s) => ({ ...s, ...('city' in p ? { city: p.city! } : {}), ...('region' in p ? { region: p.region! } : {}), ...('postalCode' in p ? { postalCode: p.postalCode! } : {}) })); }} />
          </div>
          <label className="mt-6 flex items-start gap-2 text-sm"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" data-seller-terms /> <span>{t('Acepto los términos para vendedores, la comisión vigente del marketplace y las políticas de contenido.')}{' '}<Link href="/terminos-vendedores" target="_blank" className="font-semibold text-brand-700 underline">{t('Leer los términos para vendedores')}</Link></span></label>
          </fieldset>
          {!closed && (session ? (
            <div className="mt-6">
              <Button size="lg" className="w-full sm:w-auto" onClick={submit} loading={busy} data-open-store><Check /> {t('Abrir mi tienda')}</Button>
              {missing.length > 0 && <p className="mt-2 text-sm text-muted" data-missing>{t('Falta completar: {a}.', { a: missing.join(', ') })}</p>}
            </div>
          ) : (
            <div className="mt-6">
              <Button size="lg" className="w-full sm:w-auto" asChild><Link href="/auth/registrarse?next=/vendedor/registro"><Check /> {t('Crear mi cuenta y continuar')}</Link></Button>
              <p className="mt-2 text-sm text-muted">{t('Al volver encontrarás tus datos tal como los dejaste.')}</p>
            </div>
          ))}
        </div>
        <aside className="space-y-4">
          {[[Building2, t('Crea tu tienda'), t('Publica tu catálogo con variantes, fotos e inventario.')], [Users, t('Llega a más clientes'), t('Vende en tu país y al exterior con envíos y pagos integrados.')], [TrendingUp, t('Haz crecer tus ventas'), t('Panel de ventas, inventario y finanzas en tiempo real.')]].map(([I, title, d]: any) => (
            <div key={title} className="card flex gap-3 p-5"><I className="size-8 shrink-0 text-brand-600" /><div><p className="font-bold">{t(title)}</p><p className="text-sm text-muted">{t(d)}</p></div></div>
          ))}
        </aside>
      </div>
    </div>
  );
}
