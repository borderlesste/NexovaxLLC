'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, History, Send } from 'lucide-react';
import { toast } from 'sonner';
import { del, errorMessage, get, post } from '@/lib/api';
import { cn, fmtDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/layout/dashboard-shell';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Dialog, PageLoader } from '@/components/ui/misc';
import { t } from '@/lib/i18n';

type Loc = 'es' | 'en' | 'fr' | 'ht';
type Texts = Record<Loc, { title: string; text: string }>;
const LANGS: [Loc, string][] = [['es', 'Español'], ['en', 'English'], ['fr', 'Français'], ['ht', 'Kreyòl ayisyen']];
const empty = (): Texts => ({ es: { title: '', text: '' }, en: { title: '', text: '' }, fr: { title: '', text: '' }, ht: { title: '', text: '' } });
const AUDIENCE: Record<string, string> = { BOTH: 'Todas las cuentas', SELLER: 'Tiendas', CUSTOMER: 'Clientes', PUBLIC: 'Público' };

/** Admin: edit the legal texts. Each save publishes a new, audited version that becomes current at once. */
export default function PoliciesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-policies'], queryFn: () => get<any[]>('/admin/policies') });
  const [code, setCode] = useState<string>('TERMS_OF_SERVICE');
  const [lang, setLang] = useState<Loc>('es');
  const [texts, setTexts] = useState<Texts>(empty());
  const [reaccept, setReaccept] = useState(false);
  const [when, setWhen] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const pol = q.data?.find((p) => p.code === code);
  const load = (p: any) => {
    const t0 = empty();
    for (const [l] of LANGS) if (p?.localizations?.[l]) t0[l] = { title: p.localizations[l].title ?? '', text: p.localizations[l].text ?? '' };
    setTexts(t0);
    setReaccept(false);
  };
  useEffect(() => { if (pol) load(pol); }, [pol?.versions?.[0]?.id, code]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = useMemo(() => !!pol && LANGS.some(([l]) => (pol.localizations?.[l]?.title ?? '') !== texts[l].title.trim() || (pol.localizations?.[l]?.text ?? '') !== texts[l].text.trim()), [pol, texts]);
  const current = pol?.versions?.find((v: any) => v.current);
  const set = (k: 'title' | 'text', v: string) => setTexts((x) => ({ ...x, [lang]: { ...x[lang], [k]: v } }));
  const filled = (l: Loc) => !!(texts[l].title.trim() && texts[l].text.trim());
  const publish = async () => {
    setBusy(true);
    try {
      const localizations: any = {};
      for (const [l] of LANGS) if (filled(l)) localizations[l] = { title: texts[l].title.trim(), text: texts[l].text.trim() };
      const r = await post<any>(`/admin/policies/${code}/versions`, { localizations, requiresReacceptance: reaccept, ...(when ? { effectiveAt: new Date(when).toISOString() } : {}) });
      toast.success(r.scheduledAt ? t('Versión {n} programada para el {d}.', { n: r.version, d: fmtDateTime(r.scheduledAt) }) : t('Versión {n} publicada.', { n: r.version }));
      setWhen('');
      setConfirm(false);
      await qc.invalidateQueries({ queryKey: ['admin-policies'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancelScheduled = async (id: string) => {
    if (!window.confirm(t('¿Cancelar la versión programada? No entrará en vigor.'))) return;
    try { await del(`/admin/policies/${code}/versions/${id}`); toast.success(t('Programación cancelada.')); await qc.invalidateQueries({ queryKey: ['admin-policies'] }); } catch (e) { toast.error(errorMessage(e)); }
  };
  if (q.isLoading) return <PageLoader />;
  return (
    <>
      <PageHeader crumbs={[{ label: t('Ajustes') }, { label: t('Políticas legales') }]} title={t('Políticas legales')}
        description={t('Edita los términos, la privacidad y los términos para vendedores. Cada cambio se publica como una versión nueva y queda registrado quién la publicó y quiénes la aceptaron.')} />
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1">
        {q.data?.map((p) => (
          <button key={p.code} onClick={() => { setCode(p.code); setLang('es'); }} data-policy-tab={p.code}
            className={cn('flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold', code === p.code ? 'bg-brand-50 text-brand-700 shadow-sm' : 'text-muted hover:text-ink')}>
            <FileText className="size-4" /> {t(p.name)}
          </button>
        ))}
      </div>
      {pol && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader icon={<FileText />} title={t(pol.name)}
              subtitle={`${t('Versión vigente')}: ${current ? `${current.version} · ${fmtDateTime(current.effectiveAt)}` : '—'} · ${t(AUDIENCE[pol.audience] ?? pol.audience)}`} />
            <div className="p-5">
              <div className="mb-4 flex flex-wrap gap-2">
                {LANGS.map(([l, name]) => (
                  <button key={l} onClick={() => setLang(l)} data-lang-tab={l}
                    className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold', lang === l ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line')}>
                    {name}{l === 'es' && <span className="text-red-500">*</span>}
                    <span className={cn('size-2 rounded-full', filled(l) ? 'bg-emerald-500' : 'bg-gray-300')} title={filled(l) ? t('Con texto') : t('Sin texto: se muestra en español')} />
                  </button>
                ))}
              </div>
              <div className="space-y-4">
                <Field label={t('Título')} required={lang === 'es'}><Input value={texts[lang].title} maxLength={120} onChange={(e) => set('title', e.target.value)} data-policy-title /></Field>
                <Field label={t('Texto')} required={lang === 'es'} hint={`${texts[lang].text.length.toLocaleString()} / 20,000`}>
                  <Textarea rows={14} value={texts[lang].text} maxLength={20000} onChange={(e) => set('text', e.target.value)} data-policy-text />
                </Field>
                {lang !== 'es' && !filled(lang) && <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t('Si lo dejas vacío, quienes usan este idioma verán el texto en español.')}</p>}
              </div>
              <label className="mt-5 flex items-start gap-2 rounded-xl border border-line p-4 text-sm">
                <input type="checkbox" checked={reaccept} onChange={(e) => setReaccept(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" data-policy-reaccept />
                <span><b className="block">{t('Pedir que todos la acepten de nuevo')}</b>
                  <span className="text-muted">{pol.code === 'SELLER_TERMS'
                    ? t('Cada tienda verá un aviso para aceptar la nueva versión la próxima vez que entre. Úsalo para cambios importantes (comisión, obligaciones).')
                    : t('Cada cuenta verá un aviso para aceptar la nueva versión la próxima vez que entre. Úsalo para cambios importantes; para correcciones menores déjalo sin marcar.')}</span></span>
              </label>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
                <span className="text-sm font-semibold">{t('Entra en vigor')}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="datetime-local" value={when} min={new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16)} onChange={(e) => setWhen(e.target.value)} className="w-56" data-policy-when />
                  <span className="text-xs text-muted">{when ? t('Se publicará sola en esa fecha; hasta entonces sigue la versión vigente.') : t('Vacío: se publica de inmediato.')}</span>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" disabled={!changed} onClick={() => load(pol)}>{t('Descartar cambios')}</Button>
                <Button disabled={!changed || !filled('es')} onClick={() => setConfirm(true)} data-policy-publish><Send /> {when ? t('Programar nueva versión') : t('Publicar nueva versión')}</Button>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader icon={<History />} title={t('Historial de versiones')} subtitle={t('Las versiones publicadas no se pueden modificar: cada una queda como prueba de lo que se aceptó.')} />
            <ul className="divide-y divide-line" data-policy-versions>
              {pol.versions.map((v: any) => (
                <li key={v.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    <b>{t('Versión {n}', { n: v.version })}</b>{v.current && <Badge tone="green" className="ml-2">{t('Vigente')}</Badge>}
                    {v.status === 'SCHEDULED' && <Badge tone="blue" className="ml-2" data-policy-scheduled>{t('Programada: {d}', { d: fmtDateTime(v.scheduledAt) })}</Badge>}
                    {v.status === 'WITHDRAWN' && <Badge tone="gray" className="ml-2">{t('Cancelada')}</Badge>}
                    {v.requiresReacceptance && <Badge tone="amber" className="ml-2">{t('Pide aceptar de nuevo')}</Badge>}
                    <span className="block text-xs text-muted">{fmtDateTime(v.publishedAt)}{v.publishedBy ? ` · ${v.publishedBy}` : ''}</span>
                  </span>
                  {v.status === 'SCHEDULED'
                    ? <Button size="sm" variant="ghost" onClick={() => cancelScheduled(v.id)} data-policy-cancel>{t('Cancelar programación')}</Button>
                    : <span className="text-right text-xs text-muted"><b className="block text-base text-ink">{v.acceptances}</b>{t('aceptaciones')}</span>}
                </li>
              ))}
            </ul>
            <div className="border-t border-line p-4">
              <Button variant="outline" size="sm" asChild><Link href={`/ayuda#${pol.slug}`} target="_blank"><ExternalLink /> {t('Ver en el centro de ayuda')}</Link></Button>
            </div>
          </Card>
        </div>
      )}
      {confirm && pol && (
        <Dialog open onOpenChange={(o) => !o && setConfirm(false)} title={t('¿Publicar la versión {n}?', { n: (pol.versions[0]?.version ?? 0) + 1 })}
          description={t(pol.name)}
          footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>{t('Cancelar')}</Button><Button loading={busy} onClick={publish} data-policy-confirm><Send /> {t('Publicar')}</Button></>}>
          <ul className="space-y-2 text-sm text-muted">
            <li>{when ? t('Queda programada: el {d} reemplaza a la versión vigente y se muestra en el centro de ayuda.', { d: fmtDateTime(new Date(when).toISOString()) }) : t('Reemplaza la versión vigente de inmediato y se muestra en el centro de ayuda.')}</li>
            <li>{t('Idiomas incluidos: {a}.', { a: LANGS.filter(([l]) => filled(l)).map(([, n]) => n).join(', ') })}</li>
            <li className={reaccept ? 'font-semibold text-amber-700' : ''}>{reaccept
              ? t('Todas las cuentas que aceptaron la versión anterior deberán aceptarla de nuevo.')
              : t('Quienes ya aceptaron una versión anterior no tendrán que aceptar de nuevo; las cuentas nuevas aceptan esta.')}</li>
          </ul>
        </Dialog>
      )}
    </>
  );
}
