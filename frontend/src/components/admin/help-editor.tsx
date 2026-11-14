'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BookOpen, Coins, Plus, Share2, Store, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, put } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { SOCIAL_ICONS, SOCIAL_NAMES } from '@/components/layout/social-icons';

type Faq = { q: string; a: string; qEn?: string; aEn?: string };
type Section = { title: string; body: string; titleEn?: string; bodyEn?: string };
type Commissions = { body: string; bodyEn?: string; showRate: boolean; showPayoutMinimum: boolean };
type Social = { network: string; url: string };

const move = <T,>(list: T[], i: number, d: number) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

function RowTools({ i, n, onMove, onRemove }: { i: number; n: number; onMove: (d: number) => void; onRemove: () => void }) {
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => onMove(-1)} aria-label={t('Subir')}><ArrowUp /></Button>
      <Button variant="ghost" size="icon" disabled={i === n - 1} onClick={() => onMove(1)} aria-label={t('Bajar')}><ArrowDown /></Button>
      <Button variant="ghost" size="icon" className="text-red-600" onClick={onRemove} aria-label={t('Eliminar')}><Trash2 /></Button>
    </div>
  );
}

/** Admin: help center (FAQ, seller guide, commissions text) and footer social links. */
export function HelpEditor({ settings }: { settings: Record<string, any> }) {
  const qc = useQueryClient();
  const [faq, setFaq] = useState<Faq[]>(settings['help.faq'] ?? []);
  const [sections, setSections] = useState<Section[]>(settings['help.sellers']?.sections ?? []);
  const [com, setCom] = useState<Commissions>(settings['help.commissions'] ?? { body: '', showRate: true, showPayoutMinimum: true });
  const [social, setSocial] = useState<Social[]>(settings['social.links'] ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setFaq(settings['help.faq'] ?? []);
    setSections(settings['help.sellers']?.sections ?? []);
    setCom(settings['help.commissions'] ?? { body: '', showRate: true, showPayoutMinimum: true });
    setSocial(settings['social.links'] ?? []);
  }, [settings]);
  const save = async (key: string, patch: Record<string, unknown>) => {
    setBusy(key);
    try {
      await put('/admin/settings', { settings: patch });
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      qc.invalidateQueries({ queryKey: ['public-config'] });
      toast.success(t('Cambios guardados. Ya se ven en el sitio.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const used = new Set(social.map((s) => s.network));
  return (
    <>
      <Card data-help-faq>
        <CardHeader icon={<BookOpen />} title={t('Preguntas frecuentes')} subtitle={t('Se muestran en /ayuda#faq. El inglés es opcional: si lo dejas vacío se usa la traducción automática.')} />
        <div className="space-y-3 p-5">
          {faq.map((f, i) => (
            <div key={i} className="rounded-xl border border-line p-4" data-faq-row>
              <div className="flex items-start gap-2">
                <div className="grid flex-1 gap-3 lg:grid-cols-2">
                  <Field label={`${t('Pregunta')} ${i + 1}`} required><Input value={f.q} maxLength={200} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} /></Field>
                  <Field label={t('Pregunta (inglés)')}><Input value={f.qEn ?? ''} maxLength={200} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, qEn: e.target.value } : x)))} /></Field>
                  <Field label={t('Respuesta')} required><Textarea rows={3} value={f.a} maxLength={2000} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} /></Field>
                  <Field label={t('Respuesta (inglés)')}><Textarea rows={3} value={f.aEn ?? ''} maxLength={2000} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, aEn: e.target.value } : x)))} /></Field>
                </div>
                <RowTools i={i} n={faq.length} onMove={(d) => setFaq(move(faq, i, d))} onRemove={() => setFaq(faq.filter((_, j) => j !== i))} />
              </div>
            </div>
          ))}
          <div className="flex justify-between gap-2">
            <Button variant="outline" size="sm" disabled={faq.length >= 40} onClick={() => setFaq([...faq, { q: '', a: '' }])} data-faq-add><Plus /> {t('Agregar pregunta')}</Button>
            <Button loading={busy === 'faq'} onClick={() => save('faq', { 'help.faq': faq })} data-faq-save>{t('Guardar preguntas')}</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Store />} title={t('Ayuda para vendedores')} subtitle={t('Se muestra en /ayuda#vendedores.')} />
        <div className="space-y-3 p-5">
          {sections.map((x, i) => (
            <div key={i} className="rounded-xl border border-line p-4">
              <div className="flex items-start gap-2">
                <div className="grid flex-1 gap-3 lg:grid-cols-2">
                  <Field label={`${t('Título')} ${i + 1}`} required><Input value={x.title} maxLength={120} onChange={(e) => setSections(sections.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)))} /></Field>
                  <Field label={t('Título (inglés)')}><Input value={x.titleEn ?? ''} maxLength={120} onChange={(e) => setSections(sections.map((s, j) => (j === i ? { ...s, titleEn: e.target.value } : s)))} /></Field>
                  <Field label={t('Texto')} required><Textarea rows={3} value={x.body} maxLength={3000} onChange={(e) => setSections(sections.map((s, j) => (j === i ? { ...s, body: e.target.value } : s)))} /></Field>
                  <Field label={t('Texto (inglés)')}><Textarea rows={3} value={x.bodyEn ?? ''} maxLength={3000} onChange={(e) => setSections(sections.map((s, j) => (j === i ? { ...s, bodyEn: e.target.value } : s)))} /></Field>
                </div>
                <RowTools i={i} n={sections.length} onMove={(d) => setSections(move(sections, i, d))} onRemove={() => setSections(sections.filter((_, j) => j !== i))} />
              </div>
            </div>
          ))}
          <div className="flex justify-between gap-2">
            <Button variant="outline" size="sm" disabled={sections.length >= 12} onClick={() => setSections([...sections, { title: '', body: '' }])}><Plus /> {t('Agregar sección')}</Button>
            <Button loading={busy === 'sellers'} onClick={() => save('sellers', { 'help.sellers': { sections } })}>{t('Guardar ayuda para vendedores')}</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Coins />} title={t('Comisiones y pagos a vendedores')} subtitle={t('Se muestra en /ayuda#comisiones. La comisión y el retiro mínimo salen de la configuración vigente.')} />
        <div className="space-y-4 p-5">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label={t('Texto')} required><Textarea rows={4} value={com.body} maxLength={3000} onChange={(e) => setCom({ ...com, body: e.target.value })} data-commissions-body /></Field>
            <Field label={t('Texto (inglés)')}><Textarea rows={4} value={com.bodyEn ?? ''} maxLength={3000} onChange={(e) => setCom({ ...com, bodyEn: e.target.value })} /></Field>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><Switch checked={com.showRate} onCheckedChange={(v) => setCom({ ...com, showRate: v })} /> {t('Mostrar la comisión vigente')}</label>
            <label className="flex items-center gap-2"><Switch checked={com.showPayoutMinimum} onCheckedChange={(v) => setCom({ ...com, showPayoutMinimum: v })} /> {t('Mostrar el retiro mínimo')}</label>
          </div>
          <div className="flex justify-end"><Button loading={busy === 'com'} onClick={() => save('com', { 'help.commissions': com })} data-commissions-save>{t('Guardar comisiones')}</Button></div>
        </div>
      </Card>

      <Card data-social-editor>
        <CardHeader icon={<Share2 />} title={t('Redes sociales')} subtitle={t('Íconos de «Síguenos» en el pie de página. Si no agregas ninguna, la sección no se muestra.')} />
        <div className="space-y-3 p-5">
          {social.map((l, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-3" data-social-row>
              <span className="grid size-10 place-items-center rounded-lg bg-surface text-brand-700">{SOCIAL_ICONS[l.network]}</span>
              <Field label={t('Red')} className="w-44">
                <Select value={l.network} onChange={(e) => setSocial(social.map((x, j) => (j === i ? { ...x, network: e.target.value } : x)))} data-social-network>
                  {Object.keys(SOCIAL_NAMES).filter((n) => n === l.network || !used.has(n)).map((n) => <option key={n} value={n}>{SOCIAL_NAMES[n]}</option>)}
                </Select>
              </Field>
              <Field label={t('Enlace del perfil')} className="min-w-[240px] flex-1"><Input value={l.url} placeholder="https://" onChange={(e) => setSocial(social.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} data-social-url /></Field>
              <RowTools i={i} n={social.length} onMove={(d) => setSocial(move(social, i, d))} onRemove={() => setSocial(social.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="flex justify-between gap-2">
            <Button variant="outline" size="sm" disabled={social.length >= Object.keys(SOCIAL_NAMES).length}
              onClick={() => setSocial([...social, { network: Object.keys(SOCIAL_NAMES).find((n) => !used.has(n))!, url: '' }])} data-social-add><Plus /> {t('Agregar red social')}</Button>
            <Button loading={busy === 'social'} onClick={() => save('social', { 'social.links': social })} data-social-save>{t('Guardar redes sociales')}</Button>
          </div>
        </div>
      </Card>
    </>
  );
}
