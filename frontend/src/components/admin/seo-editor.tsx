'use client';
import { useRef, useState } from 'react';
import { Globe2, ImageUp, Search, Share2, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, upload } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';

export type Seo = {
  siteName: string; title: string; titleTemplate: string; description: string; keywords: string; canonicalUrl: string;
  ogImage: string; ogImageAlt: string; twitterHandle: string; twitterCard: 'summary_large_image' | 'summary';
  googleVerification: string; bingVerification: string; noindex: boolean;
  [k: string]: any;
};

const LANGS = [['', 'Español'], ['En', 'English'], ['Fr', 'Français'], ['Ht', 'Kreyòl ayisyen']] as const;

/** Admin → Configuración → SEO: defaults for every page's title, description, canonical, Open Graph and X card. */
export function SeoEditor({ value, onChange, marketplaceName }: { value: Seo; onChange: (v: Seo) => void; marketplaceName: string }) {
  const [lang, setLang] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const v = value;
  const set = (k: string, x: any) => onChange({ ...v, [k]: x });
  const name = v.siteName?.trim() || marketplaceName;
  const title = v[`title${lang}`] ?? '';
  const description = v[`description${lang}`] ?? '';
  const previewTitle = [name, v[`title${lang}`] || v.title].filter(Boolean).join(' · ');
  const previewDesc = v[`description${lang}`] || v.description;
  const host = (() => { try { return new URL(v.canonicalUrl).host; } catch { return ''; } })();
  const imageSrc = v.ogImage?.trim();

  const pick = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', f);
      const r = await upload<{ url: string }>('/admin/settings/seo-image', form);
      onChange({ ...v, ogImage: r.url });
      toast.success(t('Imagen subida. Guarda los cambios para publicarla.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <>
      <Card>
        <CardHeader icon={<Search />} title={t('Títulos y descripción')} subtitle={t('Lo que muestran Google y los demás buscadores. Productos, categorías y tiendas usan sus propios datos y, si les falta algo, estos valores.')} />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Field label={t('Nombre del sitio')} hint={t('Vacío: se usa el nombre del marketplace ({n}).', { n: marketplaceName })}>
            <Input value={v.siteName ?? ''} placeholder={marketplaceName} maxLength={60} onChange={(e) => set('siteName', e.target.value)} />
          </Field>
          <Field label={t('Plantilla de título de las páginas')} hint={t('%s es el título de cada página. Vacío: «%s · {n}».', { n: name })}>
            <Input value={v.titleTemplate ?? ''} placeholder={`%s · ${name}`} maxLength={80} onChange={(e) => set('titleTemplate', e.target.value)} />
          </Field>
          <div className="sm:col-span-2 inline-flex w-fit flex-wrap gap-1 rounded-lg border border-line p-1">
            {LANGS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setLang(k)} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold', lang === k ? 'bg-brand-50 text-brand-700' : 'text-muted hover:text-ink')}>{l}</button>
            ))}
          </div>
          <Field label={t('Título de la portada')} required={!lang} className="sm:col-span-2" hint={lang ? t('Opcional: si lo dejas vacío se usa el texto en español.') : t('Se muestra junto al nombre del sitio. Recomendado: hasta 60 caracteres en total.')}>
            <Input value={title} maxLength={70} onChange={(e) => set(`title${lang}`, e.target.value)} />
          </Field>
          <Field label={t('Meta descripción')} required={!lang} className="sm:col-span-2" hint={`${description.length}/160 ${t('caracteres recomendados')}`}>
            <Textarea rows={3} value={description} maxLength={300} onChange={(e) => set(`description${lang}`, e.target.value)} />
          </Field>
          <Field label={t('Palabras clave')} className="sm:col-span-2" hint={t('Separadas por comas. Opcional.')}>
            <Input value={v.keywords ?? ''} maxLength={300} onChange={(e) => set('keywords', e.target.value)} />
          </Field>
        </div>
        <div className="mx-5 mb-5 rounded-xl border border-line p-4" data-seo-preview>
          <p className="text-xs text-muted">{host || t('tu-dominio')}</p>
          <p className="truncate text-lg text-[#1a0dab]">{previewTitle || t('Sin título')}</p>
          <p className="line-clamp-2 text-sm text-muted">{previewDesc || t('Sin descripción')}</p>
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Globe2 />} title={t('URL canónica')} subtitle={t('Dominio principal del sitio. Cada página indica su enlace canónico con este dominio, también el sitemap y los enlaces al compartir.')} />
        <div className="p-5">
          <Field label={t('URL canónica')} hint={t('Ej.: https://tudominio.com (sin www si ese es tu dominio principal). Vacío: se usa el dominio configurado en el servidor web.')}>
            <Input value={v.canonicalUrl ?? ''} placeholder="https://" onChange={(e) => set('canonicalUrl', e.target.value.trim())} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Share2 />} title={t('Redes sociales (Open Graph y X)')} subtitle={t('Imagen y datos de la tarjeta al compartir un enlace en Facebook, WhatsApp, LinkedIn o X.')} />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3 sm:col-span-2">
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="grid aspect-[1200/630] place-items-center bg-surface">
                {imageSrc ? <img src={imageSrc} alt={v.ogImageAlt || ''} className="size-full object-cover" /> : <span className="px-6 text-center text-sm text-muted">{t('Sin imagen: se usará el ícono del sitio. Sube una imagen de 1200 × 630 px.')}</span>}
              </div>
              <div className="border-t border-line p-3">
                <p className="text-xs uppercase text-muted">{host || t('tu-dominio')}</p>
                <p className="truncate font-semibold">{previewTitle || t('Sin título')}</p>
                <p className="line-clamp-1 text-sm text-muted">{previewDesc}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              <Button variant="outline" size="sm" loading={busy} onClick={() => file.current?.click()}><ImageUp /> {t('Subir imagen')}</Button>
              {imageSrc && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => set('ogImage', '')}><Trash2 /> {t('Quitar')}</Button>}
            </div>
          </div>
          <Field label={t('Enlace de la imagen')} className="sm:col-span-2" hint={t('Se completa al subirla; también puedes pegar un enlace https://')}>
            <Input value={v.ogImage ?? ''} onChange={(e) => set('ogImage', e.target.value.trim())} />
          </Field>
          <Field label={t('Texto alternativo de la imagen')} className="sm:col-span-2">
            <Input value={v.ogImageAlt ?? ''} maxLength={200} onChange={(e) => set('ogImageAlt', e.target.value)} />
          </Field>
          <Field label={t('Usuario en X (Twitter)')} hint={t('Ej.: @tumarca. Opcional.')}>
            <Input value={v.twitterHandle ?? ''} placeholder="@" maxLength={16} onChange={(e) => set('twitterHandle', e.target.value.trim())} />
          </Field>
          <Field label={t('Tipo de tarjeta en X')}>
            <Select value={v.twitterCard ?? 'summary_large_image'} onChange={(e) => set('twitterCard', e.target.value)}>
              <option value="summary_large_image">{t('Imagen grande')}</option>
              <option value="summary">{t('Resumen con miniatura')}</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader icon={<ShieldCheck />} title={t('Indexación y verificación')} subtitle={t('Códigos de Google Search Console y Bing Webmaster Tools (solo el valor de content).')} />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <Field label={t('Verificación de Google')}><Input value={v.googleVerification ?? ''} maxLength={120} onChange={(e) => set('googleVerification', e.target.value.trim())} /></Field>
          <Field label={t('Verificación de Bing')}><Input value={v.bingVerification ?? ''} maxLength={120} onChange={(e) => set('bingVerification', e.target.value.trim())} /></Field>
          <div className="flex items-center justify-between rounded-xl border border-line p-4 sm:col-span-2">
            <span><b className="block text-sm">{t('Ocultar el sitio de los buscadores')}</b><span className="text-xs text-muted">{t('Añade noindex a todas las páginas y bloquea el rastreo en robots.txt. Úsalo solo antes del lanzamiento o en copias de prueba.')}</span></span>
            <Switch checked={!!v.noindex} onCheckedChange={(x) => set('noindex', x)} />
          </div>
        </div>
      </Card>
    </>
  );
}
