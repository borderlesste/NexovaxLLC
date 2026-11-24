// PREORDER_TEST_POSTGRES=1 enables this suite. It creates its own local, disposable
// PostgreSQL container and exercises the migration and service through distinct pool connections.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { DbService } from '../src/db/db.service';
import { productHasPreorderSql } from '../src/preorders/preorders.sql';
import { PreordersService } from '../src/preorders/preorders.service';

const withPostgres = process.env.PREORDER_TEST_POSTGRES === '1' ? describe : describe.skip;
withPostgres('preorders in PostgreSQL', () => {
  jest.setTimeout(60_000);
  let container: string;
  let postgres: Pool;
  let runtime: Pool;
  let preorders: PreordersService;
  const owner = randomUUID(), seller = randomUUID(), product = randomUUID(), buyer = randomUUID(), other = randomUUID();
  const later = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

  async function variant() {
    const id = randomUUID();
    await postgres.query("insert into public.product_variants values ($1,$2,'Test','ACTIVE',false)", [id, product]);
    return id;
  }

  async function catalogShowsPreorder() {
    const row = await runtime.query(`select ${productHasPreorderSql('p')} as visible from public.products p where p.id = $1`, [product]);
    return row.rows[0].visible;
  }

  beforeAll(async () => {
    const password = randomUUID();
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', `POSTGRES_PASSWORD=${password}`,
      '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { encoding: 'utf8' }).trim();
    const port = Number(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split(':').pop());
    postgres = new Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' });
    for (let attempt = 0; ; attempt++) {
      try { await postgres.query('select 1'); break; } catch (err) {
        if (attempt >= 100) throw err;
        await delay(150);
      }
    }
    await postgres.query(`
      create role anon; create role authenticated; create role nexovax_api_runtime;
      create role fixture_api login password '${password}' in role nexovax_api_runtime;
      create table public.users (id uuid primary key);
      create table public.sellers (id uuid primary key, owner_user_id uuid, status text);
      create table public.products (id uuid primary key, seller_id uuid, title text, slug text, status text);
      create table public.product_variants (id uuid primary key, product_id uuid, title text, status text, is_default boolean);
      create table public.inventory_items (variant_id uuid, status text, on_hand int);
      grant select on all tables in schema public to nexovax_api_runtime;
    `);
    const migration = resolve(__dirname, '../../supabase/migrations/20261124110000_nexovax_preorders.sql');
    await postgres.query(readFileSync(migration, 'utf8'));
    await postgres.query('insert into public.users values ($1),($2),($3)', [owner, buyer, other]);
    await postgres.query("insert into public.sellers values ($1,$2,'ACTIVE')", [seller, owner]);
    await postgres.query("insert into public.products values ($1,$2,'Producto','producto','ACTIVE')", [product, seller]);
    runtime = new Pool({ host: '127.0.0.1', port, user: 'fixture_api', password, database: 'postgres' });
    const db = Object.assign(Object.create(DbService.prototype), { pool: runtime }) as DbService;
    preorders = new PreordersService(db);
  });
  afterAll(async () => {
    try { await Promise.all([runtime?.end(), postgres?.end()]); } finally {
      if (container) execFileSync('docker', ['rm', '-f', container]);
    }
  });

  it('serializes two buyers, makes retries idempotent and frees cancelled capacity', async () => {
    const vid = await variant();
    const offer = await preorders.configure(seller, product, vid, { arrivalAt: later(12), capacity: 1 });
    const buyers = [buyer, other];
    const results = await Promise.allSettled(buyers.map((id) => preorders.reserve(id, [], offer.offerId, 1)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.findIndex((r) => r.status === 'fulfilled'), loser = 1 - winner;
    expect(results[loser]).toMatchObject({ reason: { code: 'PREORDER_FULL' } });
    const reserved = (await preorders.reserve(buyers[winner], [], offer.offerId, 1))!;
    expect((await preorders.mine(buyers[winner])).items).toHaveLength(1);
    expect((await preorders.published(product)).items).toContainEqual(expect.objectContaining({ variantId: vid, remaining: 0 }));
    await expect(preorders.configure(seller, product, vid, { arrivalAt: later(24), capacity: 2 }))
      .rejects.toMatchObject({ code: 'PREORDER_ARRIVAL_PROMISED' });
    await expect(preorders.cancel(buyers[loser], reserved.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await preorders.cancel(buyers[winner], reserved.id);
    await expect(preorders.cancel(buyers[winner], reserved.id)).resolves.toEqual({ ok: true });
    await preorders.reserve(buyers[loser], [], offer.offerId, 1);
    const page = await preorders.sellerOffers(seller, product);
    expect(page.items[0]).toMatchObject({ reserved: 1, remaining: 0 });
    expect(page.items[0]).not.toHaveProperty('buyerId');
    await preorders.close(seller, product, vid);
  });

  it('limits the arrival window and disallows stocked, unpublished and cross-store reservations', async () => {
    const vid = await variant();
    await expect(preorders.configure(seller, product, vid, { arrivalAt: later(121), capacity: 3 }))
      .rejects.toMatchObject({ code: 'PREORDER_ARRIVAL_INVALID' });
    await expect(preorders.configure(seller, product, vid, { arrivalAt: later(-1), capacity: 3 }))
      .rejects.toMatchObject({ code: 'PREORDER_ARRIVAL_INVALID' });
    await expect(preorders.configure(randomUUID(), product, vid, { arrivalAt: later(2), capacity: 3 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await postgres.query("update public.products set status = 'DRAFT' where id = $1", [product]);
    const offer = await preorders.configure(seller, product, vid, { arrivalAt: later(119.99), capacity: 3 });
    expect((await preorders.published(product)).items).toEqual([]);
    await expect(preorders.reserve(buyer, [], offer.offerId, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await postgres.query("update public.products set status = 'OUT_OF_STOCK' where id = $1", [product]);
    expect(await catalogShowsPreorder()).toBe(true);
    await expect(preorders.reserve(buyer, [seller], offer.offerId, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const r = (await preorders.reserve(buyer, [], offer.offerId, 2))!;
    await postgres.query("update public.products set title = 'Under review', status = 'PENDING_REVIEW' where id = $1", [product]);
    expect((await preorders.published(product)).items).toEqual([]);
    await expect(preorders.reserve(other, [], offer.offerId, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await preorders.mine(buyer)).items.find((i) => i.id === r.id)).toMatchObject({ status: 'RESERVED', productTitle: 'Producto' });
    await postgres.query("update public.products set status = 'ACTIVE' where id = $1", [product]);
    expect((await preorders.published(product)).items.find((i) => i.offerId === offer.offerId)?.remaining).toBe(1);
    expect((await preorders.sellerOffers(seller, product)).items.find((i) => i.offerId === offer.offerId)?.maxArrivalAt)
      .toEqual(offer.arrivalAt);
    await expect(preorders.configure(seller, product, vid, { arrivalAt: offer.arrivalAt.toISOString(), capacity: 1 }))
      .rejects.toMatchObject({ code: 'PREORDER_CAPACITY_RESERVED' });
    await postgres.query("insert into public.inventory_items values ($1,'ACTIVE',0)", [vid]);
    await postgres.query('update public.inventory_items set on_hand = 1 where variant_id = $1', [vid]);
    expect((await preorders.mine(buyer)).items.find((i) => i.id === r.id)?.status).toBe('IN_STOCK');
    expect(await catalogShowsPreorder()).toBe(false);
    await expect(preorders.cancel(buyer, r.id)).rejects.toMatchObject({ code: 'PREORDER_CLOSED' });
    await expect(preorders.configure(seller, product, vid, { arrivalAt: later(6), capacity: 3 }))
      .rejects.toMatchObject({ code: 'PREORDER_IN_STOCK' });
    await postgres.query('update public.inventory_items set on_hand = 0 where variant_id = $1', [vid]);
    await expect(preorders.reserve(other, [], offer.offerId, 1)).rejects.toMatchObject({ code: 'PREORDER_CLOSED' });
    expect((await preorders.mine(buyer)).items.find((i) => i.id === r.id)?.status).toBe('IN_STOCK');
  });

  it('serializes setup with the first physical receipt in either commit order', async () => {
    const waitForBlocked = async () => {
      for (let i = 0; i < 100; i++) {
        const { rows } = await postgres.query("select 1 from pg_locks where locktype = 'advisory' and not granted");
        if (rows.length) return;
        await delay(20);
      }
      throw new Error('Expected the competing transaction to wait for the variant lock');
    };
    const stockFirst = await variant();
    const setupFirst = await variant();
    const holder = await postgres.connect();
    try {
      await holder.query('begin');
      await holder.query("insert into public.inventory_items values ($1,'ACTIVE',1)", [stockFirst]);
      const setup = preorders.configure(seller, product, stockFirst, { arrivalAt: later(4), capacity: 3 });
      const rejected = expect(setup).rejects.toMatchObject({ code: 'PREORDER_IN_STOCK' });
      await waitForBlocked();
      await holder.query('commit');
      await rejected;

      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(hashtextextended($1::uuid::text, 20261124))', [setupFirst]);
      const stock = postgres.query("insert into public.inventory_items values ($1,'ACTIVE',1)", [setupFirst]);
      await waitForBlocked();
      await holder.query(`insert into public.nx_preorder_offers (variant_id, arrival_at, capacity)
        values ($1, now() + interval '1 day', 2)`, [setupFirst]);
      await holder.query('commit');
      await stock;
      const offers = (await preorders.sellerOffers(seller, product)).items;
      expect(offers.find((o) => o.variantId === stockFirst)).toBeUndefined();
      expect(offers.find((o) => o.variantId === setupFirst)?.status).toBe('IN_STOCK');
    } finally {
      await holder.query('rollback');
      holder.release();
    }
  });

  it.each([
    ['product_variants', 'ARCHIVED'], ['products', 'PAUSED'], ['products', 'REJECTED'], ['sellers', 'SUSPENDED'],
  ])('closes existing reservations when %s leaves the storefront', async (table, hidden) => {
    const vid = await variant(), id = table === 'products' ? product : table === 'sellers' ? seller : vid;
    const offer = await preorders.configure(seller, product, vid, { arrivalAt: later(8), capacity: 2 });
    const reservation = (await preorders.reserve(buyer, [], offer.offerId, 1))!;
    if (hidden === 'REJECTED') await postgres.query("update public.products set status = 'PENDING_REVIEW' where id = $1", [product]);
    await postgres.query(`update public.${table} set status = $2 where id = $1`, [id, hidden]);
    await postgres.query(`update public.${table} set status = 'ACTIVE' where id = $1`, [id]);
    expect((await preorders.mine(buyer)).items.find((i) => i.id === reservation.id)?.status).toBe('CLOSED');
    await expect(preorders.reserve(buyer, [], offer.offerId, 1)).rejects.toMatchObject({ code: 'PREORDER_CLOSED' });
  });

  it('preserves the history of expired and manually closed offers across a new campaign', async () => {
    const vid = await variant();
    const a = await preorders.configure(seller, product, vid, { arrivalAt: later(2), capacity: 3 });
    const r1 = (await preorders.reserve(buyer, [], a.offerId, 1))!;
    await postgres.query("update public.nx_preorder_offers set created_at = now()-interval '2 hours', arrival_at=now()-interval '1 hour' where id=$1", [a.offerId]);
    expect((await preorders.published(product)).items.find((i) => i.offerId === a.offerId)).toBeUndefined();
    await expect(preorders.reserve(other, [], a.offerId, 1)).rejects.toMatchObject({ code: 'PREORDER_CLOSED' });
    const b = await preorders.configure(seller, product, vid, { arrivalAt: later(3), capacity: 2 });
    expect(b.offerId).not.toBe(a.offerId);
    const r2 = (await preorders.reserve(buyer, [], b.offerId, 2))!;
    await preorders.close(seller, product, vid);
    const items = (await preorders.mine(buyer)).items;
    expect(items.find((i) => i.id === r1.id)?.status).toBe('EXPIRED');
    expect(items.find((i) => i.id === r2.id)?.status).toBe('CLOSED');
    await expect(preorders.reserve(buyer, [], a.offerId, 1)).rejects.toMatchObject({ code: 'PREORDER_CLOSED' });
  });
});
