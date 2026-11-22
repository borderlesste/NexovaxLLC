/**
 * Content-Security-Policy for pages (defense in depth against injected scripts/navigation), sent by
 * src/middleware.ts with a fresh nonce per request.
 *
 * Scripts: only those carrying the request's nonce (Next.js adds it to its own scripts and to next/script)
 * and, through 'strict-dynamic', the scripts they load (Stripe, PayPal, Cloudflare Turnstile, Vercel
 * Analytics, Google Analytics 4 with consent). No 'unsafe-inline': an injected <script> or onclick= won't run.
 * The host list only applies to old browsers without 'strict-dynamic'.
 */
export function buildCsp(nonce: string) {
  const dev = process.env.NODE_ENV !== 'production';
  const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  // Uploads and private downloads go straight to the API (see src/lib/api.ts).
  const DIRECT_API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '').replace(/\/api$/, '');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''} https://js.stripe.com https://*.js.stripe.com https://www.paypal.com https://*.paypal.com https://www.paypalobjects.com https://challenges.cloudflare.com https://www.googletagmanager.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${DIRECT_API} ${SUPABASE} ${SUPABASE.replace('https://', 'wss://')} https://api.stripe.com https://*.stripe.com https://*.paypal.com https://www.sandbox.paypal.com https://api-m.paypal.com https://api-m.sandbox.paypal.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com`,
    'frame-src https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://*.stripe.com https://www.paypal.com https://*.paypal.com https://www.sandbox.paypal.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]
    .join('; ')
    .replace(/\s{2,}/g, ' ');
}
