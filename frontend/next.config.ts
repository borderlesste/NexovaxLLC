import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

// Content-Security-Policy: sent by src/middleware.ts with a nonce per request (src/lib/csp.ts).

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
          // HTTPS only, for 2 years, on nexovax.com and its subdomains (www, api).
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com" "https://www.paypal.com")' },
        ],
      },
      // Language files carry a content hash in their name (src/app/i18n): cache them for a year.
      { source: '/i18n/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
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
