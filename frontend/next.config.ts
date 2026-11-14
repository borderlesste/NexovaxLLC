import type { NextConfig } from 'next';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const dev = process.env.NODE_ENV !== 'production';

/**
 * Content-Security-Policy (defense in depth against injected scripts/navigation).
 * Allows only the app itself, Supabase, Stripe (Payment Element / 3-D Secure) and PayPal.
 * 'unsafe-inline' scripts are required by Next.js hydration without nonces.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} https://js.stripe.com https://*.js.stripe.com https://www.paypal.com https://*.paypal.com https://www.paypalobjects.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE} ${SUPABASE.replace('https://', 'wss://')} https://api.stripe.com https://*.stripe.com https://*.paypal.com https://www.sandbox.paypal.com https://api-m.paypal.com https://api-m.sandbox.paypal.com`,
  'frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://*.stripe.com https://www.paypal.com https://*.paypal.com https://www.sandbox.paypal.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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

export default nextConfig;
