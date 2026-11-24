jest.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: jest.fn(async (token: string) => ({ payload: { sub: token } })),
}));
import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthGuard, CurrentUser, RequestUser, RoleCode } from '../src/auth/auth';
import { config } from '../src/config';
import { DbService } from '../src/db/db.service';
import { MediaController } from '../src/media/media.controller';
import { SupabaseAdminService } from '../src/storage/supabase-admin.service';

@Controller('session')
class SessionController {
  @Get()
  get(@CurrentUser() user: RequestUser) { return { id: user.id }; }
}

const publicImage = '10000000-0000-4000-8000-000000000001';
const verificationDocument = '10000000-0000-4000-8000-000000000002';
const privateImage = '10000000-0000-4000-8000-000000000003';
const seller = '20000000-0000-4000-8000-000000000001';
const otherSeller = '20000000-0000-4000-8000-000000000002';
const assets: Record<string, {
  storage_bucket: string;
  storage_key: string;
  mime_type: string;
  visibility: string;
  owner_seller_id: string;
  status: string;
}> = {
  [publicImage]: { storage_bucket: config.mediaBucket, storage_key: 'catalog.webp', mime_type: 'image/webp', visibility: 'PUBLIC', owner_seller_id: seller, status: 'READY' },
  [verificationDocument]: { storage_bucket: config.documentsBucket, storage_key: 'verification.pdf', mime_type: 'application/pdf', visibility: 'PRIVATE', owner_seller_id: seller, status: 'READY' },
  [privateImage]: { storage_bucket: config.mediaBucket, storage_key: 'private.webp', mime_type: 'image/webp', visibility: 'PRIVATE', owner_seller_id: seller, status: 'READY' },
};

interface FixtureAccount {
  status: string;
  roles: RoleCode[];
  sellerId?: string;
  isOwner?: boolean;
}

describe('media download authorization over HTTP', () => {
  let app: INestApplication;
  const accounts = new Map<string, FixtureAccount>();
  const db = {
    one: jest.fn(async (sql: string, [id]: [string]) => {
      if (sql.includes('from public.assets')) return assets[id];
      const account = accounts.get(id);
      return account && { id, email: 'fixture@example.test', status: account.status, email_verified_at: '2026-01-01' };
    }),
    many: jest.fn(async (sql: string, [id]: [string]) => {
      const account = accounts.get(id)!;
      if (sql.includes('from public.user_roles')) return account.roles.map((code) => ({ code }));
      return account.sellerId ? [{ id: account.sellerId, slug: 'fixture-store', status: 'ACTIVE', is_owner: !!account.isOwner, areas: ['SETTINGS'] }] : [];
    }),
    exec: jest.fn(async () => 0),
  };
  const storage = { download: jest.fn(async () => Buffer.from('media fixture')) };

  function addAccount(overrides: Partial<FixtureAccount> = {}) {
    const token = randomUUID();
    const account: FixtureAccount = { status: 'ACTIVE', roles: ['CUSTOMER'], ...overrides };
    accounts.set(token, account);
    return { account, token };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MediaController, SessionController],
      providers: [
        { provide: DbService, useValue: db },
        { provide: SupabaseAdminService, useValue: storage },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => storage.download.mockClear());

  function download(asset: string, token?: string) {
    const req = request(app.getHttpServer()).get(`/api/media/${asset}`);
    return token ? req.auth(token, { type: 'bearer' }) : req;
  }

  it('serves a public image without a session and preserves public caching', async () => {
    await download(publicImage).expect(200).expect('Content-Type', 'image/webp').expect('Cache-Control', /public.*immutable/);
  });

  it('allows the active owner and authorized staff to download a verification document without caching it', async () => {
    const owner = addAccount({ sellerId: seller, isOwner: true });
    const staff = addAccount({ roles: ['SUPPORT'] });
    for (const { token } of [owner, staff]) {
      await download(verificationDocument, token).expect(200).expect('Content-Type', 'application/pdf').expect('Cache-Control', 'private, no-store');
    }
    expect(storage.download).toHaveBeenCalledTimes(2);
  });

  it('does not serve verification documents to anonymous users, other stores, or store team members', async () => {
    const foreignOwner = addAccount({ sellerId: otherSeller, isOwner: true });
    const teamMember = addAccount({ sellerId: seller });
    await download(verificationDocument).expect(403);
    await download(verificationDocument, foreignOwner.token).expect(403);
    await download(verificationDocument, teamMember.token).expect(403);
    expect(storage.download).not.toHaveBeenCalled();
    await download(privateImage, teamMember.token).expect(200).expect('Cache-Control', 'private, no-store');
  });

  it.each(['SUSPENDED', 'BLOCKED', 'CLOSED'])('denies %s accounts even with a valid token and a cached active profile', async (status) => {
    const owner = addAccount({ sellerId: seller, isOwner: true });
    const staff = addAccount({ roles: ['MODERATOR'] });
    for (const { account, token } of [owner, staff]) {
      await request(app.getHttpServer()).get('/api/session').auth(token, { type: 'bearer' }).expect(200);
      account.status = status;
      await download(verificationDocument, token).expect(403);
    }
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('checks the current permissions when an active account still has a cached grant', async () => {
    const { account, token } = addAccount({ roles: ['SUPPORT'] });
    await request(app.getHttpServer()).get('/api/session').auth(token, { type: 'bearer' }).expect(200);
    account.roles = ['CUSTOMER'];
    await download(verificationDocument, token).expect(403);
    expect(storage.download).not.toHaveBeenCalled();
  });
});
