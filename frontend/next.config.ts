import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
// Uploads and private downloads go straight to the API (see src/lib/api.ts).
const DIRECT_API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '').replace(/\/api$/, '');
const dev = process.env.NODE_ENV !== 'production';

/**
 * Content-Security-Policy (defense in depth against injected scripts/navigation).
 * Allows only the app itself, Supabase, Stripe (Payment Element / 3-D Secure), PayPal, Cloudflare Turnstile, Sentry (error reports)
 * and Google Analytics 4 (loaded only with the visitor's analytics consent).
 * 'unsafe-inline' scripts are required by Next.js hydration without nonces.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} https://js.stripe.com https://*.js.stripe.com https://www.paypal.com https://*.paypal.com https://www.paypalobjects.com https://challenges.cloudflare.com https://www.googletagmanager.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${DIRECT_API} ${SUPABASE} ${SUPABASE.replace('https://', 'wss://')} https://api.stripe.com https://*.stripe.com https://*.paypal.com https://www.sandbox.paypal.com https://api-m.paypal.com https://api-m.sandbox.paypal.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com`,
  'frame-src https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://*.stripe.com https://www.paypal.com https://*.paypal.com https://www.sandbox.paypal.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // src/middleware.ts runs on /api/* (visitor IP for rate limits). Uploads normally go straight to the
    // API (NEXT_PUBLIC_API_URL); without it they pass here and must arrive whole: up to 8 images × 8 MB.
    middlewareClientMaxBodySize: '80mb',
  },
  // Browser calls /api/* on the same origin; Next proxies to the NestJS API.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com" "https://www.paypal.com")' },
        ],
      },
    ];
  },
};

/**
 * Sentry: uploads the source maps of production builds so stack traces show the original code, and tags
 * errors with the release (Vercel's commit SHA). Without SENTRY_AUTH_TOKEN (local builds) nothing is uploaded.
 * Client source maps are deleted after upload, so they are never served to visitors.
 */
export default withSentryConfig(nextConfig, {
  org: 'nexovax-llc',
  project: 'nexovax-web',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN, deleteSourcemapsAfterUpload: true },
});
