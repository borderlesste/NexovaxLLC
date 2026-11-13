import type { NextConfig } from 'next';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Browser calls /api/* on the same origin; Next proxies to the NestJS API.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
  images: { unoptimized: true },
};

export default nextConfig;
