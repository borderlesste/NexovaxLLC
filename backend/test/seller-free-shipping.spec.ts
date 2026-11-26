jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
jest.mock('../src/orders/orders.service', () => ({ OrdersService: class OrdersService {} }));
jest.mock('../src/shipping/shipping.service', () => ({ CARRIERS: [] }));
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../src/auth/auth';
import { DbService } from '../src/db/db.service';
import { SellerController } from '../src/seller/seller.controller';
import { SellerService } from '../src/seller/seller.service';
import { AvailabilityService } from '../src/geo/availability';
import { OrdersService } from '../src/orders/orders.service';
import { AlertsService } from '../src/analytics/alerts.service';

describe('seller free shipping settings over HTTP', () => {
  let app: INestApplication;
  let currency = 'USD';
  let stored: any;
  const path = '/seller/store/free-shipping';
  const sellerId = '10000000-0000-4000-8000-000000000001';
  const userId = '20000000-0000-4000-8000-000000000001';
  const fixture = { enabled: true, countries: ['do', 'US', 'DO'], minimumSubtotal: '19.95' };
  const db = {
    one: async (sql: string, args: any[]) => {
      if (sql.includes('insert into public.nx_seller_free_shipping')) {
        stored = { enabled: args[1], country_codes: args[2], minimum_subtotal: args[3], currency_code: args[4] };
      }
      return stored;
    },
    many: async (_sql: string, [codes]: [string[]]) => ['US', 'DO'].filter((cc) => codes.includes(cc)).map((alpha2) => ({ alpha2 })),
  };
  const put = (body: object, role = 'owner') => request(app.getHttpServer()).put(path).set('x-fixture-role', role).send(body);
  const get = () => request(app.getHttpServer()).get(path).set('x-fixture-role', 'owner');
  beforeAll(async () => {
    const service = new SellerService(db as any, { currency: async () => currency } as any, {} as any, {} as any, {} as any);
    const module = await Test.createTestingModule({
      controllers: [SellerController], providers: [
        { provide: SellerService, useValue: service }, { provide: DbService, useValue: db }, { provide: APP_GUARD, useClass: AuthGuard },
        ...[OrdersService, AlertsService, AvailabilityService].map((provide) => ({ provide, useValue: {} })),
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      const role = req.headers['x-fixture-role'];
      if (role) req.user = { id: userId, status: 'ACTIVE', roles: [], sellers: [
        { id: sellerId, status: 'ACTIVE', isOwner: role === 'owner', areas: role === 'staff' ? ['SETTINGS'] : ['ORDERS'] },
      ] };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => { stored = null; currency = 'USD'; });

  it('requires an authenticated seller with permission to manage this store', async () => {
    const http = request(app.getHttpServer());
    await http.get(path).expect(401);
    await http.get(path).set('x-fixture-role', 'warehouse').expect(403);
    await put(fixture, 'warehouse').expect(403);
    await http.put(path).set('x-fixture-role', 'owner').set('x-seller-id', userId).send(fixture).expect(403);
    await put(fixture, 'staff').expect(200);
  });

  it('defaults off and round-trips countries, an optional exact threshold and explicit opt-out', async () => {
    expect((await get().expect(200)).body).toEqual({ enabled: false, countries: [], minimumSubtotal: null, currency: 'USD' });
    const policy = { enabled: true, countries: ['DO', 'US'], minimumSubtotal: '19.95', currency: 'USD' };
    expect((await put(fixture).expect(200)).body).toEqual(policy);
    expect((await get().expect(200)).body).toEqual(policy);
    expect((await put({ enabled: false, countries: [], minimumSubtotal: null }).expect(200)).body.enabled).toBe(false);
    expect((await put({ ...fixture, minimumSubtotal: null }).expect(200)).body.minimumSubtotal).toBeNull();
  });

  it('rejects unsupported countries and malformed or negative thresholds', async () => {
    for (const override of [{ countries: [] }, { countries: ['ZZ'] }, { countries: ['USA'] }, { minimumSubtotal: '1.239' },
      { minimumSubtotal: '-1.00' }, { minimumSubtotal: '1e2' }, { minimumSubtotal: '10000000000000000' }, { enabled: 'true' }]) {
      await put({ ...fixture, ...override }).expect(400);
    }
  });

  it('pauses the old-currency policy and rejects stale writes until the seller saves in the new currency', async () => {
    await put(fixture).expect(200);
    currency = 'CAD';
    expect((await get().expect(200)).body).toMatchObject({
      enabled: false, countries: ['DO', 'US'], minimumSubtotal: null, currency: 'CAD', previousCurrency: 'USD', previousMinimumSubtotal: '19.95',
    });
    await put({ ...fixture, expectedCurrency: 'USD' }).expect(409);
    expect((await put({ ...fixture, expectedCurrency: 'CAD', minimumSubtotal: '25.50' }).expect(200)).body).toEqual({
      enabled: true, countries: ['DO', 'US'], minimumSubtotal: '25.50', currency: 'CAD',
    });
  });
});
