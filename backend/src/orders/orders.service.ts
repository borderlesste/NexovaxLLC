import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { mediaUrl } from '../catalog/catalog.sql';

export type OrderScope = { kind: 'customer'; userId: string } | { kind: 'seller'; sellerId: string } | { kind: 'admin' };

export const CARRIERS = [
  { code: 'RD_EXPRESS', name: 'RD Express' },
  { code: 'VIMENCA', name: 'Vimenca Courier' },
  { code: 'CPS', name: 'CPS Courier' },
  { code: 'DHL', name: 'DHL Express' },
  { code: 'FEDEX', name: 'FedEx' },
  { code: 'OWN_DELIVERY', name: 'Entrega propia del vendedor' },
  { code: 'PICKUP', name: 'Retiro en tienda' },
];

const TRACKING_LABELS: Record<string, string> = {
  PRE_TRANSIT: 'Guía generada',
  IN_TRANSIT: 'En tránsito',
  OUT_FOR_DELIVERY: 'Salió a entrega',
  DELIVERED: 'Entregado',
  EXCEPTION: 'Incidencia en el envío',
  FAILURE: 'Entrega fallida',
  RETURNED: 'Devuelto al remitente',
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  constructor(private readonly db: DbService) {}

  // ------------------------------------------------------------------ listings
  async list(scope: OrderScope, q: { status?: string; search?: string; page?: number; pageSize?: number; from?: string; to?: string; sellerId?: string }) {
    const params: unknown[] = [];
    const add = (v: unknown) => (params.push(v), `$${params.length}`);
    const where: string[] = [];
    if (scope.kind === 'customer') where.push(`o.customer_id = ${add(scope.userId)}`);
    if (scope.kind === 'seller') where.push(`so.seller_id = ${add(scope.sellerId)}`);
    if (scope.kind === 'admin' && q.sellerId) where.push(`so.seller_id = ${add(q.sellerId)}`);
    if (q.status) where.push(statusFilter(q.status, add));
    if (q.search?.trim()) {
      const t = add(`%${q.search.trim().replace(/^#?RD-?/i, '')}%`);
      where.push(`(o.public_number::text ilike ${t} or coalesce(up.display_name, u.email::text) ilike ${t} or coalesce(ssp.display_name, s.slug) ilike ${t})`);
    }
    if (q.from) where.push(`o.placed_at >= ${add(q.from)}`);
    if (q.to) where.push(`o.placed_at < ${add(q.to)}`);
    const pageSize = Math.min(Math.max(q.pageSize ?? 20, 1), 100);
    const page = Math.max(q.page ?? 1, 1);
    // One row per seller order (customer view groups them back by order).
    const rows = await this.db.many(
      `select so.id as seller_order_id, so.public_number as seller_order_number, so.lifecycle_status, so.fulfillment_status,
              o.id as order_id, o.public_number as order_number, o.placed_at, o.payment_status, o.lifecycle_status as order_lifecycle,
              o.fulfillment_status as order_fulfillment, o.currency_code, o.customer_id,
              coalesce(up.display_name, nullif(trim(coalesce(up.first_name,'') || ' ' || coalesce(up.last_name,'')),''), u.email::text) as customer_name,
              u.email::text as customer_email,
              s.id as seller_id, s.slug as seller_slug, coalesce(ssp.display_name, s.slug) as seller_name,
              sofs.customer_total::text as total, sofs.product_net_amount::text as subtotal, sofs.shipping_amount::text as shipping,
              sofs.tax_amount::text as tax, sofs.platform_commission_total::text as commission,
              sofs.seller_entitlement_estimate::text as seller_net,
              (select count(*) from public.order_items oi where oi.seller_order_id = so.id)::int as item_lines,
              (select coalesce(sum(oi.quantity),0) from public.order_items oi where oi.seller_order_id = so.id)::int as units,
              (select ois.product_title from public.order_items oi join public.order_item_snapshots ois on ois.order_item_id = oi.id
                 where oi.seller_order_id = so.id order by oi.created_at limit 1) as first_title,
              (select pm.asset_id from public.order_items oi join public.product_media pm on pm.product_id = oi.product_id
                 where oi.seller_order_id = so.id order by pm.is_primary desc, pm.sort_order limit 1) as image_id,
              count(*) over() as total_count
         from public.seller_orders so
         join public.orders o on o.id = so.order_id
         join public.users u on u.id = o.customer_id
         left join public.user_profiles up on up.user_id = u.id
         join public.sellers s on s.id = so.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
        ${where.length ? 'where ' + where.join(' and ') : ''}
        order by o.placed_at desc, so.id
        limit ${pageSize} offset ${(page - 1) * pageSize}`,
      params,
    );
    return {
      items: rows.map((r: any) => ({
        sellerOrderId: r.seller_order_id,
        sellerOrderNumber: `V-${r.seller_order_number}`,
        orderId: r.order_id,
        orderNumber: `RD-${r.order_number}`,
        placedAt: r.placed_at,
        status: displayStatus(r),
        paymentStatus: r.payment_status,
        fulfillmentStatus: r.fulfillment_status,
        currency: r.currency_code,
        customer: { id: r.customer_id, name: r.customer_name, email: scope.kind === 'customer' ? r.customer_email : maskEmail(r.customer_email, scope.kind) },
        seller: { id: r.seller_id, slug: r.seller_slug, name: r.seller_name },
        total: r.total,
        subtotal: r.subtotal,
        shipping: r.shipping,
        tax: r.tax,
        commission: scope.kind === 'customer' ? undefined : r.commission,
        sellerNet: scope.kind === 'customer' ? undefined : r.seller_net,
        itemLines: r.item_lines,
        units: r.units,
        firstTitle: r.first_title,
        imageUrl: r.image_id ? mediaUrl(r.image_id) : null,
      })),
      total: rows[0] ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
    };
  }

  async statusCounts(scope: OrderScope) {
    const params: unknown[] = [];
    let where = '';
    if (scope.kind === 'seller') {
      params.push(scope.sellerId);
      where = 'where so.seller_id = $1';
    }
    if (scope.kind === 'customer') {
      params.push(scope.userId);
      where = 'where o.customer_id = $1';
    }
    const r = await this.db.one(
      `select count(*)::int as total,
              count(*) filter (where o.payment_status = 'PENDING')::int as pending_payment,
              count(*) filter (where so.fulfillment_status = 'UNFULFILLED' and so.lifecycle_status not in ('CANCELLED','CLOSED'))::int as to_prepare,
              count(*) filter (where so.fulfillment_status in ('FULFILLED','PARTIALLY_FULFILLED'))::int as preparing,
              count(*) filter (where so.fulfillment_status in ('SHIPPED','PARTIALLY_SHIPPED','PARTIALLY_DELIVERED'))::int as shipped,
              count(*) filter (where so.fulfillment_status = 'DELIVERED')::int as delivered,
              count(*) filter (where so.lifecycle_status = 'CANCELLED')::int as cancelled
         from public.seller_orders so join public.orders o on o.id = so.order_id ${where}`,
      params,
    );
    return r;
  }

  // ------------------------------------------------------------------ detail
  async detail(scope: OrderScope, orderId: string) {
    const o = await this.db.one(
      `select o.*, o.public_number::text as number, ofs.grand_total::text as grand_total, ofs.product_net_amount::text as subtotal,
              ofs.shipping_total::text as shipping_total, ofs.tax_total::text as tax_total,
              ofs.platform_commission_total::text as commission_total,
              coalesce(up.display_name, u.email::text) as customer_name, u.email::text as customer_email, up.phone as customer_phone,
              public.order_display_status(o.id) as display_status
         from public.orders o
         join public.users u on u.id = o.customer_id
         left join public.user_profiles up on up.user_id = u.id
         left join public.order_financial_snapshots ofs on ofs.order_id = o.id
        where o.id = $1 or o.public_number::text = $1`,
      [orderId.replace(/^RD-/i, '')],
    );
    if (!o) throw notFound('Pedido');
    if (scope.kind === 'customer' && o.customer_id !== scope.userId) throw notFound('Pedido');
    const sellerFilter = scope.kind === 'seller' ? scope.sellerId : null;
    if (sellerFilter) {
      const own = await this.db.one(`select 1 from public.seller_orders where order_id = $1 and seller_id = $2`, [o.id, sellerFilter]);
      if (!own) throw notFound('Pedido');
    }
    const [address, sellerOrders, items, shipments, payment] = await Promise.all([
      this.db.one(`select * from public.order_address_snapshots where order_id = $1 and address_type = 'SHIPPING'`, [o.id]),
      this.db.many(
        `select so.id, so.public_number, so.seller_id, so.lifecycle_status, so.fulfillment_status, s.slug, coalesce(ssp.display_name, s.slug) as name,
                ssp.support_phone, sofs.customer_total::text as total, sofs.product_net_amount::text as subtotal, sofs.shipping_amount::text as shipping,
                sofs.tax_amount::text as tax, sofs.platform_commission_total::text as commission, sofs.seller_entitlement_estimate::text as seller_net,
                osg.id as shipping_group_id, osg.service_name, osg.carrier_name, osg.service_token, osg.customer_shipping_amount::text as shipping_amount,
                osg.estimated_days
           from public.seller_orders so join public.sellers s on s.id = so.seller_id
           left join public.seller_store_profiles ssp on ssp.seller_id = s.id
           left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
           left join lateral (select * from public.order_shipping_groups g where g.seller_order_id = so.id order by g.created_at limit 1) osg on true
          where so.order_id = $1 and ($2::uuid is null or so.seller_id = $2)
          order by so.created_at`,
        [o.id, sellerFilter],
      ),
      this.db.many(
        `select oi.id, oi.seller_order_id, oi.product_id, oi.variant_id, oi.quantity::int as quantity,
                oi.fulfilled_quantity::int as fulfilled, oi.shipped_quantity::int as shipped, oi.delivered_quantity::int as delivered,
                ois.product_title, ois.variant_title, ois.sku, ois.variant_attributes, p.slug,
                oifs.unit_price::text as unit_price, oifs.product_net_amount::text as line_total, oifs.tax_amount::text as tax,
                (select pm.asset_id from public.product_media pm where pm.product_id = oi.product_id order by pm.is_primary desc, pm.sort_order limit 1) as image_id,
                exists (select 1 from public.product_reviews r where r.order_item_id = oi.id) as reviewed
           from public.order_items oi
           left join public.order_item_snapshots ois on ois.order_item_id = oi.id
           left join public.order_item_financial_snapshots oifs on oifs.order_item_id = oi.id
           left join public.products p on p.id = oi.product_id
          where oi.order_id = $1 and ($2::uuid is null or oi.seller_id = $2)
          order by oi.created_at`,
        [o.id, sellerFilter],
      ),
      this.db.many(
        `select sh.id, sh.public_number, sh.seller_order_id, sh.status, sh.shipped_at, sh.delivered_at, sh.actual_carrier_name,
                st.id as tracking_id, st.tracking_number, st.tracking_url, st.carrier_code, st.current_status,
                coalesce((select json_agg(json_build_object('status', te.normalized_status, 'at', te.event_at, 'detail', te.status_detail,
                                                            'city', te.location_city) order by te.event_at)
                            from public.tracking_events te where te.tracking_id = st.id), '[]') as events
           from public.shipments sh left join public.shipment_trackings st on st.shipment_id = sh.id
          where sh.order_id = $1 and ($2::uuid is null or sh.seller_id = $2) and sh.status <> 'CANCELLED'
          order by sh.created_at`,
        [o.id, sellerFilter],
      ),
      this.db.one(
        `select p.public_number, p.status, p.provider_code, p.captured_amount::text as captured, p.paid_at,
                (select pi.sanitized_metadata from public.payment_provider_intents pi where pi.payment_id = p.id order by pi.created_at desc limit 1) as meta
           from public.payments p where p.order_id = $1 order by p.created_at desc limit 1`,
        [o.id],
      ),
    ]);

    const timeline = this.buildTimeline(o, shipments);
    return {
      id: o.id,
      number: `RD-${o.number}`,
      placedAt: o.placed_at,
      paidAt: o.paid_at,
      status: o.display_status,
      lifecycleStatus: o.lifecycle_status,
      paymentStatus: o.payment_status,
      fulfillmentStatus: o.fulfillment_status,
      currency: o.currency_code,
      totals: { subtotal: o.subtotal, shipping: o.shipping_total, tax: o.tax_total, total: o.grand_total, commission: scope.kind === 'customer' ? undefined : o.commission_total },
      customer: { id: o.customer_id, name: o.customer_name, email: scope.kind === 'customer' ? o.customer_email : maskEmail(o.customer_email, scope.kind), phone: o.customer_phone },
      shippingAddress: address
        ? { recipientName: address.recipient_name, line1: address.line1, line2: address.line2, city: address.city, region: address.region, countryCode: address.country_code, phone: address.phone }
        : null,
      payment: payment
        ? { number: `PAY-${payment.public_number}`, status: payment.status, method: payment.meta?.method ?? 'CARD', brand: payment.meta?.brand, last4: payment.meta?.last4, paidAt: payment.paid_at }
        : null,
      sellerOrders: sellerOrders.map((so: any) => ({
        id: so.id,
        number: `V-${so.public_number}`,
        seller: { id: so.seller_id, slug: so.slug, name: so.name, phone: so.support_phone },
        lifecycleStatus: so.lifecycle_status,
        fulfillmentStatus: so.fulfillment_status,
        totals: { subtotal: so.subtotal, shipping: so.shipping, tax: so.tax, total: so.total, commission: scope.kind === 'customer' ? undefined : so.commission, sellerNet: scope.kind === 'customer' ? undefined : so.seller_net },
        shippingMethod: { name: so.service_name, carrier: so.carrier_name, code: so.service_token, amount: so.shipping_amount, estimatedDays: so.estimated_days },
        items: items
          .filter((i: any) => i.seller_order_id === so.id)
          .map((i: any) => ({
            id: i.id,
            productId: i.product_id,
            slug: i.slug,
            title: i.product_title,
            variantTitle: i.variant_title,
            sku: i.sku,
            attributes: i.variant_attributes,
            quantity: i.quantity,
            fulfilled: i.fulfilled,
            shipped: i.shipped,
            delivered: i.delivered,
            unitPrice: i.unit_price,
            lineTotal: i.line_total,
            imageUrl: i.image_id ? mediaUrl(i.image_id) : null,
            reviewed: i.reviewed,
          })),
        shipments: shipments
          .filter((s: any) => s.seller_order_id === so.id)
          .map((s: any) => ({
            id: s.id,
            number: `ENV-${s.public_number}`,
            status: s.status,
            carrier: s.actual_carrier_name,
            trackingNumber: s.tracking_number,
            trackingUrl: s.tracking_url,
            trackingStatus: s.current_status,
            shippedAt: s.shipped_at,
            deliveredAt: s.delivered_at,
            events: (s.events ?? []).map((e: any) => ({ ...e, label: TRACKING_LABELS[e.status] ?? e.status })),
          })),
      })),
      timeline,
    };
  }

  private buildTimeline(o: any, shipments: any[]) {
    const steps = [
      { code: 'CONFIRMED', label: 'Pedido confirmado', at: o.paid_at },
      { code: 'PREPARING', label: 'Preparando', at: null as any },
      { code: 'SHIPPED', label: 'Enviado', at: shipments.find((s) => s.shipped_at)?.shipped_at ?? null },
      { code: 'OUT_FOR_DELIVERY', label: 'En ruta', at: null as any },
      { code: 'DELIVERED', label: 'Entregado', at: shipments.length && shipments.every((s) => s.delivered_at) ? shipments[shipments.length - 1].delivered_at : null },
    ];
    const fs = o.fulfillment_status;
    if (['FULFILLED', 'PARTIALLY_FULFILLED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_DELIVERED', 'DELIVERED'].includes(fs)) steps[1].at = steps[1].at ?? o.updated_at;
    const out = shipments.flatMap((s) => s.events ?? []).find((e: any) => e.status === 'OUT_FOR_DELIVERY');
    if (out) steps[3].at = out.at;
    if (steps[4].at && !steps[3].at) steps[3].at = steps[4].at;
    let current = 0;
    steps.forEach((s, i) => s.at && (current = i));
    return { steps: steps.map((s, i) => ({ ...s, done: !!s.at || i < current })), current: steps[current].code };
  }

  // ------------------------------------------------------------------ fulfillment (seller)
  private async sellerOrderFor(sellerId: string, sellerOrderId: string, c: PoolClient) {
    const so = await this.db.one(
      `select so.*, o.lifecycle_status as order_lifecycle from public.seller_orders so join public.orders o on o.id = so.order_id
        where so.id = $1 for update of so`,
      [sellerOrderId],
      c,
    );
    if (!so || so.seller_id !== sellerId) throw notFound('Pedido');
    if (['CANCELLED', 'CLOSED'].includes(so.lifecycle_status)) throw conflict('ORDER_CLOSED', 'El pedido está cerrado o cancelado.');
    return so;
  }

  /** Creates and confirms a fulfillment for all remaining quantities ("Preparar pedido"). */
  async prepare(sellerId: string, sellerOrderId: string, actorUserId: string) {
    await this.db.tx(async (c) => {
      const so = await this.sellerOrderFor(sellerId, sellerOrderId, c);
      const groups = await this.db.many(`select id from public.order_shipping_groups where seller_order_id = $1`, [so.id], c);
      let created = 0;
      for (const g of groups) {
        const remaining = await this.db.many(
          `select oi.id, (oi.quantity - oi.cancelled_quantity
                    - coalesce((select sum(fi.quantity) from public.fulfillment_items fi join public.fulfillments f on f.id = fi.fulfillment_id
                                 where fi.order_item_id = oi.id and f.status <> 'CANCELLED'), 0))::int as qty
             from public.order_items oi
             join public.order_shipping_group_items gi on gi.order_item_id = oi.id and gi.order_shipping_group_id = $1`,
          [g.id],
          c,
        );
        const todo = remaining.filter((r: any) => r.qty > 0);
        if (!todo.length) continue;
        const f = await this.db.one(
          `insert into public.fulfillments (order_id, seller_order_id, seller_id, order_shipping_group_id, status, created_by_user_id, correlation_id)
           values ($1,$2,$3,$4,'DRAFT',$5,$6) returning id`,
          [so.order_id, so.id, sellerId, g.id, actorUserId, randomUUID()],
          c,
        );
        for (const r of todo)
          await this.db.exec(`insert into public.fulfillment_items (fulfillment_id, order_item_id, quantity) values ($1,$2,$3)`, [f!.id, r.id, r.qty], c);
        await this.db.exec(`select public.confirm_fulfillment($1)`, [f!.id], c);
        created++;
      }
      if (!created) throw conflict('NOTHING_TO_PREPARE', 'Este pedido ya fue preparado.');
      await this.db.exec(
        `update public.seller_orders set lifecycle_status = 'PROCESSING', processing_started_at = coalesce(processing_started_at, now())
          where id = $1 and lifecycle_status = 'NEW'`,
        [so.id],
        c,
      ).catch(() => undefined);
    });
    return { ok: true };
  }

  /** Packs ready fulfillments into a shipment, registers tracking and dispatches it. */
  async ship(sellerId: string, sellerOrderId: string, actorUserId: string, input: { carrierCode: string; trackingNumber?: string; trackingUrl?: string }) {
    const carrier = CARRIERS.find((x) => x.code === input.carrierCode);
    if (!carrier) throw badRequest('CARRIER_INVALID', 'Selecciona una transportadora válida.');
    await this.db.tx(async (c) => {
      const so = await this.sellerOrderFor(sellerId, sellerOrderId, c);
      const fulfillments = await this.db.many(
        `select f.id, f.order_shipping_group_id from public.fulfillments f
          where f.seller_order_id = $1 and f.status in ('READY','PARTIALLY_PACKED')
            and not exists (select 1 from public.shipments s where s.fulfillment_id = f.id and s.status <> 'CANCELLED')`,
        [so.id],
        c,
      );
      if (!fulfillments.length) throw conflict('NOTHING_TO_SHIP', 'Primero marca el pedido como "En preparación".');
      const to = await this.db.one(`select * from public.order_address_snapshots where order_id = $1 and address_type = 'SHIPPING'`, [so.order_id], c);
      const customer = await this.db.one(`select u.email::text as email from public.orders o join public.users u on u.id = o.customer_id where o.id = $1`, [so.order_id], c);
      for (const f of fulfillments) {
        const g = await this.db.one(`select * from public.order_shipping_groups where id = $1`, [f.order_shipping_group_id], c);
        const from = await this.db.one(`select * from public.seller_ship_from_addresses where id = $1`, [g.ship_from_address_id], c);
        const sh = await this.db.one(
          `insert into public.shipments (fulfillment_id, seller_order_id, order_id, seller_id, order_shipping_group_id, shipping_provider_code,
                   requested_carrier_code, requested_service_token, requested_service_name, actual_carrier_code, actual_carrier_name,
                   actual_service_token, actual_service_name, correlation_id)
           values ($1,$2,$3,$4,$5,'RD_LOCAL',$6,$7,$8,$9,$10,$7,$8,$11) returning id`,
          [f.id, so.id, so.order_id, sellerId, g.id, g.carrier_code, g.service_token, g.service_name, carrier.code, carrier.name, randomUUID()],
          c,
        );
        const shipmentId = sh!.id;
        await this.db.exec(
          `insert into public.shipment_address_snapshots (shipment_id, address_type, recipient_name, company_name, line1, line2, city, region, postal_code, country_code, phone)
           values ($1,'FROM',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [shipmentId, from.contact_name, from.company_name, from.line1, from.line2, from.city, from.region, from.postal_code, from.country_code, from.phone],
          c,
        );
        await this.db.exec(
          `insert into public.shipment_address_snapshots (shipment_id, address_type, recipient_name, company_name, line1, line2, city, region, postal_code, country_code, phone, email)
           values ($1,'TO',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [shipmentId, to.recipient_name, to.company_name, to.line1, to.line2, to.city, to.region, to.postal_code, to.country_code, to.phone, customer?.email],
          c,
        );
        const pkgSrc = await this.db.one(
          `select cp.* from public.checkout_packages cp join public.checkout_package_plans pp on pp.id = cp.package_plan_id
            where pp.fulfillment_group_id = $1 and pp.status = 'READY' order by cp.package_sequence limit 1`,
          [g.source_checkout_fulfillment_group_id],
          c,
        );
        const pkg = await this.db.one(
          `insert into public.shipment_packages (shipment_id, package_sequence, weight_value, weight_unit, length_value, width_value, height_value,
                   dimension_unit, declared_value_amount, declared_value_currency)
           values ($1,1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [shipmentId, pkgSrc?.weight_value ?? 1, pkgSrc?.weight_unit ?? 'kg', pkgSrc?.length_value ?? 30, pkgSrc?.width_value ?? 20,
           pkgSrc?.height_value ?? 10, pkgSrc?.dimension_unit ?? 'cm', pkgSrc?.declared_value_amount ?? null, pkgSrc?.declared_value_currency ?? null],
          c,
        );
        const fitems = await this.db.many(`select order_item_id, quantity from public.fulfillment_items where fulfillment_id = $1`, [f.id], c);
        for (const fi of fitems)
          await this.db.exec(
            `insert into public.shipment_package_items (shipment_package_id, shipment_id, order_item_id, quantity) values ($1,$2,$3,$4)`,
            [pkg!.id, shipmentId, fi.order_item_id, fi.quantity],
            c,
          );
        await this.db.exec(`select public.mark_shipment_ready($1)`, [shipmentId], c);
        const tracking = input.trackingNumber?.trim() || `RD-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`;
        await this.db.exec(
          `select public.register_external_tracking($1,'RD_LOCAL',$2,$3,$4,'EXTERNAL_MANUAL')`,
          [shipmentId, carrier.code, tracking, input.trackingUrl?.trim() || null],
          c,
        );
        await this.db.exec(`select public.dispatch_shipment($1)`, [shipmentId], c);
        const tr = await this.db.one(`select id from public.shipment_trackings where shipment_id = $1 order by created_at desc limit 1`, [shipmentId], c);
        await this.trackingEvent(c, tr!.id, 'IN_TRANSIT', `El vendedor despachó el paquete con ${carrier.name}.`, from.city);
      }
    });
    return { ok: true };
  }

  /** Seller/admin updates the delivery progress of a shipment (manual carrier tracking). */
  async updateTracking(scope: OrderScope, shipmentId: string, status: 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'EXCEPTION', detail?: string, city?: string) {
    await this.db.tx(async (c) => {
      const s = await this.db.one(
        `select sh.id, sh.seller_id, sh.order_id, st.id as tracking_id from public.shipments sh
           join public.shipment_trackings st on st.shipment_id = sh.id where sh.id = $1 order by st.created_at desc limit 1`,
        [shipmentId],
        c,
      );
      if (!s) throw notFound('Envío');
      if (scope.kind === 'seller' && s.seller_id !== scope.sellerId) throw notFound('Envío');
      if (scope.kind === 'customer') {
        const own = await this.db.one(`select 1 from public.orders where id = $1 and customer_id = $2`, [s.order_id, scope.userId], c);
        if (!own || status !== 'DELIVERED') throw forbidden();
      }
      const labels: Record<string, string> = {
        IN_TRANSIT: 'El paquete está en tránsito.',
        OUT_FOR_DELIVERY: 'El paquete salió a entrega.',
        DELIVERED: scope.kind === 'customer' ? 'El cliente confirmó la recepción del pedido.' : 'El paquete fue entregado.',
        EXCEPTION: 'Se registró una incidencia en el envío.',
      };
      await this.trackingEvent(c, s.tracking_id, status, detail?.trim() || labels[status], city);
      if (status === 'DELIVERED') await this.releaseDeliveredFunds(c, s.order_id);
    });
    return { ok: true };
  }

  private async trackingEvent(c: PoolClient, trackingId: string, status: string, detail: string, city?: string | null) {
    await this.db.exec(
      `select public.apply_tracking_event($1,$2,$3,now(),$4,null,$5,$6,null,null,'DO',null,null,$7::jsonb)`,
      [trackingId, `manual:${trackingId}:${status}:${Date.now()}`, status, status.toLowerCase(), detail, city ?? null, JSON.stringify({ source: 'manual' })],
      c,
    );
  }

  /** On delivery, evaluates payout policy and releases seller funds from pending to available. */
  private async releaseDeliveredFunds(c: PoolClient, orderId: string) {
    const sos = await this.db.many(
      `select id from public.seller_orders where order_id = $1 and fulfillment_status = 'DELIVERED'`,
      [orderId],
      c,
    );
    for (const so of sos) {
      try {
        await this.db.exec('savepoint payout_release', [], c);
        const rec = await this.db.one(`select public.ensure_payout_eligibility_record($1, $2, now()) as id`, [so.id, randomUUID()], c);
        const st = await this.db.one(`select public.evaluate_payout_eligibility($1, now()) as s`, [rec!.id], c);
        if (st?.s === 'ELIGIBLE') await this.db.exec(`select public.release_eligible_seller_order_funds($1, null, $2, now())`, [rec!.id, randomUUID()], c);
        await this.db.exec('release savepoint payout_release', [], c);
      } catch (e: any) {
        await this.db.exec('rollback to savepoint payout_release', [], c);
        this.logger.warn(`Payout release deferred for seller order ${so.id}: ${e.message}`);
      }
    }
  }

  /** Retries fund release for delivered seller orders still pending (idempotent). */
  async retryPendingReleases() {
    const rows = await this.db.many(
      `select distinct so.order_id from public.seller_orders so
        where so.fulfillment_status = 'DELIVERED'
          and not exists (select 1 from public.payout_eligibility_records per where per.seller_order_id = so.id and per.status = 'RELEASED')
        limit 50`,
    );
    for (const r of rows) await this.db.tx((c) => this.releaseDeliveredFunds(c, r.order_id)).catch(() => undefined);
    return rows.length;
  }
}

function statusFilter(status: string, add: (v: unknown) => string) {
  switch (status) {
    case 'PENDING_PAYMENT':
      return `o.payment_status = 'PENDING'`;
    case 'PAID':
    case 'TO_PREPARE':
      return `so.fulfillment_status = 'UNFULFILLED' and so.lifecycle_status not in ('CANCELLED','CLOSED')`;
    case 'PREPARING':
      return `so.fulfillment_status in ('FULFILLED','PARTIALLY_FULFILLED')`;
    case 'SHIPPED':
      return `so.fulfillment_status in ('SHIPPED','PARTIALLY_SHIPPED','PARTIALLY_DELIVERED')`;
    case 'DELIVERED':
      return `so.fulfillment_status = 'DELIVERED'`;
    case 'CANCELLED':
      return `so.lifecycle_status = 'CANCELLED'`;
    default:
      return `so.lifecycle_status = ${add(status)}`;
  }
}

function displayStatus(r: any) {
  if (r.lifecycle_status === 'CANCELLED') return 'CANCELLED';
  if (r.payment_status === 'PENDING') return 'PENDING_PAYMENT';
  switch (r.fulfillment_status) {
    case 'UNFULFILLED':
      return 'PAID';
    case 'PARTIALLY_FULFILLED':
    case 'FULFILLED':
      return 'PREPARING';
    case 'PARTIALLY_SHIPPED':
    case 'SHIPPED':
    case 'PARTIALLY_DELIVERED':
      return 'SHIPPED';
    case 'DELIVERED':
      return 'DELIVERED';
    default:
      return r.fulfillment_status;
  }
}

function maskEmail(email: string, kind: string) {
  if (kind === 'admin' || !email) return email;
  const [u, d] = email.split('@');
  return `${u.slice(0, 3)}***@${d}`;
}
