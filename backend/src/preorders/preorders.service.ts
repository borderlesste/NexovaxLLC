import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AppError, badRequest, conflict, forbidden, notFound } from '../common/errors';
import { DbService } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { openPreorderSql, variantHasPhysicalStockSql } from './preorders.sql';

const visible = `p.status in ('ACTIVE','OUT_OF_STOCK') and v.status = 'ACTIVE' and s.status = 'ACTIVE'`;
const hasStock = variantHasPhysicalStockSql('v');
const effectiveStatus = `case when o.status = 'OPEN' and o.arrival_at <= statement_timestamp()
                              then 'EXPIRED' else o.status end`;
const reservedUnits = `(select coalesce(sum(r.quantity),0)::int from public.nx_preorder_reservations r
                         where r.offer_id = o.id and r.cancelled_at is null)`;
const offerColumns = `o.id as "offerId", o.variant_id as "variantId", o.arrival_at as "arrivalAt", o.capacity,
                      o.created_at as created, ${reservedUnits} as reserved, ${effectiveStatus} as status`;
const variants = `join public.product_variants v on v.id = o.variant_id
                  join public.products p on p.id = v.product_id join public.sellers s on s.id = p.seller_id`;
const buyerRows = `select r.id, o.id as "offerId", v.id as "variantId", p.id as "productId",
                         case when ${visible} then p.title else r.product_title end as "productTitle",
                         case when ${visible} then p.slug else r.product_slug end as "productSlug",
                         case when ${visible} then v.title else r.variant_title end as "variantTitle",
                         r.quantity, o.arrival_at as "arrivalAt",
                         case when r.cancelled_at is not null then 'CANCELLED'
                              when (${effectiveStatus}) = 'OPEN' then 'RESERVED'
                              else ${effectiveStatus} end as status
                    from public.nx_preorder_reservations r join public.nx_preorder_offers o on o.id = r.offer_id
                    ${variants}`;

type Offer = {
  offerId: string; variantId: string; arrivalAt: Date; created: Date; capacity: number; reserved: number;
  status: 'OPEN' | 'IN_STOCK' | 'EXPIRED' | 'CLOSED';
};

const windowMs = 120 * 60 * 60 * 1000;

function sellerItem({ created, ...o }: Offer) {
  const maxArrivalAt = o.reserved > 0 ? o.arrivalAt : new Date(created.getTime() + windowMs);
  return { ...o, maxArrivalAt, remaining: o.status === 'OPEN' ? o.capacity - o.reserved : 0 };
}

function validUnits(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000)
    throw badRequest('PREORDER_QUANTITY_INVALID', 'Indica una cantidad entera entre 1 y 1.000.000.');
}

@Injectable()
export class PreordersService {
  constructor(private readonly db: DbService, private readonly mail: MailService) {}

  // The stock receipt trigger takes the same lock. Always fetch mutable facts in a
  // new statement after acquiring it so concurrent commits are visible at READ COMMITTED.
  private async lock(c: PoolClient, variantId: string) {
    await this.db.one('select pg_advisory_xact_lock(hashtextextended($1::uuid::text, 20261124))', [variantId], c);
  }

  async published(productId: string) {
    const rows = await this.db.many<Offer>(
      `select ${offerColumns} from public.nx_preorder_offers o ${variants}
        where p.id = $1 and ${visible} and ${openPreorderSql('o')}
          and not ${hasStock} order by v.is_default desc, v.id`, [productId],
    );
    return { items: rows.map(({ offerId, variantId, arrivalAt, capacity, reserved }) =>
      ({ offerId, variantId, arrivalAt, capacity, remaining: capacity - reserved })) };
  }

  async sellerOffers(sellerId: string, productId: string) {
    if (!(await this.db.one('select 1 from public.products where id = $1 and seller_id = $2', [productId, sellerId])))
      throw notFound('Producto');
    const rows = await this.db.many<Offer>(
      `select distinct on (v.id) ${offerColumns} from public.nx_preorder_offers o ${variants}
        where p.id = $1 and p.seller_id = $2 and v.status <> 'ARCHIVED'
        order by v.id, o.created_at desc, o.id desc`, [productId, sellerId],
    );
    return { items: rows.map(sellerItem) };
  }

