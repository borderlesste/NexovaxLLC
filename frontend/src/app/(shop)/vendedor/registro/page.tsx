'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Building2, Check, Clock, FileText, MapPin, Store, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/misc';
import { CountrySelect, GeoFields } from '@/components/shop/geo-fields';
import { ENTITY_TYPES, entityLabel, taxIdHint } from '@/lib/entities';
import { t } from '@/lib/i18n';

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
  if (loading) return <PageLoader />;
  if (seller)
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <div className="card p-8 text-center">
          {seller.status === 'ACTIVE' ? <BadgeCheck className="mx-auto size-14 text-emerald-500" /> : <Clock className="mx-auto size-14 text-amber-500" />}
          <h1 className="mt-4 text-2xl font-extrabold">{seller.status === 'ACTIVE' ? t('Tu tienda está activa') : t('Tu solicitud está en revisión')}</h1>
          <p className="mt-2 text-muted">{seller.status === 'ACTIVE' ? t('Gestiona productos, pedidos y finanzas desde tu panel.') : t('Nuestro equipo está verificando tu información. Mientras tanto puedes crear tus productos.')}</p>
          <Button className="mt-6" asChild><Link href="/vendedor/dashboard">{t('Ir al panel de vendedor')}</Link></Button>
        </div>
      </div>
    );
  const submit = async () => {
    if (!session) return router.push('/auth/registrarse?next=/vendedor/registro');
    if (!accept) return toast.error(t('Debes aceptar los términos para vendedores.'));
    setBusy(true);
    try {
      await post('/seller/onboarding', {
        storeName: f.storeName, shortDescription: f.shortDescription || undefined, supportEmail: f.supportEmail || undefined, supportPhone: f.supportPhone || undefined,
        legalName: f.legalName, entityType: f.entityType, countryCode: f.countryCode, taxId: f.taxId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        address: { contactName: f.contactName || me?.displayName, line1: f.line1, line2: f.line2 || undefined, countryCode: geo.countryCode, city: f.city, region: f.region || undefined, postalCode: f.postalCode || undefined, phone: f.phone },
      });
      toast.success(t('¡Solicitud enviada! Te avisaremos cuando tu tienda sea aprobada.'));
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
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="card p-6 sm:p-8">
          <h1 className="text-3xl font-extrabold">{t('Abre tu tienda en NEXOVAX')}</h1>
          <p className="mt-1 text-muted">{t('Completa tus datos. Verificaremos tu información antes de activar la tienda.')}</p>
          {!session && <p className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-sm">{t('Necesitas una cuenta.')}{' '}<Link href="/auth/registrarse?next=/vendedor/registro" className="font-semibold text-brand-700 underline">{t('Crea tu cuenta')}</Link> o <Link href="/auth/iniciar-sesion?next=/vendedor/registro" className="font-semibold text-brand-700 underline">{t('inicia sesión')}</Link>.</p>}
          {cfg.data && !cfg.data.sellerRegistration && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{t('El registro de nuevos vendedores está cerrado temporalmente.')}</p>}
          <h2 className="mt-8 flex items-center gap-2 text-lg font-bold"><Store className="size-5 text-brand-600" /> {t('Tu tienda')}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label={t('Nombre de la tienda')} required><Input rule="businessName" value={f.storeName} onChange={set('storeName')} placeholder={t('Ej. Urban Style Co.')} /></Field>
            <Field label={t('Descripción corta')}><Input value={f.shortDescription} onChange={set('shortDescription')} placeholder={t('Qué vendes en una frase')} maxLength={200} /></Field>
            <Field label={t('Correo de atención')}><Input rule="email" type="email" value={f.supportEmail} onChange={set('supportEmail')} placeholder={t('ventas@mitienda.com')} /></Field>
            <Field label={t('Teléfono de atención')}><Input rule="phone" value={f.supportPhone} onChange={set('supportPhone')} placeholder="+1 305 555 0000" /></Field>
          </div>
          <h2 className="mt-8 flex items-center gap-2 text-lg font-bold"><FileText className="size-5 text-brand-600" /> {t('Datos fiscales')}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label={t('Nombre o razón social')} required><Input rule="businessName" value={f.legalName} onChange={set('legalName')} placeholder={t('Ej. Urban Style LLC')} /></Field>
            <Field label={t('Tipo de entidad')} required>
              <Select value={f.entityType} onChange={set('entityType')}>{ENTITY_TYPES.map((e) => <option key={e} value={e}>{entityLabel(e)}</option>)}</Select>
            </Field>
            <CountrySelect label={t('País de registro')} value={f.countryCode} onChange={(v) => setF({ ...f, countryCode: v })} required />
            <Field label={taxIdHint(f.countryCode)} required hint={t('(se guarda cifrado)')}><Input rule="taxId" value={f.taxId} onChange={set('taxId')} /></Field>
          </div>
          <h2 className="mt-8 flex items-center gap-2 text-lg font-bold"><MapPin className="size-5 text-brand-600" /> {t('Dirección de despacho')}</h2>
          <p className="text-sm text-muted">{t('Desde aquí se calculan las tarifas de envío y se generan las etiquetas.')}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label={t('Persona de contacto')} required><Input rule="personName" value={f.contactName} onChange={set('contactName')} placeholder={me?.displayName ?? ''} /></Field>
            <Field label={t('Teléfono')} required hint={t('(con código de país)')}><Input rule="phone" value={f.phone} onChange={set('phone')} placeholder="+1 305 555 0000" /></Field>
            <Field label={t('Dirección')} required className="sm:col-span-2"><Input value={f.line1} onChange={set('line1')} placeholder={t('Calle y número')} /></Field>
            <Field label={t('Apartamento, suite o referencia')} className="sm:col-span-2"><Input value={f.line2} onChange={set('line2')} /></Field>
            <GeoFields value={geo} onChange={(p) => { if (p.countryCode !== undefined) setShipCountry(p.countryCode); setF((s) => ({ ...s, ...('city' in p ? { city: p.city! } : {}), ...('region' in p ? { region: p.region! } : {}), ...('postalCode' in p ? { postalCode: p.postalCode! } : {}) })); }} />
          </div>
          <label className="mt-6 flex items-start gap-2 text-sm"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" /> {t('Acepto los términos para vendedores, la comisión vigente del marketplace y las políticas de contenido.')}</label>
          <Button size="lg" className="mt-6 w-full sm:w-auto" onClick={submit} loading={busy} disabled={!f.storeName || !f.legalName || !f.taxId || !f.countryCode || !f.line1 || !f.city || !geo.countryCode || !f.phone}><Check /> {t('Enviar solicitud')}</Button>
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
