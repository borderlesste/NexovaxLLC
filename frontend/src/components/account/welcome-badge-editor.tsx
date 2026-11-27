'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Download, ImagePlus, Share2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, fetchBlob, get, upload } from '@/lib/api';
import { t } from '@/lib/i18n';
import {
  drawWelcomeBadge, welcomeBadgeCropFrame, WELCOME_BADGE_HEIGHT, WELCOME_BADGE_LOGO, WELCOME_BADGE_PHOTO, WELCOME_BADGE_WIDTH,
  type WelcomeBadgeCrop,
} from '@/lib/welcome-badge-render';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, ErrorBox, Skeleton } from '@/components/ui/misc';

const endpoint = '/me/welcome-badge';
const defaultCrop = { zoom: 1, x: 0, y: 0 };
const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const filename = 'nexovax-welcome-badge.png';

type BadgeDetails = WelcomeBadgeCrop & { publicName: string };
type BadgePhoto = { image: HTMLImageElement; file?: File };

async function loadImage(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

async function decodePhoto(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
}

export function WelcomeBadgeEditor({ userId, initialName, avatarUrl }: { userId: string; initialName: string; avatarUrl?: string | null }) {
  const badge = useQuery({
    queryKey: ['welcome-badge', userId],
    queryFn: async () => {
      const details = await get<BadgeDetails | null>(endpoint);
      if (!details) return null;
      return { details, photo: { image: await decodePhoto(await fetchBlob(`${endpoint}/photo`)) } };
    },
    staleTime: Infinity,
    gcTime: 0,
  });

  if (badge.isPending) return <Skeleton className="h-64" />;
  if (badge.isError) return <ErrorBox message={t('No se pudo cargar la insignia.')} onRetry={() => void badge.refetch()} />;
  return <BadgeForm initial={badge.data} initialName={initialName} avatarUrl={avatarUrl} />;
}

function BadgeForm({ initial, initialName, avatarUrl }: {
  initial: { details: BadgeDetails; photo: BadgePhoto } | null;
  initialName: string;
  avatarUrl?: string | null;
}) {
  const [saved, setSaved] = useState(initial?.details ?? null);
  const [name, setName] = useState(initial?.details.publicName ?? Array.from(initialName.trim()).slice(0, 64).join(''));
  const [photo, setPhoto] = useState<BadgePhoto | null>(initial?.photo ?? null);
  const [crop, setCrop] = useState<WelcomeBadgeCrop>(initial?.details ?? defaultCrop);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareOptions, setShareOptions] = useState(false);
  const [fontFamily, setFontFamily] = useState('');
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; crop: WelcomeBadgeCrop } | null>(null);
  const logo = useQuery({ queryKey: ['welcome-badge-logo'], queryFn: () => loadImage(WELCOME_BADGE_LOGO), staleTime: Infinity });

  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) setFontFamily(getComputedStyle(document.body).fontFamily);
    });
    return () => { active = false; };
  }, []);

  const publicName = name.trim().replace(/\s+/g, ' ');
  const validName = /[\p{L}\p{N}]/u.test(publicName);
  const busy = photoBusy || saving;
  const ready = !!logo.data && !!fontFamily;
  const canExport = !!photo && validName && ready && !busy;
  const dirty = !saved || !!photo?.file || saved.publicName !== publicName || saved.x !== crop.x || saved.y !== crop.y || saved.zoom !== crop.zoom;
  const frame = photo && welcomeBadgeCropFrame(photo.image.naturalWidth, photo.image.naturalHeight, crop);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && logo.data && fontFamily) drawWelcomeBadge(ctx, { publicName, crop, photo: photo?.image ?? null, logo: logo.data, fontFamily });
    return ctx && ready ? canvas : null;
  }, [logo.data, fontFamily, crop, photo, publicName, ready]);

  useEffect(() => { draw(); }, [draw]);

  const selectPhoto = async (getFile: () => Promise<File>) => {
    if (busy) return;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const file = await getFile();
      if (!imageTypes.includes(file.type)) {
        setPhotoError(t('Formato no permitido. Usa JPG, PNG, WebP o AVIF.'));
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        setPhotoError(t('La imagen supera 8 MB.'));
        return;
      }
      setPhoto({ image: await decodePhoto(file), file });
      setCrop(defaultCrop);
    } catch {
      setPhotoError(t('No se pudo abrir la foto. Selecciona otra e inténtalo de nuevo.'));
    } finally { setPhotoBusy(false); }
  };

  const selectAvatar = () => {
    if (!avatarUrl) return;
    void selectPhoto(async () => {
      const response = await fetch(avatarUrl);
      if (!response.ok) throw new Error('Profile photo unavailable');
      const blob = await response.blob();
      return new File([blob], 'profile-photo', { type: blob.type });
    });
  };

  const movePhoto = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || !frame || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const scale = event.currentTarget.clientWidth / WELCOME_BADGE_PHOTO.diameter;
    const position = (value: number, delta: number, padding: number) => padding > 0 && scale > 0
      ? Math.max(-1, Math.min(1, value + delta / (padding * scale))) : 0;
    setCrop({ ...start.crop, x: position(start.crop.x, event.clientX - start.x, frame.paddingX), y: position(start.crop.y, event.clientY - start.y, frame.paddingY) });
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!photo || !validName || !dirty || busy) return;
    setSaving(true);
    try {
      const data = new FormData();
      data.set('publicName', publicName);
      data.set('zoom', String(crop.zoom));
      data.set('x', String(crop.x));
      data.set('y', String(crop.y));
      if (photo.file) data.set('file', photo.file);
      const details = await upload<BadgeDetails>(endpoint, data);
      setSaved(details);
      setName(details.publicName);
      setCrop(details);
      setPhoto({ image: photo.image });
      toast.success(t('Insignia guardada.'));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally { setSaving(false); }
  };

  // Encode while the share button's user gesture is still active, including in WebKit.
  const badgeFile = () => {
    const canvas = draw();
    if (!canvas) throw new Error('Badge canvas unavailable');
    const encoded = canvas.toDataURL('image/png').split(',')[1];
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new File([bytes], filename, { type: 'image/png' });
  };

  const download = () => {
    try {
      const href = URL.createObjectURL(badgeFile());
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch { toast.error(t('No se pudo preparar la insignia.')); }
  };

  const share = async () => {
    if (sharing) return;
    try {
      if (navigator.share && navigator.canShare) {
        const files = [badgeFile()];
        if (navigator.canShare({ files })) {
          setSharing(true);
          await navigator.share({ files });
          return;
        }
      }
      setShareOptions(true);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setShareOptions(true);
    } finally { setSharing(false); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': badgeFile() })]);
      setShareOptions(false);
      toast.success(t('Imagen copiada.'));
    } catch { toast.error(t('No se pudo copiar la imagen. Puedes descargar el PNG.')); }
  };

  return (
    <div className="card grid items-start gap-6 p-4 sm:p-6 md:grid-cols-[minmax(0,3fr)_minmax(0,4fr)] lg:gap-8">
      <figure className="mx-auto w-full max-w-[350px]">
        <figcaption className="mb-2 text-sm font-semibold">{t('Vista previa')}</figcaption>
        <div className="relative overflow-hidden rounded-xl bg-brand-950 ring-1 ring-inset ring-line">
          <canvas ref={canvasRef} width={WELCOME_BADGE_WIDTH} height={WELCOME_BADGE_HEIGHT} role="img"
            aria-label={t('Vista previa de la insignia')} aria-describedby={`${inputId}-preview`} className="block h-auto w-full" />
          <p id={`${inputId}-preview`} className="sr-only" lang="en">
            NEXOVAX. NEW MEMBER. {publicName && `${publicName}. `}WELCOME TO NEXOVAX! We&apos;re excited to have you with us. Your journey starts here. BUY • SELL • EARN. nexovax.com
          </p>
          {frame && !busy && (frame.paddingX > 0 || frame.paddingY > 0) && (
            <div aria-hidden="true" className="absolute touch-none cursor-grab rounded-full active:cursor-grabbing" style={{
              left: `${100 * WELCOME_BADGE_PHOTO.left / WELCOME_BADGE_WIDTH}%`, top: `${100 * WELCOME_BADGE_PHOTO.top / WELCOME_BADGE_HEIGHT}%`,
              width: `${100 * WELCOME_BADGE_PHOTO.diameter / WELCOME_BADGE_WIDTH}%`, aspectRatio: '1',
            }} onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              drag.current = { x: event.clientX, y: event.clientY, crop };
              event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerMove={movePhoto} onLostPointerCapture={() => { drag.current = null; }} />
          )}
          {!ready && <Skeleton className="absolute inset-0 rounded-none" />}
        </div>
        {logo.isError && <div className="mt-2"><ErrorBox message={t('No se pudo preparar la insignia.')} onRetry={() => void logo.refetch()} /></div>}
      </figure>

      <form noValidate onSubmit={save} className="min-w-0 space-y-5">
        <div>
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold">{t('Nombre público')}</label>
          <Input id={inputId} required autoComplete="nickname" maxLength={64} value={name} disabled={saving}
            aria-describedby={`${inputId}-hint`} onChange={(event) => setName(event.target.value)} />
          <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-muted">{t('Este nombre aparece en la insignia.')}</p>
        </div>

        <div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              <ImagePlus /> {photo ? t('Cambiar foto') : t('Elegir foto')}
            </Button>
            {avatarUrl && <Button type="button" variant="secondary" disabled={busy} onClick={selectAvatar}>
              <UserRound /> {t('Usar mi foto de perfil')}
            </Button>}
          </div>
          <input ref={fileRef} type="file" accept={imageTypes.join(',')} hidden onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void selectPhoto(async () => file);
          }} />
          <p className="mt-2 text-xs text-muted" role="status">{photoBusy ? t('Preparando foto…') : t('JPG, PNG, WebP o AVIF · máx. 8 MB')}</p>
          {photoError && <p role="alert" className="mt-1.5 text-sm text-red-700">{photoError}</p>}
        </div>

        {photo && frame && <fieldset disabled={busy} className="space-y-3 rounded-xl bg-surface px-4 pb-4">
          <legend className="px-1 text-sm font-semibold">{t('Ajustar foto')}</legend>
          <p className="text-xs text-muted">{t('Arrastra la foto o usa los controles para encuadrarla.')}</p>
          <CropControl label={t('Zoom')} value={crop.zoom} min={1} max={3} onChange={(zoom) => setCrop({ ...crop, zoom })} />
          <CropControl label={t('Posición horizontal')} value={crop.x} min={-1} max={1} disabled={!frame.paddingX} onChange={(x) => setCrop({ ...crop, x })} />
          <CropControl label={t('Posición vertical')} value={crop.y} min={-1} max={1} disabled={!frame.paddingY} onChange={(y) => setCrop({ ...crop, y })} />
          <Button type="button" size="sm" variant="secondary" disabled={busy || (!crop.x && !crop.y)}
            onClick={() => setCrop({ ...crop, x: 0, y: 0 })}>{t('Centrar foto')}</Button>
        </fieldset>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={saving} disabled={!photo || !validName || busy || !dirty}><Check /> {t('Guardar insignia')}</Button>
          <Button type="button" variant="outline" disabled={!canExport} onClick={download}><Download /> {t('Descargar PNG')}</Button>
          <Button type="button" variant="outline" disabled={!canExport || sharing} onClick={() => void share()}><Share2 /> {t('Compartir insignia')}</Button>
        </div>
      </form>

      <Dialog open={shareOptions} onOpenChange={setShareOptions} title={t('Compartir insignia')} size="sm"
        description={t('Descarga el PNG y adjúntalo a una publicación en tu red social.')}>
        <div className="flex flex-wrap justify-end gap-2">
          {typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write &&
            <Button variant="outline" onClick={() => void copy()}><Copy /> {t('Copiar imagen')}</Button>}
          <Button onClick={download}><Download /> {t('Descargar PNG')}</Button>
        </div>
      </Dialog>
    </div>
  );
}

function CropControl({ label, value, min, max, disabled, onChange }: {
  label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-0.5 text-sm">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={0.01} value={value} disabled={disabled}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="block h-7 w-full accent-brand-600 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-40" />
    </label>
  );
}