  private async sellerVariant(c: PoolClient, sellerId: string, productId: string, variantId: string) {
    await this.lock(c, variantId);
    const row = await this.db.one<{ stocked: boolean; editable: boolean; clock: Date }>(
      `select ${hasStock} as stocked, statement_timestamp() as clock,
              (s.status not in ('SUSPENDED','CLOSED','REJECTED') and p.status not in ('SUSPENDED','ARCHIVED')
                  and v.status = 'ACTIVE') as editable
         from public.product_variants v join public.products p on p.id = v.product_id
         join public.sellers s on s.id = p.seller_id where v.id = $1 and p.id = $2 and s.id = $3`,
      [variantId, productId, sellerId], c,
    );
    if (!row) throw notFound('Variante');
    if (!row.editable) throw forbidden('Esta tienda o variante no admite cambios de preorden.');
    return row;
  }

  async configure(sellerId: string, productId: string, variantId: string, input: { arrivalAt: string; capacity: number }) {
    validUnits(input.capacity);
    const arrival = new Date(input.arrivalAt);
    if (!Number.isFinite(arrival.getTime()) || !/(Z|[+-]\d{2}:\d{2})$/i.test(input.arrivalAt))
      throw badRequest('PREORDER_ARRIVAL_INVALID', 'Indica una fecha de llegada con zona horaria.');
    return this.db.tx(async (c) => {
      const { stocked, clock } = await this.sellerVariant(c, sellerId, productId, variantId);
      if (stocked) throw conflict('PREORDER_IN_STOCK', 'La variante ya tiene existencias.');
      await this.db.exec(
        `update public.nx_preorder_offers set status = 'EXPIRED'
          where variant_id = $1 and status = 'OPEN' and arrival_at <= statement_timestamp()`, [variantId], c,
      );
      const offer = await this.db.one<Offer>(
        `select ${offerColumns} from public.nx_preorder_offers o
          where o.variant_id = $1 and o.status = 'OPEN'`, [variantId], c,
      );
      const start = offer?.created ?? clock;
      if (arrival <= clock || arrival.getTime() > start.getTime() + windowMs)
        throw badRequest('PREORDER_ARRIVAL_INVALID', 'La llegada debe ser futura y dentro de los cinco días desde la apertura.');
      if (offer && input.capacity < offer.reserved)
        throw conflict('PREORDER_CAPACITY_RESERVED', 'La cantidad prevista debe cubrir las unidades reservadas.');
      if (offer && offer.reserved > 0 && arrival > offer.arrivalAt)
        throw conflict('PREORDER_ARRIVAL_PROMISED', 'Ya hay reservas para la fecha de llegada indicada.');
      const row = offer
        ? await this.db.one(`update public.nx_preorder_offers set arrival_at = $2, capacity = $3 where id = $1 returning id`,
          [offer.offerId, arrival, input.capacity], c)
        : await this.db.one(`insert into public.nx_preorder_offers (variant_id, arrival_at, capacity, created_at)
                             values ($1,$2,$3,$4) returning id`, [variantId, arrival, input.capacity, clock], c);
      const saved = await this.db.one<Offer>(`select ${offerColumns} from public.nx_preorder_offers o where o.id = $1`, [row!.id], c);
      return sellerItem(saved!);
    });
  }

  async close(sellerId: string, productId: string, variantId: string) {
    return this.db.tx(async (c) => {
      await this.sellerVariant(c, sellerId, productId, variantId);
      await this.db.exec(
        `update public.nx_preorder_offers set status = case when arrival_at <= statement_timestamp() then 'EXPIRED' else 'CLOSED' end
          where variant_id = $1 and status = 'OPEN'`, [variantId], c,
      );
      return { ok: true };
    });
  }

  async mine(buyerId: string) {
    return { items: await this.db.many(`${buyerRows} where r.buyer_id = $1 order by r.created_at desc, r.id`, [buyerId]) };
  }

