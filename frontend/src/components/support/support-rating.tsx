'use client';
import { useState } from 'react';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, post } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';

/** «2 h 15 min», «3 d 4 h»; dash when there is no value. */
export function fmtMinutes(m: number | null | undefined) {
  if (m == null) return '—';
  const v = Math.round(m);
  if (v < 60) return t('{n} min', { n: v });
  const h = Math.floor(v / 60);
  if (h < 24) return v % 60 ? t('{h} h {m} min', { h, m: v % 60 }) : t('{h} h', { h });
  const d = Math.floor(h / 24);
  return h % 24 ? t('{d} d {h} h', { d, h: h % 24 }) : t('{d} d', { d });
}

export function Stars({ value, onChange, size = 'sm' }: { value: number; onChange?: (v: number) => void; size?: 'sm' | 'lg' }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className="inline-flex items-center gap-0.5" onMouseLeave={() => setHover(0)} role={onChange ? 'radiogroup' : undefined} aria-label={t('{n} de 5 estrellas', { n: value })}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = <Star className={cn(size === 'lg' ? 'size-8' : 'size-4', n <= shown ? 'fill-amber-400 text-amber-400' : 'text-line')} />;
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={t('{n} de 5 estrellas', { n })} onMouseEnter={() => setHover(n)} onClick={() => onChange(n)} className="rounded p-0.5" data-star={n}>{icon}</button>
        ) : <span key={n}>{icon}</span>;
      })}
    </span>
  );
}

const LABELS = ['', 'Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'];

/** Customer side: rate the help on a resolved report (or see the rating already given). */
export function RateSupport({ ticketId, rating, canRate, onDone }: { ticketId: string; rating: { score: number; comment?: string | null } | null; canRate: boolean; onDone: (d: any) => void }) {
  const [score, setScore] = useState(rating?.score ?? 0);
  const [comment, setComment] = useState(rating?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!rating);
  if (!canRate && !rating) return null;
  const submit = async () => {
    setBusy(true);
    try {
      onDone(await post(`/support/reports/${ticketId}/rating`, { score, comment: comment.trim() || undefined }));
      toast.success(t('¡Gracias por tu calificación!'));
      setEditing(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (rating && !editing)
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm" data-support-rated>
        <p className="flex flex-wrap items-center gap-2 font-bold">{t('Tu calificación')} <Stars value={rating.score} /> <span className="font-normal text-muted">{t(LABELS[rating.score])}</span></p>
        {rating.comment && <p className="mt-1 whitespace-pre-line text-muted">{rating.comment}</p>}
        {canRate && <button type="button" className="mt-2 text-xs font-semibold text-brand-700 underline" onClick={() => setEditing(true)}>{t('Cambiar calificación')}</button>}
      </div>
    );
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm" data-support-rate>
      <p className="font-bold">{t('¿Cómo te atendimos?')}</p>
      <p className="text-muted">{t('Tu opinión nos ayuda a mejorar el soporte.')}</p>
      <div className="mt-2 flex items-center gap-3"><Stars value={score} onChange={setScore} size="lg" />{score > 0 && <span className="font-semibold">{t(LABELS[score])}</span>}</div>
      <Textarea rows={2} className="mt-3" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('Comentario (opcional)')} />
      <Button className="mt-3" onClick={submit} loading={busy} disabled={!score} data-rate-submit>{t('Enviar calificación')}</Button>
    </div>
  );
}
