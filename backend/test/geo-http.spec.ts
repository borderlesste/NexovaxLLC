// HTTP acceptance checks for NX-GEO-001 (real controllers, guard and validation; data services mocked).
jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../src/auth/auth';
import { DbService } from '../src/db/db.service';
import { GeoController } from '../src/geo/geo.controller';
import { AvailabilityService } from '../src/geo/availability';
import { SettingsService } from '../src/settings/settings.service';
import { CartController } from '../src/cart/cart.controller';
import { CartService } from '../src/cart/cart.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { AlertsService } from '../src/analytics/alerts.service';
import { SellerController } from '../src/seller/seller.controller';
import { SellerService } from '../src/seller/seller.service';
import { OrdersService } from '../src/orders/orders.service';

const any = () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : jest.fn().mockResolvedValue({ ok: true })) });
const PID = '11111111-1111-4111-8111-111111111111';

describe('NX-GEO-001 over HTTP', () => {
  let app: INestApplication;
  const availability = { forProducts: jest.fn(async (country: string, ids: string[]) => ({ country, items: Object.fromEntries(ids.map((i) => [i, { status: 'UNCONFIRMED', reason: 'NEEDS_ADDRESS', shipsFrom: 'US' }])) })) };
  const cart = { preview: jest.fn(async () => ({ guest: true, groups: [] })), merge: jest.fn() };

  jest.setTimeout(60_000);
  beforeAll(async () => {
    const db = { many: async () => ['US', 'DO', 'BR'].map((alpha2) => ({ alpha2 })), one: async () => null };
    const settings = { all: async () => ({ 'marketplace.default_country': 'US', 'geo.delivery': { ipDetection: true, showSelector: true, countries: [] } }) };
    const mod = await Test.createTestingModule({
      controllers: [GeoController, CartController, SellerController],
      providers: [
        { provide: DbService, useValue: db },
        { provide: SettingsService, useValue: settings },
        { provide: AvailabilityService, useValue: availability },
        { provide: CartService, useValue: cart },
        { provide: AnalyticsService, useValue: any() },
        { provide: AlertsService, useValue: any() },
        { provide: SellerService, useValue: any() },
        { provide: OrdersService, useValue: any() },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    await app.init();
  });
  afterAll(() => app.close());

  it('first visit: suggested destination without an account, never cached', async () => {
    const r = await request(app.getHttpServer()).get('/api/geo/context').expect(200);
    expect(r.body).toMatchObject({ deliveryCountry: 'US', source: 'default', isApproximate: true });
    expect(r.headers['cache-control']).toContain('no-store');
  });

  it('manual choice wins; invalid cookie and client-sent country headers are ignored', async () => {
    const m = await request(app.getHttpServer()).get('/api/geo/context').set('Cookie', 'nx_locale=en; nx_delivery_country=DO').expect(200);
    expect(m.body).toMatchObject({ deliveryCountry: 'DO', source: 'manual', isApproximate: false });
    const f = await request(app.getHttpServer()).get('/api/geo/context').set('Cookie', 'nx_delivery_country=ZZ').set('x-nx-ip-country', 'BR').set('x-vercel-ip-country', 'BR').expect(200);
    expect(f.body).toMatchObject({ detectedCountry: null, source: 'default' });
  });

  it('uses the default destination if the country cookie is malformed', async () => {
    const response = await request(app.getHttpServer()).get('/api/geo/context').set('Cookie', 'nx_locale=en; nx_delivery_country=%').expect(200);
    expect(response.body).toMatchObject({ deliveryCountry: 'US', source: 'default', isApproximate: true });
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('availability validates the country and caps the list', async () => {
    const s = request(app.getHttpServer());
    const ok = await s.post('/api/geo/availability').send({ country: 'DO', productIds: [PID] }).expect(201);
    expect(ok.headers['cache-control']).toContain('no-store');
    await s.post('/api/geo/availability').send({ country: 'D0', productIds: [PID] }).expect(400);
    await s.post('/api/geo/availability').send({ country: 'DO', productIds: ['nope'] }).expect(400);
    await s.post('/api/geo/availability').send({ country: 'DO', productIds: Array(101).fill(PID) }).expect(400);
  });

  it('guest cart is public; account cart, merge and seller rules require a session', async () => {
    const s = request(app.getHttpServer());
    await s.post('/api/cart/preview').send({ items: [{ variantId: PID, quantity: 1 }] }).expect(201);
    await s.post('/api/cart/preview').send({ items: Array(51).fill({ variantId: PID, quantity: 1 }) }).expect(400);
    await s.get('/api/cart').expect(401);
    await s.post('/api/cart/merge').send({ items: [] }).expect(401);
    await s.put('/api/seller/store/destinations').send({ mode: 'ALL' }).expect(401);
    await s.put(`/api/seller/products/${PID}/destinations`).send({ mode: 'ALL' }).expect(401);
    expect(cart.merge).not.toHaveBeenCalled();
  });
});
