'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, fetchBlobUrl } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface Attachment {
  id: string;
  kind?: string;
  name: string;
  size?: number;
  mime?: string;
  width?: number | null;
  height?: number | null;
}

export const MAX_FILES = 4;
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

const kb = (n?: number) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Private image loaded with the session token (shown as a blob URL). */
function PrivateImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoke: string | null = null;
    let alive = true;
    fetchBlobUrl(src)
      .then((u) => {
        revoke = u;
        if (alive) setUrl(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src]);
  if (failed) return <div className={cn('grid place-items-center bg-surface text-muted', className)}><ImageIcon className="size-5" /></div>;
  if (!url) return <div className={cn('grid place-items-center bg-surface', className)}><Loader2 className="size-4 animate-spin text-muted" /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={cn('object-cover', className)} />;
}

/** Thumbnails (images open full size) and document chips (download). `base` + `/${id}` is the file URL. */
export function AttachmentList({ base, items, className }: { base: string; items?: Attachment[]; className?: string }) {
  const [zoom, setZoom] = useState<Attachment | null>(null);
  if (!items?.length) return null;
  const open = async (a: Attachment) => {
    try {
      const u = await fetchBlobUrl(`${base}/${a.id}`);
      const link = document.createElement('a');
      link.href = u;
      link.download = a.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(u), 30_000);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const isImage = (a: Attachment) => a.kind === 'IMAGE' || a.mime?.startsWith('image/') || (!a.kind && !a.mime);
  return (
    <>
      <div className={cn('mt-2 flex flex-wrap gap-2', className)} data-attachments>
        {items.map((a) =>
          isImage(a) ? (
            <button key={a.id} type="button" onClick={() => setZoom(a)} className="overflow-hidden rounded-lg ring-1 ring-line hover:ring-brand-400" title={a.name} data-attachment="image">
              <PrivateImage src={`${base}/${a.id}`} alt={a.name} className="size-24" />
            </button>
          ) : (
            <button key={a.id} type="button" onClick={() => open(a)} className="flex max-w-[240px] items-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-xs ring-1 ring-line hover:ring-brand-400" data-attachment="document">
              <FileText className="size-5 shrink-0 text-red-500" />
              <span className="min-w-0"><span className="block truncate font-semibold">{a.name}</span><span className="text-muted">PDF {kb(a.size)}</span></span>
            </button>
          ),
        )}
      </div>
      {zoom && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-4" onClick={() => setZoom(null)} role="dialog" aria-label={zoom.name}>
          <button className="absolute right-4 top-4 rounded-full bg-white/90 p-2" aria-label={t('Cerrar')} onClick={() => setZoom(null)}><X className="size-5" /></button>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl bg-white">
            <PrivateImage src={`${base}/${zoom.id}`} alt={zoom.name} className="max-h-[90vh] max-w-[90vw] object-contain" />
          </div>
        </div>
      )}
    </>
  );
}

/** Paperclip button + previews of the files to send (photos and PDF, up to 4 × 10 MB). */
export function FilePicker({ files, onChange, max = MAX_FILES, imagesOnly, className, label }: { files: File[]; onChange: (f: File[]) => void; max?: number; imagesOnly?: boolean; className?: string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : ''));
    setPreviews(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);
  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const okType = IMAGE_TYPES.includes(f.type) || (!imagesOnly && f.type === 'application/pdf');
      if (!okType) {
        toast.error(imagesOnly ? t('Solo se permiten fotos (JPG, PNG o WebP).') : t('Formato no permitido. Adjunta fotos (JPG, PNG, WebP) o documentos PDF.'));
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(t('«{n}» supera 10 MB.', { n: f.name }));
        continue;
      }
      if (next.length >= max) {
        toast.error(t('Puedes adjuntar hasta {n} archivos.', { n: max }));
        break;
      }
      next.push(f);
    }
    onChange(next);
    if (ref.current) ref.current.value = '';
  };
  return (
    <div className={className}>
      <input ref={ref} type="file" multiple hidden accept={imagesOnly ? IMAGE_TYPES.join(',') : [...IMAGE_TYPES, 'application/pdf'].join(',')} onChange={(e) => add(e.target.files)} data-file-input />
      {label ? (
        <button type="button" onClick={() => ref.current?.click()} disabled={files.length >= max} className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm font-semibold text-brand-700 hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50">
          <Paperclip className="size-4" /> {label} <span className="font-normal text-muted">({files.length}/{max})</span>
        </button>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} disabled={files.length >= max} className="rounded-lg p-2.5 text-muted hover:bg-surface hover:text-ink disabled:opacity-40" aria-label={t('Adjuntar archivo')} title={t('Adjuntar foto o PDF')}>
          <Paperclip className="size-5" />
        </button>
      )}
      {files.length > 0 && (
        <div className={cn('flex flex-wrap gap-2', label ? 'mt-2' : '')} data-file-previews>
          {files.map((f, i) => (
            <div key={i} className="relative">
              {previews[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[i]} alt={f.name} className="size-16 rounded-lg object-cover ring-1 ring-line" />
              ) : (
                <div className="flex h-16 w-32 items-center gap-1.5 rounded-lg bg-surface px-2 text-[11px] ring-1 ring-line"><FileText className="size-4 shrink-0 text-red-500" /><span className="line-clamp-2 break-all">{f.name}</span></div>
              )}
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-white" aria-label={t('Quitar {n}', { n: f.name })}><X className="size-3" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** FormData with text fields and files under "files". */
export function formWith(fields: Record<string, string | undefined | null>, files: File[]) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null && v !== '') fd.append(k, v);
  for (const f of files) fd.append('files', f, f.name);
  return fd;
}
