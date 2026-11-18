// Visitor browsing the storefront through the public API:
// home → categories → product list (random page/sort) → product detail → reviews → search.
//   k6 run tests/load/browse.js                         (smoke against production)
//   PROFILE=load k6 run tests/load/browse.js
//   API_URL=http://localhost:4000/api PROFILE=stress k6 run tests/load/browse.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { API, PROFILE, pause, randomItem, scenarios, thresholds, visitorHeaders } from './lib/config.js';

const rateLimited = new Counter('rate_limited');

export const options = {
  scenarios: scenarios('browse'),
  thresholds: thresholds(),
  setupTimeout: '90s', // a sleeping free Render instance takes ~1 min to wake
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
// A 429 is the rate limiter working, not a failure of the service.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

const SEARCH_TERMS = ['zapatillas', 'camisa', 'telefono', 'bolso', 'reloj', 'audifonos', 'mochila', 'balon'];
const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'rating'];

function get(path, kind) {
  const res = http.get(`${API}${path}`, { headers: visitorHeaders(), tags: { kind, name: `${kind}:${path.split('?')[0].replace(/\/products\/[^/]+/, '/products/:slug')}` } });
  if (res.status === 429) rateLimited.add(1);
  return res;
}

const json = (res) => {
  try {
    return res.json();
  } catch {
    return null;
  }
};

/** Wakes the API and collects product slugs to browse. */
export function setup() {
  const health = http.get(`${API}/health`, { timeout: '90s' });
  if (health.status !== 200) throw new Error(`API not healthy at ${API}/health (status ${health.status})`);
  const list = json(http.get(`${API}/products?pageSize=48`, { headers: { Accept: 'application/json' } }));
  const slugs = (list?.items ?? []).map((p) => p.slug).filter(Boolean);
  if (!slugs.length) throw new Error('No products returned by /products: nothing to browse.');
  console.log(`profile=${PROFILE} api=${API} products=${slugs.length}`);
  return { slugs };
}

export function browse({ slugs }) {
  group('home', () => {
    check(get('/home', 'list'), { 'home 200': (r) => r.status === 200 || r.status === 429 });
    get('/config/public', 'list');
  });
  sleep(pause());

  group('catalog', () => {
    check(get('/categories', 'list'), { 'categories 200': (r) => r.status === 200 || r.status === 429 });
    const page = 1 + Math.floor(Math.random() * 3);
    const res = get(`/products?page=${page}&pageSize=24&sort=${randomItem(SORTS)}`, 'list');
    check(res, { 'products 200': (r) => r.status === 200 || r.status === 429 });
  });
  sleep(pause());

  group('product', () => {
    const slug = randomItem(slugs);
    const res = get(`/products/${encodeURIComponent(slug)}`, 'detail');
    check(res, {
      'detail 200': (r) => r.status === 200 || r.status === 429,
      'detail has title': (r) => r.status === 429 || !!json(r)?.title,
    });
    get(`/products/${encodeURIComponent(slug)}/reviews`, 'detail');
  });
  sleep(pause(2, 5));

  group('search', () => {
    const q = randomItem(SEARCH_TERMS);
    check(get(`/search/suggest?q=${encodeURIComponent(q.slice(0, 3))}`, 'search'), { 'suggest 200': (r) => r.status === 200 || r.status === 429 });
    check(get(`/products?q=${encodeURIComponent(q)}&pageSize=24`, 'list'), { 'search 200': (r) => r.status === 200 || r.status === 429 });
  });
  sleep(pause());
}

/** Lets `k6 run --vus N --duration T browse.js` work too (overrides PROFILE). */
export default function (data) {
  browse(data);
}
