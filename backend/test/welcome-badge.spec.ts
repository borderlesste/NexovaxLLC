jest.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => ({ payload: { sub: token } }),
}));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { AccountController } from '../src/account/account.controller';
import { AccountService } from '../src/account/account.service';
import { PoliciesService } from '../src/account/policies.service';
import { AlertsService } from '../src/analytics/alerts.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { AuthGuard } from '../src/auth/auth';
import { DbService } from '../src/db/db.service';
import { MailService } from '../src/mail/mail.service';
import { SettingsService } from '../src/settings/settings.service';
import { SupabaseAdminService } from '../src/storage/supabase-admin.service';

const owner = 'owner';
const other = 'other';
const endpoint = '/api/me/welcome-badge';
const fields = { publicName: 'Camila Rivera', zoom: 1.5, x: -0.2, y: 0.4 };
type Row = typeof fields & { photo: Buffer };

describe('private welcome badges over HTTP', () => {
  let app: INestApplication;
  let image: Buffer;
  let badgeStorageError: string | undefined;
  const statuses = new Map<string, string>();
  const badges = new Map<string, Row>();
  const db = {
    one: jest.fn(async (sql: string, params: [string, string, number, number, number, Buffer]) => {
      const [id, publicName, zoom, x, y, photo] = params;
      if (sql.includes('email_verified_at from public.users')) return { id, email: `${id}@example.com`, status: statuses.get(id), email_verified_at: 'now' };
      if (sql.includes('for no key update')) return statuses.get(id) === 'ACTIVE' ? { active: true } : null;
      if (badgeStorageError && sql.includes('public.nx_welcome_badges')) {
        throw Object.assign(new Error('Local fixture schema failure'), { code: badgeStorageError });
      }
      const row = badges.get(id);
      if (sql.includes('select b.photo')) return row ? { photo: row.photo } : null;
      if (sql.includes('insert into public.nx_welcome_badges') || (sql.includes('update public.nx_welcome_badges') && row)) {
        badges.set(id, { publicName, zoom, x, y, photo: photo ?? row!.photo });
        return { publicName, zoom, x, y };
      }
      if (sql.includes('update public.nx_welcome_badges') || !row) return null;
      return { publicName: row.publicName, zoom: row.zoom, x: row.x, y: row.y };
    }),
    many: async () => [],
    exec: async () => 1,
    tx: async (commit: (c: unknown) => unknown) => commit({}),
  };

  beforeAll(async () => {
    image = await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#124488' } }).jpeg().toBuffer();
    const mod = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        AccountService, SupabaseAdminService,
        { provide: DbService, useValue: db },
        ...[SettingsService, MailService, AnalyticsService, AlertsService, PoliciesService].map((provide) => ({ provide, useValue: {} })),
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
    await app.init();
  });
  beforeEach(() => {
    badgeStorageError = undefined;
    badges.clear();
    statuses.set(owner, 'ACTIVE');
    statuses.set(other, 'ACTIVE');
    db.one.mockClear();
  });
  afterAll(() => app.close());

  const get = (token: string, suffix = '') => request(app.getHttpServer()).get(`${endpoint}${suffix}`).set('Authorization', `Bearer ${token}`);
  const save = (token: string, values = fields) => {
    let req = request(app.getHttpServer()).post(endpoint).set('Authorization', `Bearer ${token}`);
    for (const [key, value] of Object.entries(values)) req = req.field(key, String(value));
    return req;
  };

  it('requires a signed-in owner for the metadata, photo and writes', async () => {
    await request(app.getHttpServer()).get(endpoint).expect(401);
    await request(app.getHttpServer()).get(`${endpoint}/photo`).expect(401);
    await request(app.getHttpServer()).post(endpoint).expect(401);
    const empty = await get(owner).expect(200).expect('Cache-Control', 'private, no-store');
    expect(empty.body).toBeNull();
    await save(owner).attach('file', image, 'member.jpg').expect(201);
    await get(other, '/photo').expect(404);
    expect((await get(other).expect(200)).body).toBeNull();
    statuses.set(owner, 'SUSPENDED');
    await get(owner, '/photo').expect(403);
    statuses.set(owner, 'CLOSED');
    await get(owner).expect(401);
  });

  it('saves a normalized photo and updates the badge name and crop independently of the profile', async () => {
    const created = await save(owner).attach('file', image, 'member.jpg').expect(201);
    expect(created.body).toEqual(fields);
    const photo = await get(owner, '/photo').expect(200).expect('Cache-Control', 'private, no-store').expect('Content-Type', /image\/webp/);
    const metadata = await sharp(photo.body).metadata();
    expect(metadata).toMatchObject({ width: 1280, height: 640, format: 'webp' });
    expect(metadata.exif).toBeUndefined();
    const edited = { ...fields, publicName: 'Camila R.', x: 1 };
    await save(owner, edited).expect(201);
    expect((await get(owner)).body).toEqual(edited);
    expect((await get(owner, '/photo')).body).toEqual(photo.body);
    const replacement = await sharp({ create: { width: 420, height: 650, channels: 3, background: '#aa5500' } }).png().toBuffer();
    await save(owner, edited).attach('file', replacement, 'replacement.png').expect(201);
    const replaced = await get(owner, '/photo').expect(200);
    expect(await sharp(replaced.body).metadata()).toMatchObject({ width: 420, height: 650, format: 'webp' });
    expect(db.one.mock.calls.some(([sql]) => sql.includes('public.user_profiles'))).toBe(false);
  });

  it.each(['42P01', '42501'])('handles unavailable storage (%s) and recovers once it is restored', async (code) => {
    badgeStorageError = code;
    const metadata = await get(owner).expect(503).expect('Cache-Control', 'private, no-store');
    expect(metadata.body).toMatchObject({ code: 'WELCOME_BADGE_STORAGE_UNAVAILABLE' });
    expect(metadata.text).not.toContain('Local fixture schema failure');
    expect((await get(owner, '/photo').expect(503)).body.code).toBe('WELCOME_BADGE_STORAGE_UNAVAILABLE');
    expect((await save(owner).attach('file', image, 'member.jpg').expect(503)).body.code).toBe('WELCOME_BADGE_STORAGE_UNAVAILABLE');
    expect(badges.size).toBe(0);

    badgeStorageError = undefined;
    expect((await get(owner).expect(200)).body).toBeNull();
    await save(owner).attach('file', image, 'member.jpg').expect(201);
  });

  it('rejects missing first photo, out-of-range crop values and non-image uploads', async () => {
    const missing = await save(owner).expect(400);
    expect(missing.body.code).toBe('WELCOME_BADGE_PHOTO_REQUIRED');
    await save(owner, { ...fields, zoom: 3.5 }).attach('file', image, 'member.jpg').expect(400);
    await save(owner, { ...fields, publicName: ' ' }).expect(400);
    await save(owner).attach('file', Buffer.from('invalid photo'), 'fake.jpg').expect(400);
    expect((await get(owner)).body).toBeNull();
  });
});