  async reserve(buyerId: string, sellerIds: string[], offerId: string, quantity: number) {
    validUnits(quantity);
    const saved = await this.db.tx(async (c) => {
      const offer = await this.db.one('select variant_id from public.nx_preorder_offers where id = $1', [offerId], c);
      if (!offer) throw new AppError('NOT_FOUND', 'Preorden no encontrada.', 404);
      await this.lock(c, offer.variant_id);
      const row = await this.db.one(
        `select ${offerColumns}, ${hasStock} as stocked, r.quantity as previous, s.owner_user_id as owner, s.id as seller, p.id as "productId"
           from public.nx_preorder_offers o ${variants}
           left join public.nx_preorder_reservations r on r.offer_id = o.id and r.buyer_id = $2 and r.cancelled_at is null
          where o.id = $1 and ${visible}`, [offerId, buyerId], c,
      );
      if (!row) throw new AppError('NOT_FOUND', 'Preorden no encontrada.', 404);
      if (row.owner === buyerId || sellerIds.includes(row.seller)) throw forbidden('No puedes reservar productos de tu propia tienda.');
      if (row.status !== 'OPEN' || row.stocked) throw conflict('PREORDER_CLOSED', 'Esta preorden ya terminó.');
      if (quantity > row.capacity - row.reserved + (row.previous ?? 0))
        throw conflict('PREORDER_FULL', 'Ya no quedan suficientes unidades para esta reserva.');
      const reservation = await this.db.one(
        `insert into public.nx_preorder_reservations (offer_id, buyer_id, quantity, product_title, product_slug, variant_title)
         select o.id, $2, $3, p.title, p.slug, v.title from public.nx_preorder_offers o ${variants}
          where o.id = $1 and ${visible} and ${openPreorderSql('o')}
         on conflict (offer_id, buyer_id) do update set quantity = excluded.quantity, cancelled_at = null,
           product_title = excluded.product_title, product_slug = excluded.product_slug, variant_title = excluded.variant_title
         returning id`, [offerId, buyerId, quantity], c,
      );
      if (!reservation) throw conflict('PREORDER_CLOSED', 'Esta preorden ya terminó.');
      // The buyer is told when the inventory arrives (and there is stock) by the back-in-stock alerts job.
      await this.db.exec(
        `insert into public.nx_product_alerts (user_id, product_id, variant_id, created_at) values ($1,$2,$3,clock_timestamp())
         on conflict (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'ACTIVE' do nothing`,
        [buyerId, row.productId, row.variantId], c,
      );
      return this.db.one(`${buyerRows} where r.id = $1`, [reservation.id], c);
    });
    // After the commit: the store hears about the reservation (e-mail + bell); never breaks the reservation.
    this.mail.fire(() => this.mail.preorderReserved(saved.id, `preorder-reserved:${saved.id}:${saved.quantity}:${Date.now()}`));
    return saved;
  }

  async cancel(buyerId: string, id: string) {
    return this.db.tx(async (c) => {
      const row = await this.db.one(
        `select o.variant_id from public.nx_preorder_reservations r join public.nx_preorder_offers o on o.id = r.offer_id
          where r.id = $1 and r.buyer_id = $2`, [id, buyerId], c,
      );
      if (!row) throw new AppError('NOT_FOUND', 'Reserva no encontrada.', 404);
      await this.lock(c, row.variant_id);
      const changed = await this.db.exec(
        `update public.nx_preorder_reservations r set cancelled_at = clock_timestamp() from public.nx_preorder_offers o
          where r.offer_id = o.id and r.id = $1 and r.buyer_id = $2 and r.cancelled_at is null
            and ${openPreorderSql('o')}`, [id, buyerId], c,
      );
      if (!changed) {
        const alreadyCancelled = await this.db.one('select 1 from public.nx_preorder_reservations where id = $1 and buyer_id = $2 and cancelled_at is not null', [id, buyerId], c);
        if (!alreadyCancelled) throw conflict('PREORDER_CLOSED', 'Esta preorden ya terminó.');
      }
      // No "available" notice for a reservation the buyer withdrew.
      await this.db.exec(
        `update public.nx_product_alerts a set status = 'CANCELLED' from public.nx_preorder_reservations r
          where r.id = $1 and a.user_id = $2 and a.variant_id = $3 and a.status = 'ACTIVE' and a.created_at >= r.created_at`,
        [id, buyerId, row.variant_id], c,
      );
      return { ok: true };
    });
  }
}
