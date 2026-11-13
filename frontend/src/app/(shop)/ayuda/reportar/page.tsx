'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, BookOpen, Check, CheckCircle2, ClipboardList, Clock, CreditCard, ExternalLink, Headphones, Layers, Link2, Mail, Monitor, MoreHorizontal, Package, Pencil, Search, Send, Smartphone, Store, User, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';

const DRAFT_KEY = 'rd-report-draft';

function ReportForm() {
  const sp = useSearchParams();
  const { me, session } = useAuth();
  const catalogs = useQuery({ queryKey: ['support-catalogs'], queryFn: () => get('/support/catalogs'), staleTime: Infinity });
  const health = useQuery({ queryKey: ['health'], queryFn: () => get('/health'), refetchInterval: 60_000 });
  const [f, setF] = useState({ categoryCode: sp.get('tipo') ?? '', priority: 'NORMAL', subject: '', description: '', url: '', orderNumber: sp.get('pedido') ?? '', storeName: '', platform: 'WEB' });
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [trackCode, setTrackCode] = useState('');
  const [track, setTrack] = useState<any>(null);
  useEffect(() => {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      if (d) setF((x) => ({ ...x, ...JSON.parse(d) }));
    } catch {}
  }, []);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    if (!session) return toast.info('Inicia sesión para enviar el reporte.');
    if (!f.categoryCode || f.subject.trim().length < 4 || f.description.trim().length < 10) return toast.error('Completa tipo, asunto y descripción (mínimo 10 caracteres).');
    if (!accept) return toast.error('Debes aceptar la política de privacidad.');
    setBusy(true);
    try {
      const r = await post('/support/reports', { ...f, url: f.url || undefined, orderNumber: f.orderNumber || undefined, storeName: f.storeName || undefined });
      setDone(r.code);
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const lookup = async () => {
    try {
      setTrack(await get(`/support/track/${encodeURIComponent(trackCode.trim())}`));
    } catch (e) {
      setTrack(null);
      toast.error(errorMessage(e));
    }
  };
  const services = [[Monitor, 'Sitio web'], [CreditCard, 'Pagos'], [MessageSquare, 'Mensajería'], [Layers, 'Catálogo']];
  const up = health.data?.status === 'ok';

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-8">
      <Breadcrumbs items={[{ label: 'Ayuda', href: '/ayuda' }, { label: 'Reportar problema' }]} />
      <div className="mt-3 flex items-start gap-4">
        <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600"><AlertCircle className="size-9" /></div>
        <div><h1 className="text-3xl font-extrabold sm:text-4xl">Reportar un problema</h1><p className="mt-1 max-w-3xl text-muted">Cualquier persona puede notificarnos incidentes, fallas técnicas, comportamientos abusivos, problemas de pago o errores en el marketplace.</p></div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_520px]">
        <section className="card p-6">
          {done ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto size-16 text-emerald-500" />
              <h2 className="mt-4 text-2xl font-extrabold">¡Reporte enviado!</h2>
              <p className="mt-2 text-muted">Tu código de seguimiento es</p>
              <p className="mt-1 text-2xl font-extrabold text-brand-700">{done}</p>
              <p className="mt-3 text-sm text-muted">Te responderemos en un plazo estimado de 24–48 horas.</p>
              <div className="mt-6 flex justify-center gap-3">
                <Button asChild><Link href="/cuenta/reportes">Ver mis reportes</Link></Button>
                <Button variant="outline" onClick={() => { setDone(null); setF({ ...f, subject: '', description: '' }); }}>Enviar otro</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3"><ClipboardList className="size-8 text-brand-600" /><div><h2 className="text-xl font-bold">Completa el formulario</h2><p className="text-sm text-muted">Bríndanos la mayor cantidad de detalles posible para poder ayudarte de forma más rápida y efectiva.</p></div></div>
              {!session && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Para enviar un reporte necesitas una cuenta. <Link href="/auth/iniciar-sesion?next=/ayuda/reportar" className="font-semibold underline">Inicia sesión</Link> o <Link href="/auth/registrarse" className="font-semibold underline">regístrate</Link>.</p>}
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Nombre completo" required><Input icon={<User />} value={me?.displayName ?? ''} disabled placeholder="Ej. Juan Pérez" /></Field>
                <Field label="Correo electrónico" required><Input icon={<Mail />} value={me?.email ?? ''} disabled placeholder="Ej. juan.perez@email.com" /></Field>
                <Field label="Tipo de problema" required>
                  <Select value={f.categoryCode} onChange={(e) => set('categoryCode', e.target.value)}>
                    <option value="">Selecciona un tipo de problema</option>
                    {catalogs.data?.categories.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Prioridad" required>
                  <div className="grid grid-cols-3 gap-2">
                    {[['NORMAL', 'Normal'], ['HIGH', 'Alta'], ['CRITICAL', 'Crítica']].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => set('priority', v)} className={cn('flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-semibold', f.priority === v ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line')}>
                        <span className={cn('size-3.5 rounded-full border-2', f.priority === v ? 'border-brand-600 bg-brand-600 ring-2 ring-inset ring-white' : 'border-gray-300')} /> {l}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Asunto" required className="sm:col-span-2"><Input icon={<Pencil />} value={f.subject} onChange={(e) => set('subject', e.target.value)} placeholder="Ej. No puedo completar mi compra" maxLength={140} /></Field>
                <Field label="Descripción del problema" required className="sm:col-span-2">
                  <Textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} placeholder="Describe el problema con el mayor detalle posible. Incluye qué pasó, qué estabas haciendo, desde cuándo ocurre y cualquier información relevante." />
                  <p className="mt-1 text-right text-xs text-muted">{f.description.length} / 1,000</p>
                </Field>
                <Field label="URL o página afectada"><Input icon={<Link2 />} value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="Ej. https://rdmarketplace.do/producto/123" /></Field>
                <Field label="Número de pedido" hint="(opcional)"><Input icon={<Package />} value={f.orderNumber} onChange={(e) => set('orderNumber', e.target.value)} placeholder="Ej. RD-789456" /></Field>
                <Field label="Nombre de la tienda o vendedor" hint="(opcional)"><Input icon={<Store />} value={f.storeName} onChange={(e) => set('storeName', e.target.value)} placeholder="Ej. Tienda Deportiva RD" /></Field>
                <Field label="Plataforma desde donde ocurre el problema" required>
                  <div className="grid grid-cols-3 gap-2">
                    {[['WEB', 'Plataforma web', Monitor], ['MOBILE', 'App móvil', Smartphone], ['OTHER', 'Otro', MoreHorizontal]].map(([v, l, I]: any) => (
                      <button key={v} type="button" onClick={() => set('platform', v)} className={cn('flex h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-semibold', f.platform === v ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line')}><I className="size-4" /> {l}</button>
                    ))}
                  </div>
                </Field>
              </div>
              <label className="mt-5 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
                <span>Acepto la <Link href="/ayuda#privacidad" className="text-brand-700 underline">Política de privacidad</Link> y autorizo a RD Marketplace a contactarme por correo electrónico para dar seguimiento a este reporte. <span className="text-red-500">*</span></span>
              </label>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Button size="lg" onClick={submit} loading={busy} disabled={!session}><Send /> Enviar reporte</Button>
                <Button size="lg" variant="outline" onClick={() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); toast.success('Borrador guardado en este dispositivo.'); } catch { toast.error('No se pudo guardar el borrador.'); } }}>Guardar borrador</Button>
              </div>
            </>
          )}
        </section>
        <aside className="space-y-4">
          <div className="card p-5">
            <div className="flex items-start gap-3"><Activity className="size-7 text-brand-600" /><div><p className="text-lg font-bold">Estado de la plataforma</p><p className="text-sm text-muted">Revisa el estado actual de los principales servicios del marketplace.</p></div></div>
            <ul className="mt-3 divide-y divide-line">
              {services.map(([I, n]: any) => (
                <li key={n} className="flex items-center justify-between py-2.5 text-sm"><span className="flex items-center gap-3 font-semibold"><I className="size-5 text-muted" /> {n}</span><span className={cn('flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', up ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}><Check className="size-3" /> {up ? 'Operativo' : 'Verificando'}</span></li>
              ))}
            </ul>
          </div>
          <div className="card p-5">
            <p className="text-lg font-bold">¿Qué puedes reportar?</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {(catalogs.data?.categories ?? []).slice(0, 6).map((c: any) => <li key={c.code} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-600" /><span><b>{c.name}:</b> {c.description}</span></li>)}
            </ul>
          </div>
          <div className="card p-5">
            <div className="flex items-start gap-3"><Search className="size-7 text-brand-600" /><div><p className="text-lg font-bold">Seguimiento de reportes</p><p className="text-sm text-muted">¿Ya enviaste un reporte? Consulta su estado ingresando tu código.</p></div></div>
            <div className="mt-3 flex gap-2"><Input value={trackCode} onChange={(e) => setTrackCode(e.target.value)} placeholder="Ej. RD-REP-123456" /><Button onClick={lookup} disabled={!trackCode.trim()}>Consultar estado</Button></div>
            {track && <div className="mt-3 flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-sm"><span><b>{track.code}</b> · {track.category}</span><StatusBadge status={track.status} label={track.statusLabel} /></div>}
          </div>
          <div className="rounded-[14px] bg-brand-50 p-5">
            <div className="flex items-start gap-3"><Headphones className="size-7 text-brand-600" /><div><p className="text-lg font-bold">¿Necesitas más ayuda?</p><p className="text-sm text-muted">También puedes consultar nuestra documentación o conocer los tiempos de atención.</p></div></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Link href="/ayuda" className="flex items-center gap-2 rounded-xl bg-white p-3 text-sm"><BookOpen className="size-6 text-brand-600" /><span><b className="block">Centro de ayuda</b><span className="text-xs text-muted">Guías, políticas y más.</span></span></Link>
              <div className="flex items-center gap-2 rounded-xl bg-white p-3 text-sm"><Clock className="size-6 text-brand-600" /><span><b className="block">Tiempo de respuesta</b><span className="font-bold text-brand-700">24 – 48 horas</span></span></div>
            </div>
            <Button variant="outline" className="mt-3 w-full bg-white" asChild><Link href="/ayuda#faq"><ExternalLink /> Ver preguntas frecuentes</Link></Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function ReportPage() {
  return <Suspense><ReportForm /></Suspense>;
}
