// Shared settings for the k6 load tests (see tests/load/README.md).
/** API base, ending in /api. Default: production. */
export const API = (__ENV.API_URL || 'https://api.nexovax.com/api').replace(/\/+$/, '');

/** Which profile to run: smoke | load | stress | spike. */
export const PROFILE = (__ENV.PROFILE || 'smoke').toLowerCase();

/**
 * The API rate-limits 300 requests/minute per visitor IP. From one machine every virtual user
 * would share that limit, so with PROXY_SHARED_SECRET each virtual user presents its own
 * synthetic IP (198.18.0.0/15, reserved for benchmarks), the way our web proxy does for real visitors.
 * Without the secret, expect 429 responses beyond ~5 req/s: they are counted apart, not as errors.
 */
// The secret is only ever sent to our own API (or a local one), never to a host typed by hand.
const TRUSTED_HOSTS = ['api.nexovax.com', 'localhost', '127.0.0.1'];
const API_HOST = (/^https?:\/\/([^/:]+)/i.exec(API) || [])[1] || '';
const SECRET = TRUSTED_HOSTS.includes(API_HOST.toLowerCase()) ? __ENV.PROXY_SHARED_SECRET || '' : '';

export function visitorHeaders() {
  const h = { Accept: 'application/json', 'x-locale': 'es', 'User-Agent': 'nexovax-k6' };
  if (SECRET) {
    h['x-nx-proxy-secret'] = SECRET;
    h['x-nx-client-ip'] = `198.${18 + ((__VU >> 16) & 1)}.${(__VU >> 8) & 255}.${__VU & 255}`;
  }
  return h;
}

/** Load profiles. Free Render instance + Supabase pooler: start with smoke, then load. */
const PROFILES = {
  smoke: { executor: 'constant-vus', vus: 1, duration: '30s' },
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 10 },
      { duration: '3m', target: 10 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '15s',
  },
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 20 },
      { duration: '2m', target: 40 },
      { duration: '2m', target: 60 },
      { duration: '1m', target: 0 },
    ],
    gracefulRampDown: '15s',
  },
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: 50 },
      { duration: '1m', target: 50 },
      { duration: '10s', target: 0 },
    ],
    gracefulRampDown: '10s',
  },
};

export function scenarios(exec) {
  const p = PROFILES[PROFILE];
  if (!p) throw new Error(`Unknown PROFILE "${PROFILE}" (smoke | load | stress | spike)`);
  return { [PROFILE]: { ...p, exec } };
}

/** Pass/fail criteria. Stress and spike look for the breaking point, so they only fail on errors. */
export function thresholds() {
  const strict = PROFILE === 'smoke' || PROFILE === 'load';
  return {
    http_req_failed: [strict ? 'rate<0.01' : 'rate<0.05'],
    'http_req_duration{kind:list}': [strict ? 'p(95)<800' : 'p(95)<3000'],
    'http_req_duration{kind:detail}': [strict ? 'p(95)<1000' : 'p(95)<3000'],
    'http_req_duration{kind:search}': [strict ? 'p(95)<600' : 'p(95)<3000'],
    checks: ['rate>0.99'],
    rate_limited: ['count>=0'],
  };
}

/** Think time between pages, in seconds. */
export const pause = (min = 1, max = 3) => min + Math.random() * (max - min);
export const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
