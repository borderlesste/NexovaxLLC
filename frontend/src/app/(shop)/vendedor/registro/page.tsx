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

export default function SellerOnboardingPage() {
  const { session, loading, seller, me, refresh } = useAuth();
  const router = useRouter();
  const cities = useQuery({ queryKey: ['cities'], queryFn: () => get('/geo/cities'), staleTime: Infinity });
  const cfg = useQuery({ queryKey: ['public-config'], queryFn: () => get('/config/public'), staleTime: 60_000 });
  const [f, setF] = useState({ storeName: '', shortDescription: '', supportEmail: '', supportPhone: '', legalName: '', entityType: 'PERSONA_FISICA', taxId: '', contactName: '', line1: '', line2: '', cityId: '', region: '', phone: '' });
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  if (loading) return <PageLoader />;
  if (seller)
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <div className="card p-8 text-center">
          {seller.status === 'ACTIVE' ? <BadgeCheck className="mx-auto size-14 text-emerald-500" /> : <Clock className="mx-auto size-14 text-amber-500" />}
          <h1 className="mt-4 text-2xl font-extrabold">{seller.status === 'ACTIVE' ? 'Tu tienda está activa' : 'Tu solicitud está en revisión'}</h1>
          <p className="mt-2 text-muted">{seller.status === 'ACTIVE' ? 'Gestiona productos, pedidos y finanzas desde tu panel.' : 'Nuestro equipo está verificando tu información. Mientras tanto puedes crear tus productos.'}</p>
          <Button className="mt-6" asChild><Link href="/vendedor/dashboard">Ir al panel de vendedor</Link></Button>
        </div>
      </div>
    );
  const submit = async () => {
    if (!session) return router.push('/auth/registrarse?next=/vendedor/registro');
    if (!accept) return toast.error('Debes aceptar los términos para vendedores.');
    setBusy(true);
    try {
      await post('/seller/onboarding', {
        storeName: f.storeName, shortDescription: f.shortDescription || undefined, supportEmail: f.supportEmail || undefined, supportPhone: f.supportPhone || undefined,
        legalName: f.legalName, entityType: f.entityType, taxId: f.taxId,
        address: { contactName: f.contactName || me?.displayName, line1: f.line1, line2: f.line2 || undefined, cityId: Number(f.cityId), region: f.region || undefined, phone: f.phone || undefined },
      });
      toast.success('¡Solicitud enviada! Te avisaremos cuando tu tienda sea aprobada.');
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
          <h1 className="text-3xl font-extrabold">Abre tu tienda en RD Marketplace</h1>
          <p className="mt-1 text-muted">Completa tus datos. Verificaremos tu información antes de activar la tienda.</p>
          {!session && <p className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-sm">Necesitas una cuenta. <Link href="/auth/registrarse?next=/vendedor/registro" className="font-semibold text-brand-700 underline">Crea tu cuenta</Link> o <Link href="/auth/iniciar-sesion?next=/vendedor/registro" className="font-semibold text-brand-700 underline">inicia sesión</Link>.</p>}
          {cfg.data && !cfg.data.sellerRegistration && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">El registro de nuevos vendedores está cerrado temporalmente.</p>}
          <h2 className="mt-8 flex items-center gap-2 text-lg font-bold"><Store className="size-5 text-brand-600" /> Tu tienda</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Nombre de la tienda" required><Input value={f.storeName} onChange={set('storeName')} placeholder="Ej. Tienda Deportiva RD" /></Field>
            <Field label="Descripción corta"><Input value={f.shortDescription} onChange={set('shortDescription')} placeholder="Qué vendes en una frase" maxLength={200} /></Field>
            <Field label="Correo de atención"><Input type="email" value={f.supportEmail} onChange={set('supportEmail')} placeholder="ventas@mitienda.com" /></Field>
            <Field label="Teléfono de atención"><Input value={f.supportPhone} onChange={set('supportPhone')} placeholder="+1 (809) 555-0000" /></Field>
          </div>
          <h2 className="mt-8 flex items-center gap-2 text-lg font-bold"><FileText className="size-5 text-brand-600" /> Datos fiscales</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label="Nombre o razón social" required className="sm:col-span-2"><Input value={f.legalName} onChange={set('legalName')} placeholder="Ej. Tienda Deportiva RD, SRL" /></Field>
            <Field label="Tipo" required>
              <Select value={f.entityType} onChange={set('entityType')}><option value="PERSONA_FISICA">Persona física</option><option value="SRL">S.R.L.</option><option value="SA">S.A.</option><option value="EIRL">E.I.R.L.</option><option value="OTRO">Otro</option></Select>
            </Field>
            <Field label="RNC o cédula" required hint="(se guarda cifrado)"><Input value={f.taxId} onChange={set('taxId')} placeholder="001-1234567-8" /></Field>
          </div>
          <h2 className="mt-8 flex items-center gap-2 text-lg font-bold"><MapPin className="size-5 text-brand-600" /> Dirección de despacho</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Persona de contacto" required><Input value={f.contactName} onChange={set('contactName')} placeholder={me?.displayName ?? 'Nombre'} /></Field>
            <Field label="Teléfono"><Input value={f.phone} onChange={set('phone')} placeholder="+1 (809) 555-0000" /></Field>
            <Field label="Dirección" required className="sm:col-span-2"><Input value={f.line1} onChange={set('line1')} placeholder="Calle, número, sector" /></Field>
            <Field label="Referencia"><Input value={f.line2} onChange={set('line2')} placeholder="Local, piso, referencia" /></Field>
            <Field label="Ciudad" required><Select value={f.cityId} onChange={set('cityId')}><option value="">Selecciona</option>{(cities.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          </div>
          <label className="mt-6 flex items-start gap-2 text-sm"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" /> Acepto los términos para vendedores, la comisión vigente del marketplace y las políticas de contenido.</label>
          <Button size="lg" className="mt-6 w-full sm:w-auto" onClick={submit} loading={busy} disabled={!f.storeName || !f.legalName || !f.taxId || !f.line1 || !f.cityId}><Check /> Enviar solicitud</Button>
        </div>
        <aside className="space-y-4">
          {[[Building2, 'Crea tu tienda', 'Publica tu catálogo con variantes, fotos e inventario.'], [Users, 'Llega a más clientes', 'Vende en todo el país con envíos y pagos integrados.'], [TrendingUp, 'Haz crecer tus ventas', 'Panel de ventas, inventario y finanzas en tiempo real.']].map(([I, t, d]: any) => (
            <div key={t} className="card flex gap-3 p-5"><I className="size-8 shrink-0 text-brand-600" /><div><p className="font-bold">{t}</p><p className="text-sm text-muted">{d}</p></div></div>
          ))}
        </aside>
      </div>
    </div>
  );
}
