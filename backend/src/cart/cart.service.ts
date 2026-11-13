import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService, Queryable } from '../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { fromMinor, toMinor } from '../common/money';
import { mediaUrl } from '../catalog/catalog.sql';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class CartService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Returns the customer's mutable cart, creating one if needed. A cart left
   * in CHECKOUT_IN_PROGRESS by an abandoned checkout is reopened by cancelling
   * that checkout (which releases its inventory reservations).
   */
  async ensureMutableCart(userId: string, c: PoolClient): Promise<{ id: string; currency_code: string }> {
    const currency = await this.settings.currency(c);
    const cart = await this.db.one(
      `select id, status, currency_code from public.carts
        where customer_id = $1 and status in ('ACTIVE','CHECKOUT_IN_PROGRESS')
        order by updated_at desc limit 1 for update`,
      [userId],
      c,
    );
    if (cart?.status === 'CHECKOUT_IN_PROGRESS') {
      const open = await this.db.many(
        `select id, status from public.checkout_sessions
          where cart_id = $1 and status in ('OPEN','PRICING_VALIDATED','SHIPPING_REQUIRED','READY_FOR_PAYMENT')`,
        [cart.id],
        c,
      );
      const pending = await this.db.one(
        `select 1 from public.checkout_sessions where cart_id = $1 and status = 'PAYMENT_PENDING'`,
        [cart.id],
        c,
      );
      if (pending)
        throw conflict('CHECKOUT_PAYMENT_PENDING', 'Tienes un pago en proceso. Complétalo o espera su confirmación antes de modificar el carrito.');
      for (const s of open) {
        await this.db.exec(`select public.cancel_checkout_session($1, $2, 'CUSTOMER_EDITED_CART', null)`, [s.id, userId], c);
      }
      if (!open.length)
        await this.db.exec(`update public.carts set status = 'ACTIVE', version = version + 1 where id = $1`, [cart.id], c);
      return { id: cart.id, currency_code: cart.currency_code };
    }
    if (cart && cart.currency_code === currency) return cart;
    if (cart) {
      // The marketplace currency changed: carts priced in the old currency are retired.
      await this.db.exec(
        `update public.carts set status = 'ABANDONED', abandoned_at = now(), version = version + 1 where id = $1 and status = 'ACTIVE'`,
        [cart.id],
        c,
      );
    }
    return (await this.db.one(
      `insert into public.carts (customer_id, currency_code, status) values ($1, $2, 'ACTIVE') returning id, currency_code`,
      [userId, currency],
      c,
    ))!;
  }

  async getCart(userId: string, client?: Queryable) {
    const cart = await this.db.one(
      `select id, status, currency_code from public.carts
        where customer_id = $1 and status in ('ACTIVE','CHECKOUT_IN_PROGRESS') order by updated_at desc limit 1`,
      [userId],
      client,
    );
    const marketplaceCurrency = await this.settings.currency();
    const currency = cart?.currency_code ?? marketplaceCurrency;
    if (!cart || (cart.status === 'ACTIVE' && cart.currency_code !== marketplaceCurrency)) return emptyCart(marketplaceCurrency);
    const rows = await this.db.many(
      `select ci.id, ci.quantity::int as quantity, ci.variant_id, ci.product_id, ci.seller_id,
              p.title, p.slug, p.status as product_status, v.sku, v.title as variant_title, v.status as variant_status,
              s.slug as seller_slug, coalesce(ssp.display_name, s.slug) as seller_name, s.status as seller_status,
              ap.amount as unit_price, ap.compare_at_amount,
              coalesce((select sum(ii.available_to_sell) from public.inventory_items ii where ii.variant_id = v.id and ii.status='ACTIVE'),0)::int as stock,
              (select pm.asset_id from public.product_media pm where pm.product_id = p.id
                 order by (pm.variant_id = v.id) desc nulls last, pm.is_primary desc, pm.sort_order limit 1) as image_id,
              coalesce((select json_object_agg(po.name, pov.label order by po.sort_order)
                          from public.variant_option_assignments voa
                          join public.product_option_values pov on pov.id = voa.option_value_id
                          join public.product_options po on po.id = voa.option_id
                         where voa.variant_id = v.id), '{}') as attributes
         from public.cart_items ci
         join public.products p on p.id = ci.product_id
         join public.product_variants v on v.id = ci.variant_id
         join public.sellers s on s.id = ci.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join lateral (
           select vpv.amount, vpv.compare_at_amount from public.variant_price_versions vpv
            where vpv.variant_id = v.id and vpv.currency_code = $2 and vpv.status = 'ACTIVE'
              and vpv.effective_from <= now() and (vpv.effective_to is null or vpv.effective_to > now())
            order by vpv.effective_from desc limit 1) ap on true
        where ci.cart_id = $1 and ci.status = 'ACTIVE'
        order by ci.created_at`,
      [cart.id, currency],
      client,
    );
    const groups = new Map<string, any>();
    let subtotal = 0n;
    let count = 0;
    for (const r of rows) {
      const purchasable =
        r.product_status === 'ACTIVE' && r.variant_status === 'ACTIVE' && r.seller_status === 'ACTIVE' && r.unit_price != null;
      const line = toMinor(r.unit_price ?? 0) * BigInt(r.quantity);
      if (purchasable) {
        subtotal += line;
        count += r.quantity;
      }
      if (!groups.has(r.seller_id))
        groups.set(r.seller_id, { sellerId: r.seller_id, sellerSlug: r.seller_slug, sellerName: r.seller_name, items: [] });
      groups.get(r.seller_id).items.push({
        id: r.id,
        productId: r.product_id,
        variantId: r.variant_id,
        slug: r.slug,
        title: r.title,
        variantTitle: r.variant_title,
        sku: r.sku,
        attributes: r.attributes,
        quantity: r.quantity,
        unitPrice: r.unit_price,
        compareAtPrice: r.compare_at_amount,
        lineTotal: fromMinor(line),
        stock: r.stock,
        imageUrl: r.image_id ? mediaUrl(r.image_id) : null,
        purchasable,
        issue: !purchasable ? 'Este producto ya no está disponible.' : r.quantity > r.stock ? `Solo quedan ${r.stock} unidades.` : null,
      });
    }
    return {
      id: cart.id,
      status: cart.status,
      currency,
      groups: [...groups.values()],
      itemCount: count,
      subtotal: fromMinor(subtotal),
    };
  }

  async addItem(userId: string, variantId: string, quantity: number, mode: 'add' | 'set' = 'add') {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
      throw badRequest('INVALID_QUANTITY', 'Cantidad inválida.');
    await this.payments.releaseAbandoned(userId);
    await this.db.tx(async (c) => {
      const cart = await this.ensureMutableCart(userId, c);
      const existing = await this.db.one(
        `select quantity::int as quantity from public.cart_items where cart_id = $1 and variant_id = $2 and status = 'ACTIVE'`,
        [cart.id, variantId],
        c,
      );
      const target = mode === 'add' ? (existing?.quantity ?? 0) + quantity : quantity;
      const stock = await this.db.one(
        `select coalesce(sum(available_to_sell),0)::int as s, count(*)::int as n from public.inventory_items where variant_id = $1 and status = 'ACTIVE'`,
        [variantId],
        c,
      );
      if (stock && stock.n > 0 && target > stock.s)
        throw conflict('INSUFFICIENT_INVENTORY', stock.s > 0 ? `Solo hay ${stock.s} unidades disponibles.` : 'Producto agotado.');
      await this.db.exec(`select public.add_or_update_cart_item($1, $2, $3, $4, $2, $5)`, [cart.id, userId, variantId, target, randomUUID()], c);
    });
    return this.getCart(userId);
  }

  async updateItem(userId: string, itemId: string, quantity: number) {
    const item = await this.db.one(
      `select ci.variant_id from public.cart_items ci join public.carts c on c.id = ci.cart_id
        where ci.id = $1 and c.customer_id = $2 and ci.status = 'ACTIVE'`,
      [itemId, userId],
    );
    if (!item) throw notFound('Artículo del carrito');
    return this.addItem(userId, item.variant_id, quantity, 'set');
  }

  async removeItem(userId: string, itemId: string) {
    await this.payments.releaseAbandoned(userId);
    await this.db.tx(async (c) => {
      await this.ensureMutableCart(userId, c);
      const item = await this.db.one(
        `select ci.id from public.cart_items ci join public.carts c on c.id = ci.cart_id
          where ci.id = $1 and c.customer_id = $2 and ci.status = 'ACTIVE'`,
        [itemId, userId],
        c,
      );
      if (!item) throw notFound('Artículo del carrito');
      await this.db.exec(`select public.remove_cart_item($1, $2, $2, $3)`, [itemId, userId, randomUUID()], c);
    });
    return this.getCart(userId);
  }

  async clear(userId: string) {
    await this.payments.releaseAbandoned(userId);
    await this.db.tx(async (c) => {
      const cart = await this.ensureMutableCart(userId, c);
      const items = await this.db.many(`select id from public.cart_items where cart_id = $1 and status = 'ACTIVE'`, [cart.id], c);
      for (const i of items) await this.db.exec(`select public.remove_cart_item($1, $2, $2, null)`, [i.id, userId], c);
    });
    return this.getCart(userId);
  }
}

function emptyCart(currency: string) {
  return { id: null, status: 'ACTIVE', currency, groups: [], itemCount: 0, subtotal: '0.00' };
}
