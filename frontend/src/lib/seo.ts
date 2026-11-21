import 'server-only';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getServerLocale } from './i18n/server';
import type { Locale } from './i18n/core';
import { serverGet } from './server-api';
import { siteUrl } from './site-url';

/** SEO defaults edited in Admin → Configuración → SEO (served by /api/config/public). */
export interface SeoDefaults {
  siteName?: string;
  title?: string; titleEn?: string; titleFr?: string; titleHt?: string;
  titleTemplate?: string;
  description?: string; descriptionEn?: string; descriptionFr?: string; descriptionHt?: string;
  keywords?: string;
  canonicalUrl?: string;
  ogImage?: string;
  ogImageAlt?: string;
  twitterHandle?: string;
  twitterCard?: 'summary_large_image' | 'summary';
  googleVerification?: string;
  bingVerification?: string;
  noindex?: boolean;
}

export interface SeoContext {
  seo: SeoDefaults;
  locale: Locale;
  siteName: string;
  /** Public origin for canonical and share links: the admin setting, else the web's env. */
  base: string;
  /** Home title next to the site name, in the request language. */
  title: string;
  description: string;
  template: string;
}

const SUFFIX: Record<Locale, string> = { es: '', en: 'En', fr: 'Fr', ht: 'Ht' };
const OG_LOCALE: Record<Locale, string> = { es: 'es_ES', en: 'en_US', fr: 'fr_FR', ht: 'ht_HT' };
/** Share image when the admin has not uploaded one: the site icon (square, so a small card). */
const FALLBACK_IMAGE = '/icon-512.png';

const pick = (seo: SeoDefaults, field: 'title' | 'description', locale: Locale) =>
  ((seo as any)[`${field}${SUFFIX[locale]}`] || (locale === 'ht' ? (seo as any)[`${field}Fr`] : '') || (locale !== 'es' ? seo[`${field}En` as const] : '') || seo[field] || '').trim();

export async function getSeo(): Promise<SeoContext> {
  const [cfg, locale] = await Promise.all([serverGet<{ name?: string; seo?: SeoDefaults }>('/config/public', 60), getServerLocale()]);
  const seo = cfg?.seo ?? {};
  const siteName = seo.siteName?.trim() || cfg?.name?.trim() || '';
  const base = (seo.canonicalUrl?.trim() || siteUrl()).replace(/\/+$/, '');
  const template = seo.titleTemplate?.includes('%s') ? seo.titleTemplate : siteName ? `%s · ${siteName}` : '%s';
  return { seo, locale, siteName, base, title: pick(seo, 'title', locale), description: pick(seo, 'description', locale), template };
}

/** Path of the current request (set by src/middleware.ts), without query string. */
export async function requestPath(): Promise<string> {
  const p = (await headers()).get('x-nx-pathname') || '/';
  return p.startsWith('/') ? p : '/';
}

export interface PageSeo {
  /** Page title without the site name (the template adds it). Omit on the home page. */
  title?: string;
  description?: string | null;
  /** Canonical path (no query); defaults to the request path. */
  path?: string;
  images?: (string | null | undefined)[];
  imageAlt?: string | null;
  type?: 'website' | 'article' | 'profile';
  noindex?: boolean;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plain = (s?: string | null) => (s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Full metadata for a page: title, description, canonical, Open Graph and Twitter/X card.
 * Next.js replaces (does not merge) openGraph/twitter between segments, so every page sends all of it,
 * falling back to the admin defaults.
 */
export async function pageMetadata(page: PageSeo = {}, ctx?: SeoContext): Promise<Metadata> {
  const c = ctx ?? (await getSeo());
  const path = page.path ?? (await requestPath());
  const homeTitle = [c.siteName, c.title].filter(Boolean).join(' · ') || c.title || c.siteName;
  const fullTitle = page.title ? c.template.replace('%s', page.title) : homeTitle;
  const description = clip(plain(page.description) || c.description, 300) || undefined;
  const own = (page.images ?? []).filter((x): x is string => !!x);
  const images = own.length ? own : [c.seo.ogImage?.trim() || FALLBACK_IMAGE];
  const large = images[0] !== FALLBACK_IMAGE && (c.seo.twitterCard ?? 'summary_large_image') === 'summary_large_image';
  const alt = page.imageAlt || (own.length ? page.title : c.seo.ogImageAlt) || fullTitle || undefined;
  const noindex = !!c.seo.noindex || !!page.noindex;
  const handle = c.seo.twitterHandle?.trim() || undefined;
  return {
    metadataBase: new URL(c.base),
    title: page.title ? page.title : { absolute: homeTitle },
    description,
    keywords: c.seo.keywords?.split(',').map((k) => k.trim()).filter(Boolean),
    applicationName: c.siteName || undefined,
    alternates: { canonical: path },
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: page.type ?? 'website',
      url: path,
      siteName: c.siteName || undefined,
      locale: OG_LOCALE[c.locale],
      title: fullTitle,
      description,
      images: images.slice(0, 4).map((url) => ({ url, alt })),
    },
    twitter: {
      card: large ? 'summary_large_image' : 'summary',
      site: handle,
      creator: handle,
      title: fullTitle,
      description,
      images: images.slice(0, 1),
    },
  };
}
