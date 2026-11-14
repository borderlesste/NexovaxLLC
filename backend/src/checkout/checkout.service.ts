import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { TaxService } from '../tax/tax.service';
import { Parcel, ShippingService } from '../shipping/shipping.service';
import { CartService } from '../cart/cart.service';
import { AppError, badRequest, conflict, notFound } from '../common/errors';
import { allocate, applyRate, fromMinor, Minor, toMinor } from '../common/money';
import { config } from '../config';
import { postSaleAllocation } from './sale-ledger';
import { orderRef, paymentRef } from '../common/refs';
import { ONLINE_PAYMENT_TTL_MIN, PaymentsService } from '../payments/payments.service';
import { MailService } from '../mail/mail.service';

const ENGINE = 'nx-checkout-2.0';
const SANDBOX_PROVIDER = 'RD_SANDBOX';
const TRANSFER_TTL_MIN = 60 * 72; // bank transfers may take up to 72 h to confirm

export type PaymentMethod = 'CARD' | 'PAYPAL' | 'BANK_TRANSFER';

export interface PlaceOrderInput {
  addressId: string;
  shipping: Record<string, string>; // sellerId -> rate code
  paymentMethod: PaymentMethod;
  card?: { number: string; expMonth: number; expYear: number; cvc: string; name: string };
  idempotencyKey: string;
}

interface LineCalc {
  key: string; // variant id (preview) or checkout item id
  sellerId: string;
  quantity: number;
  unit: Minor;
  gross: Minor;
  discount: Minor;
  net: Minor;
  tax: Minor;
  commission: Minor;
  commissionRaw: string;
  entitlement: Minor;
}

interface CommissionRule {
  groupId: string;
  versionId: string;
  scopeType: string;
  conditions: any;
  type: string;
  baseCode: string;
  rate: string | null;
  fixedAmount: string | null;
  fixedCurrency: string | null;
  minimum: string | null;
  maximum: string | null;
  limitCurrency: string | null;
  rounding: string;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly carts: CartService,
    private readonly mail: MailService,
    private readonly tax: TaxService,
    private readonly shipping: ShippingService,
    private readonly payments: PaymentsService,
  ) {}

  // ------------------------------------------------------------------ pricing
  private async commissionRule(c: PoolClient | undefined, sellerId: string, categoryId: string, productId: string, variantId: string): Promise<CommissionRule | null> {
    const r = await this.db.one(
      `select cand.rule_group_id, cand.rule_version_id, cand.scope_type_code, cand.conditions,
              d.calculation_type, d.calculation_base_code, d.percentage_rate::text as rate, d.fixed_amount::text as fixed_amount,
              d.fixed_currency_code, d.minimum_amount::text as minimum_amount, d.maximum_amount::text as maximum_amount,
              d.limit_currency_code, d.rounding_mode
         from public.get_business_rule_candidates('PLATFORM_COMMISSION', $1, $2, $3, $4, now()) cand
         join public.commission_rule_definitions d on d.rule_version_id = cand.rule_version_id
        where d.calculation_base_code in ('PRODUCT_GROSS','PRODUCT_AFTER_DISCOUNT')
        order by cand.specificity_rank desc, cand.priority desc, cand.effective_from desc
        limit 1`,
      [sellerId, categoryId, productId, variantId],
      c,
    );
    if (!r) return null;
    return {
      groupId: r.rule_group_id,
      versionId: r.rule_version_id,
      scopeType: r.scope_type_code,
      conditions: r.conditions,
      type: r.calculation_type,
      baseCode: r.calculation_base_code,
      rate: r.rate,
      fixedAmount: r.fixed_amount,
      fixedCurrency: r.fixed_currency_code,
      minimum: r.minimum_amount,
      maximum: r.maximum_amount,
      limitCurrency: r.limit_currency_code,
      rounding: r.rounding_mode,
    };
  }

  private computeCommission(rule: CommissionRule | null, gross: Minor, net: Minor) {
    if (!rule) return { amount: 0n, raw: '0', base: net };
    const base = rule.baseCode === 'PRODUCT_GROSS' ? gross : net;
    let raw: string;
    let amount: Minor;
    if (rule.type === 'PERCENTAGE') {
      // raw = base * rate with full precision (as decimal string)
      const [i, f = ''] = rule.rate!.split('.');
      const scale = 10n ** BigInt(f.length);
      const rateScaled = BigInt(i || '0') * scale + BigInt(f || '0');
      const rawScaled = base * rateScaled; // in minor * scale
      raw = decimalString(rawScaled, 2 + f.length);
      amount = applyRate(base, rule.rate!);
    } else {
      amount = toMinor(rule.fixedAmount);
      raw = fromMinor(amount);
    }
    let bounded = amount;
    if (rule.minimum != null && bounded < toMinor(rule.minimum)) bounded = toMinor(rule.minimum);
    if (rule.maximum != null && bounded > toMinor(rule.maximum)) bounded = toMinor(rule.maximum);
    if (bounded > net) bounded = net;
    return { amount: bounded, raw, base };
  }

  /** Default (or chosen) shipping address of the buyer, or null. */
  private async buyerAddress(userId: string, addressId?: string | null, c?: PoolClient) {
    return this.db.one(
      `select * from public.addresses where user_id = $1 and deleted_at is null and ($2::uuid is null or id = $2)
        order by (id = $2) desc nulls last, is_default_shipping desc, created_at limit 1`,
      [userId, addressId ?? null],
      c,
    );
  }

  /** Shipping options for every seller group of the current cart (also used to validate the order). */
  private async groupOptions(cartId: string, groups: any[], address: any, currency: string) {
    const dims = await this.db.many(
      `select ci.seller_id, ci.variant_id, ci.quantity::int as qty, v.weight_value, v.weight_unit, v.length_value, v.width_value, v.height_value, v.dimension_unit
         from public.cart_items ci join public.product_variants v on v.id = ci.variant_id
        where ci.cart_id = $1 and ci.status = 'ACTIVE'`,
      [cartId],
    );
    const out = new Map<string, Awaited<ReturnType<ShippingService['options']>> & { parcel: Parcel }>();
    await Promise.all(
      groups.map(async (g: any) => {
        const purchasable = new Set(g.items.filter((i: any) => i.purchasable).map((i: any) => i.variantId));
        const parcel = ShippingService.parcelFor(dims.filter((d: any) => d.seller_id === g.sellerId && purchasable.has(d.variant_id)));
        const origin = await this.shipping.originFor(g.sellerId);
        const res = await this.shipping.options(origin, address, parcel, currency);
        out.set(g.sellerId, { ...res, parcel });
      }),
    );
    return out;
  }

  /** Price preview from the current cart (no writes). Used by the checkout screen. */
  async quote(userId: string, input: { addressId?: string; shipping?: Record<string, string> }) {
    const cart = await this.carts.getCart(userId);
    if (!cart.groups.length) throw conflict('CART_EMPTY', 'Tu carrito está vacío.');
    const address = await this.buyerAddress(userId, input.addressId);
    const tax = await this.tax.forCountry(address?.country_code);
    const optionsBySeller = await this.groupOptions(cart.id, cart.groups, address, cart.currency);
    const groups = [];
    const totals = { subtotal: 0n, shipping: 0n, tax: 0n };
    for (const g of cart.groups) {
      const items = g.items.filter((i: any) => i.purchasable);
      let subtotal = 0n;
      let taxAmount = 0n;
      for (const i of items) {
        const net = toMinor(i.unitPrice) * BigInt(i.quantity);
        subtotal += net;
        taxAmount += applyRate(net, tax.rate);
      }
      const opt = optionsBySeller.get(g.sellerId)!;
      const chosen = opt.options.find((o) => o.code === input.shipping?.[g.sellerId]) ?? opt.options[0] ?? null;
      const shipping = chosen ? toMinor(chosen.amount) : 0n;
      totals.subtotal += subtotal;
      totals.shipping += shipping;
      totals.tax += taxAmount;
      groups.push({
        ...g,
        items,
        shippingOptions: opt.options.map((o) => ({
          code: o.code, provider: o.provider, carrierName: o.carrierName, serviceName: o.serviceName, description: o.description,
          amount: o.amount, estimatedDays: o.estimatedDays, attributes: o.attributes, carrierLogo: o.carrierLogo,
        })),
        shippingMessages: opt.messages,
        liveRates: opt.liveRates,
        selectedShipping: chosen?.code ?? null,
        subtotal: fromMinor(subtotal),
        shipping: fromMinor(shipping),
        tax: fromMinor(taxAmount),
        total: fromMinor(subtotal + shipping + taxAmount),
      });
    }
    const bt = await this.settings.get('payments.bank_transfer');
    const stripe = this.payments.providerFor('CARD');
    const paypal = this.payments.providerFor('PAYPAL');
    return {
      currency: cart.currency,
      addressId: address?.id ?? null,
      destinationCountry: address?.country_code ?? null,
      groups,
      tax: { name: tax.taxName, rate: Number(tax.rate), country: tax.countryCode },
      subtotal: fromMinor(totals.subtotal),
      shipping: fromMinor(totals.shipping),
      taxTotal: fromMinor(totals.tax),
      total: fromMinor(totals.subtotal + totals.shipping + totals.tax),
      paymentMethods: [
        stripe
          ? { code: 'CARD', name: 'Tarjeta de crédito / débito', available: true, provider: 'STRIPE', testMode: stripe.environment === 'TEST', publishableKey: config.stripePublishableKey }
          : config.paymentSandboxEnabled
            ? { code: 'CARD', name: 'Tarjeta de crédito / débito', available: true, provider: SANDBOX_PROVIDER, sandbox: true }
            : { code: 'CARD', name: 'Tarjeta de crédito / débito', available: false, reason: 'Disponible cuando se configure el procesador de tarjetas del marketplace.' },
        paypal
          ? { code: 'PAYPAL', name: 'PayPal', available: true, provider: 'PAYPAL', testMode: paypal.environment === 'TEST', clientId: config.paypalClientId }
          : { code: 'PAYPAL', name: 'PayPal', available: false, reason: 'Disponible cuando se configure la cuenta PayPal del marketplace.' },
        { code: 'BANK_TRANSFER', name: 'Transferencia bancaria', available: !!bt?.enabled },
        { code: 'CASH_ON_DELIVERY', name: 'Pago contra entrega', available: false, reason: 'No disponible en esta versión.' },
      ],
    };
  }

  // ------------------------------------------------------------------ place order
  async placeOrder(userId: string, input: PlaceOrderInput) {
    if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Falta la clave de idempotencia.');

    // Idempotent replay: same key returns the previous result.
    const prior = await this.db.one(
      `select cs.id, cs.status, pay.id as payment_id, pay.status as payment_status, pay.order_id
         from public.checkout_sessions cs left join public.payments pay on pay.checkout_session_id = cs.id
        where cs.customer_id = $1 and cs.idempotency_key = $2 order by pay.created_at desc nulls last limit 1`,
      [userId, input.idempotencyKey],
    );
    if (prior) return this.resultFor(prior.id, userId);

    const online = input.paymentMethod === 'BANK_TRANSFER' ? null : this.payments.providerFor(input.paymentMethod);
    if (input.paymentMethod === 'CARD' && !online) {
      // Simulated capture: explicit local-development opt-in only (PAYMENT_SANDBOX_ENABLED).
      if (!config.paymentSandboxEnabled) throw badRequest('PAYMENT_METHOD_UNAVAILABLE', 'Método de pago no disponible.');
      this.validateSandboxCard(input.card);
    }
    else if (input.paymentMethod === 'PAYPAL' && !online) throw badRequest('PAYMENT_METHOD_UNAVAILABLE', 'Método de pago no disponible.');
    else if (input.paymentMethod === 'BANK_TRANSFER' && !(await this.settings.get('payments.bank_transfer'))?.enabled)
      throw badRequest('PAYMENT_METHOD_UNAVAILABLE', 'Método de pago no disponible.');
    // Earlier card/PayPal attempts the buyer abandoned must not block the new checkout.
    await this.payments.releaseAbandoned(userId);

    // Live shipping options are fetched before the transaction (external API calls).
    const preCart = await this.carts.getCart(userId);
    if (!preCart.groups.length) throw conflict('CART_EMPTY', 'Tu carrito está vacío.');
    const preAddress = await this.buyerAddress(userId, input.addressId);
    if (!preAddress || preAddress.id !== input.addressId) throw badRequest('CHECKOUT_SHIPPING_ADDRESS_REQUIRED', 'Selecciona una dirección de envío válida.');
    const optionsBySeller = await this.groupOptions(preCart.id, preCart.groups, preAddress, preCart.currency);
    for (const g of preCart.groups) {
      const code = input.shipping?.[g.sellerId];
      if (!code || !optionsBySeller.get(g.sellerId)!.options.some((o) => o.code === code))
        throw conflict('SHIPPING_OPTION_UNAVAILABLE', 'Una opción de envío ya no está disponible. Revisa los métodos de envío.');
    }

    // Shipping was quoted for exactly these lines; the transaction must bill the same cart.
    const quotedCart = cartSignature(preCart.groups.flatMap((g: any) => g.items.map((i: any) => ({ sellerId: g.sellerId, variantId: i.variantId, quantity: i.quantity }))));

    const checkoutId = await this.db.tx(async (c) => {
      const corr = randomUUID();
      const cart = await this.carts.ensureMutableCart(userId, c);
      const address = await this.db.one(
        `select * from public.addresses where id = $1 and user_id = $2 and deleted_at is null`,
        [input.addressId, userId],
        c,
      );
      if (!address) throw badRequest('CHECKOUT_SHIPPING_ADDRESS_REQUIRED', 'Selecciona una dirección de envío válida.');

      const expiresAt = new Date(Date.now() + (input.paymentMethod === 'BANK_TRANSFER' ? TRANSFER_TTL_MIN : ONLINE_PAYMENT_TTL_MIN) * 60_000);
      const sessionId: string = (await this.db.one(
        `select public.create_checkout_from_cart($1, $2, $3, $4, $5) as id`,
        [cart.id, userId, input.idempotencyKey, expiresAt, corr],
        c,
      ))!.id;
      const session = await this.db.one(`select currency_code from public.checkout_sessions where id = $1`, [sessionId], c);
      const currency: string = session!.currency_code;

      await this.db.exec(
        `insert into public.checkout_address_snapshots (checkout_session_id, source_address_id, address_type, recipient_name,
                 line1, line2, city, region, postal_code, country_code, phone, company_name, metadata)
         values ($1,$2,'SHIPPING',$3,$4,$5,$6,$7,$8,$9,$10,$11, jsonb_build_object('label', $12::text))`,
        [sessionId, address.id, address.recipient_name, address.line1, address.line2, address.city, address.region,
         address.postal_code, address.country_code, address.phone, address.company_name, address.label],
        c,
      );

      const items = await this.db.many(
        `select ci.id, ci.seller_id, ci.product_id, ci.variant_id, ci.quantity::int as quantity, ci.unit_price::text as unit_price,
                ci.requires_shipping, ci.weight_value::text as weight_value, ci.weight_unit,
                ci.length_value::text as length_value, ci.width_value::text as width_value, ci.height_value::text as height_value,
                ci.dimension_unit, p.category_id, csg.id as seller_group_id
           from public.checkout_items ci
           join public.products p on p.id = ci.product_id
           join public.checkout_seller_groups csg on csg.checkout_session_id = ci.checkout_session_id and csg.seller_id = ci.seller_id
          where ci.checkout_session_id = $1 order by ci.created_at, ci.id`,
        [sessionId],
        c,
      );
      if (cartSignature(items.map((i: any) => ({ sellerId: i.seller_id, variantId: i.variant_id, quantity: i.quantity }))) !== quotedCart)
        throw conflict('CART_CHANGED', 'Tu carrito cambió mientras confirmabas el pedido. Revisa el resumen e inténtalo de nuevo.');

      // ---- inventory allocation per location (highest fulfillment priority first)
      type Alloc = { item: any; inventoryItemId: string; locationId: string; shipFrom: string; qty: number };
      const allocations: Alloc[] = [];
      for (const it of items) {
        const stock = await this.db.many(
          `select ii.id, ii.location_id, ii.available_to_sell::int as available, il.ship_from_address_id
             from public.inventory_items ii join public.inventory_locations il on il.id = ii.location_id
            where ii.variant_id = $1 and ii.seller_id = $2 and ii.status = 'ACTIVE'
              and il.status = 'ACTIVE' and il.fulfillment_enabled
            order by il.fulfillment_priority, ii.available_to_sell desc
            for update of ii`,
          [it.variant_id, it.seller_id],
          c,
        );
        let need = it.quantity;
        for (const s of stock) {
          if (need <= 0) break;
          const take = Math.min(need, s.available);
          if (take <= 0) continue;
          if (!s.ship_from_address_id)
            throw new AppError('SELLER_ORIGIN_MISSING', 'La tienda no tiene una dirección de despacho configurada.', HttpStatus.CONFLICT);
          allocations.push({ item: it, inventoryItemId: s.id, locationId: s.location_id, shipFrom: s.ship_from_address_id, qty: take });
          need -= take;
        }
        if (need > 0) throw conflict('INSUFFICIENT_INVENTORY', 'No hay suficiente inventario para uno de los productos de tu carrito.');
      }

      // ---- fulfillment groups (seller + origin location)
      const groupIds = new Map<string, string>();
      const groupItemQty = new Map<string, { groupKey: string; item: any; qty: number }>();
      for (const a of allocations) {
        const key = `${a.item.seller_id}:${a.locationId}`;
        if (!groupIds.has(key)) {
          const g = await this.db.one(
            `insert into public.checkout_fulfillment_groups (checkout_session_id, seller_group_id, seller_id, group_key,
                     inventory_location_id, ship_from_address_id, requires_shipping, shipping_selection_status)
             values ($1,$2,$3,$4,$5,$6,true,'REQUIRED') returning id`,
            [sessionId, a.item.seller_group_id, a.item.seller_id, key, a.locationId, a.shipFrom],
            c,
          );
          groupIds.set(key, g!.id);
        }
        const gi = `${key}|${a.item.id}`;
        const cur = groupItemQty.get(gi);
        if (cur) cur.qty += a.qty;
        else groupItemQty.set(gi, { groupKey: key, item: a.item, qty: a.qty });
      }
      for (const { groupKey, item, qty } of groupItemQty.values()) {
        await this.db.exec(
          `insert into public.checkout_fulfillment_group_items (fulfillment_group_id, checkout_session_id, checkout_item_id, seller_id, quantity)
           values ($1,$2,$3,$4,$5)`,
          [groupIds.get(groupKey), sessionId, item.id, item.seller_id, qty],
          c,
        );
      }

      // ---- packages, quotes and selected rate per group
      const shippingBySeller = new Map<string, Minor>();
      for (const [key, groupId] of groupIds) {
        const sellerId = key.split(':')[0];
        const groupAllocs = allocations.filter((a) => `${a.item.seller_id}:${a.locationId}` === key);
        const plan = await this.db.one(
          `insert into public.checkout_package_plans (checkout_session_id, fulfillment_group_id, seller_id, revision, strategy_code, calculation_engine_version)
           values ($1,$2,$3,1,'SINGLE_PACKAGE',$4) returning id`,
          [sessionId, groupId, sellerId, ENGINE],
          c,
        );
        const pkg = ShippingService.parcelFor(groupAllocs.map((a) => ({ ...a.item, qty: a.qty })));
        const declared = groupAllocs.reduce((acc, a) => acc + toMinor(a.item.unit_price) * BigInt(a.qty), 0n);
        const pk = await this.db.one(
          `insert into public.checkout_packages (package_plan_id, package_sequence, seller_id, weight_value, weight_unit,
                   length_value, width_value, height_value, dimension_unit, declared_value_amount, declared_value_currency)
           values ($1,1,$2,$3,'kg',$4,$5,$6,'cm',$7,$8) returning id`,
          [plan!.id, sellerId, pkg.weightKg, pkg.length, pkg.width, pkg.height, fromMinor(declared), currency],
          c,
        );
        const perItem = new Map<string, number>();
        for (const a of groupAllocs) perItem.set(a.item.id, (perItem.get(a.item.id) ?? 0) + a.qty);
        for (const [itemId, qty] of perItem)
          await this.db.exec(
            `insert into public.checkout_package_items (checkout_package_id, package_plan_id, checkout_item_id, quantity) values ($1,$2,$3,$4)`,
            [pk!.id, plan!.id, itemId, qty],
            c,
          );
        await this.db.exec(`select public.mark_checkout_package_plan_ready($1)`, [plan!.id], c);

        // Shipping options were quoted for the whole seller cart; a seller with several origin
        // locations is charged once (on its first group) and the rest ship under the same option.
        const opt = optionsBySeller.get(sellerId)!;
        const chosen = opt.options.find((o) => o.code === input.shipping![sellerId])!;
        const firstGroupOfSeller = !shippingBySeller.has(sellerId);
        const charge = firstGroupOfSeller ? toMinor(chosen.amount) : 0n;
        const quoteIds = new Map<string, string>();
        for (const provider of Array.from(new Set(opt.options.map((o) => o.provider)))) {
          const qid: string = (await this.db.one(
            `select public.create_shipping_quote_request($1,$2,$3,$4,$5,null,$6::jsonb,$7) as id`,
            [sessionId, groupId, plan!.id, provider, `${input.idempotencyKey}:quote:${groupId}:${provider}`,
             JSON.stringify({ provider, destination: { city: address.city, region: address.region, postal_code: address.postal_code, country: address.country_code }, package: pkg }), corr],
            c,
          ))!.id;
          quoteIds.set(provider, qid);
        }
        let chosenRateId: string | null = null;
        for (const o of opt.options) {
          const ro = await this.db.one(
            `insert into public.shipping_rate_options (quote_request_id, fulfillment_group_id, seller_id, shipping_provider_code,
                     provider_rate_id, carrier_code, carrier_name, service_token, service_name, provider_amount,
                     provider_currency_code, checkout_currency_amount, checkout_currency_code, estimated_days, duration_terms,
                     attributes, expires_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb, now() + interval '3 days') returning id`,
            [quoteIds.get(o.provider), groupId, sellerId, o.provider, o.providerRateId ? `${o.providerRateId}|${groupId}` : `${o.provider}:${o.code}:${groupId}`,
             o.carrierCode, o.carrierName, o.serviceToken, o.serviceName, o.providerAmount ?? o.amount, o.providerCurrency ?? currency,
             o.amount, currency, o.estimatedDays, o.description || null,
             JSON.stringify({ option_code: o.code, provider_rate_id: o.providerRateId, provider_shipment_id: o.providerShipmentId, tags: o.attributes, carrier_logo: o.carrierLogo })],
            c,
          );
          if (o.code === chosen.code) chosenRateId = ro!.id;
        }
        for (const qid of quoteIds.values())
          await this.db.exec(
            `update public.shipping_quote_requests set status = 'READY', completed_at = now(), expires_at = now() + interval '3 days' where id = $1`,
            [qid],
            c,
          );
        await this.db.exec(
          `select public.select_checkout_shipping_rate($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
          [sessionId, groupId, chosenRateId, fromMinor(charge), `${input.idempotencyKey}:ship:${groupId}`, userId,
           JSON.stringify({ option_code: chosen.code, provider: chosen.provider, provider_rate_id: chosen.providerRateId, charged_on_first_group: firstGroupOfSeller }), corr],
          c,
        );
        shippingBySeller.set(sellerId, (shippingBySeller.get(sellerId) ?? 0n) + charge);
      }

      // ---- authoritative financial calculation
      await this.calculate(c, sessionId, currency, items, shippingBySeller, corr, address.country_code);

      // ---- inventory reservations
      for (const a of allocations) {
        await this.db.exec(
          `select public.reserve_checkout_inventory($1,$2,$3,$4,$5,$6,$7,$8)`,
          [sessionId, a.item.id, a.inventoryItemId, a.qty, expiresAt, `${input.idempotencyKey}:res:${a.item.id}:${a.inventoryItemId}`, userId, corr],
          c,
        );
      }
      await this.db.exec(`select public.mark_checkout_ready_for_payment($1,$2,$3)`, [sessionId, userId, corr], c);

      // ---- payment
      const prov = await this.db.one(
        `select cfg.id as cfg_id, acc.id as acc_id from public.payment_provider_configurations cfg
           join public.platform_payment_provider_accounts acc
             on acc.provider_code = cfg.provider_code and acc.environment = cfg.environment and acc.status = 'ACTIVE'
          where cfg.provider_code = $1 and cfg.environment = $2 and cfg.status = 'ACTIVE'
          order by cfg.version desc limit 1`,
        [online?.code ?? SANDBOX_PROVIDER, online?.environment ?? config.paymentEnvironment],
        c,
      );
      if (!prov) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'El procesador de pagos no está disponible.', HttpStatus.SERVICE_UNAVAILABLE);
      const paymentId: string = (await this.db.one(
        `select public.begin_checkout_payment($1,$2,$3,$4,$5,$6) as id`,
        [sessionId, userId, prov.cfg_id, prov.acc_id, `${input.idempotencyKey}:pay`, corr],
        c,
      ))!.id;
      const pay = await this.db.one(`select expected_amount::text as amount, currency_code from public.payments where id = $1`, [paymentId], c);

      if (online) {
        const ref = await this.db.one(
          `select cs.public_number, u.email::text as email from public.checkout_sessions cs join public.users u on u.id = cs.customer_id where cs.id = $1`,
          [sessionId],
          c,
        );
        await this.payments.startProviderPayment(c, {
          paymentId, checkoutId: sessionId, provider: online.code, amount: pay!.amount, currency: pay!.currency_code,
          customerEmail: ref?.email, reference: `NX-CHK-${ref?.public_number ?? ''}`, corr,
        });
      } else if (input.paymentMethod === 'CARD') {
        if (!config.paymentSandboxEnabled) throw badRequest('PAYMENT_METHOD_UNAVAILABLE', 'Método de pago no disponible.');
        const last4 = input.card!.number.replace(/\D/g, '').slice(-4);
        const intentId: string = (await this.db.one(
          `select public.register_payment_provider_intent($1,$2,'succeeded','SUCCEEDED',null,$3,now(),$4::jsonb) as id`,
          [paymentId, `sbx_pi_${randomUUID().replace(/-/g, '')}`, `sbx_pm_card_${last4}`,
           JSON.stringify({ method: 'CARD', brand: cardBrand(input.card!.number), last4 })],
          c,
        ))!.id;
        await this.db.one(
          `select public.confirm_payment_capture($1,$2,$3,$4,$5,null,now(),$6,$7,$8) as order_id`,
          [paymentId, intentId, `sbx_ch_${randomUUID().replace(/-/g, '')}`, pay!.amount, pay!.currency_code,
           `sbx_txn_${randomUUID().replace(/-/g, '')}`, userId, corr],
          c,
        );
        await this.db.exec(`select public.post_payment_capture_to_ledger($1,$2,$3,$4)`, [paymentId, `capture:${paymentId}`, userId, corr], c);
        await postSaleAllocation(this.db, c, paymentId, userId, corr);
      } else {
        const intentId: string = (await this.db.one(
          `select public.register_payment_provider_intent($1,$2,'awaiting_transfer','REQUIRES_ACTION',null,null,now(),$3::jsonb) as id`,
          [paymentId, `sbx_bt_${randomUUID().replace(/-/g, '')}`, JSON.stringify({ method: 'BANK_TRANSFER' })],
          c,
        ))!.id;
        await this.db.exec(`select public.mark_payment_requires_action($1,$2,$3)`, [paymentId, intentId, corr], c);
      }
      return sessionId;
    });

    const result = await this.resultFor(checkoutId, userId);
    if (result.orderId) this.mail.fire(() => this.mail.orderConfirmed(result.orderId));
    else if (result.bankTransfer && result.paymentId) this.mail.fire(() => this.mail.transferInstructions(result.paymentId, result.bankTransfer!));
    return result;
  }

  /** Writes calculation run + immutable snapshots + commission evidence, then finalizes. */
  private async calculate(c: PoolClient, sessionId: string, currency: string, items: any[], shippingBySeller: Map<string, Minor>, corr: string, destinationCountry: string) {
    const taxInfo = await this.tax.forCountry(destinationCountry, c);
    const taxRate = taxInfo.rate;
    const taxEvidence = { code: taxInfo.taxName, rate: taxRate, country: destinationCountry, source: 'marketplace_tax_rates' };
    const dec = await this.db.one(`select decimal_places from public.currencies where code = $1`, [currency], c);
    const rev = await this.db.one(`select coalesce(max(revision),0)+1 as r from public.checkout_calculation_runs where checkout_session_id = $1`, [sessionId], c);
    const run = await this.db.one(
      `insert into public.checkout_calculation_runs (checkout_session_id, revision, currency_code, calculation_engine_version, correlation_id)
       values ($1,$2,$3,$4,$5) returning id`,
      [sessionId, rev!.r, currency, ENGINE, corr],
      c,
    );
    const runId = run!.id;
    const lines: (LineCalc & { item: any; rule: CommissionRule | null; base: Minor })[] = [];
    for (const it of items) {
      const unit = toMinor(it.unit_price);
      const gross = unit * BigInt(it.quantity);
      const net = gross;
      const rule = await this.commissionRule(c, it.seller_id, it.category_id, it.product_id, it.variant_id);
      const com = this.computeCommission(rule, gross, net);
      lines.push({
        key: it.id, sellerId: it.seller_id, quantity: it.quantity, unit, gross, discount: 0n, net,
        tax: applyRate(net, taxRate), commission: com.amount, commissionRaw: com.raw, entitlement: net - com.amount,
        item: it, rule, base: com.base,
      });
    }
    for (const l of lines) {
      await this.db.exec(
        `insert into public.checkout_item_financial_snapshots (calculation_run_id, checkout_session_id, checkout_item_id, seller_id,
                 quantity, unit_price, gross_amount, discount_amount, product_net_amount, taxable_amount, tax_amount,
                 platform_commission_amount, referral_commission_amount, processor_fee_estimate_allocated, seller_product_entitlement,
                 currency_code, calculation_breakdown)
         values ($1,$2,$3,$4,$5,$6,$7,0,$8,$8,$9,$10,0,0,$11,$12,$13::jsonb)`,
        [runId, sessionId, l.key, l.sellerId, l.quantity, fromMinor(l.unit), fromMinor(l.gross), fromMinor(l.net), fromMinor(l.tax),
         fromMinor(l.commission), fromMinor(l.entitlement), currency,
         JSON.stringify({ engine: ENGINE, tax: { ...taxEvidence, base: fromMinor(l.net) }, commission_rule_version_id: l.rule?.versionId ?? null })],
        c,
      );
      if (l.rule) {
        const snapshot = {
          schema_version: 'COMMISSION_APPLIED_RULE_V1',
          rule: { group_id: l.rule.groupId, version_id: l.rule.versionId },
          conditions: l.rule.conditions,
          calculation: {
            subject_type: 'ITEM',
            subject_id: l.key,
            type: l.rule.type,
            base_code: l.rule.baseCode,
            base_amount: fromMinor(l.base),
            percentage_rate: l.rule.rate,
            fixed_amount: l.rule.fixedAmount,
            fixed_currency_code: l.rule.fixedCurrency,
            minimum_amount: l.rule.minimum,
            maximum_amount: l.rule.maximum,
            limit_currency_code: l.rule.limitCurrency,
            raw_amount: l.commissionRaw,
            bounded_amount: l.commissionRaw,
            rounded_amount: fromMinor(l.commission),
            calculator_version: ENGINE,
          },
          currency: { code: currency, decimal_places: dec!.decimal_places, rounding_mode: l.rule.rounding },
          resolution: { evaluator_version: ENGINE, scope_type: l.rule.scopeType },
        };
        await this.db.exec(
          `insert into public.checkout_applied_rules (calculation_run_id, checkout_session_id, checkout_item_id, seller_id,
                   business_rule_version_id, rule_type_code, scope_type_code, scope_id, calculation_base_code, funding_source_code,
                   input_amount, result_amount, currency_code, rule_snapshot, raw_amount, bounded_amount, rounding_mode, currency_decimal_places)
           values ($1,$2,$3,$4,$5,'PLATFORM_COMMISSION',$6,$7,$8,'SELLER',$9,$10,$11,$12::jsonb,$13,$13,$14,$15)`,
          [runId, sessionId, l.key, l.sellerId, l.rule.versionId, l.rule.scopeType, scopeIdFor(l.rule, l.item), l.rule.baseCode,
           fromMinor(l.base), fromMinor(l.commission), currency, JSON.stringify(snapshot), l.commissionRaw, l.rule.rounding, dec!.decimal_places],
          c,
        );
      }
    }
    const bySeller = new Map<string, typeof lines>();
    for (const l of lines) {
      if (!bySeller.has(l.sellerId)) bySeller.set(l.sellerId, []);
      bySeller.get(l.sellerId)!.push(l);
    }
    const G = { gross: 0n, net: 0n, ship: 0n, tax: 0n, com: 0n, ent: 0n, total: 0n };
    for (const [sellerId, ls] of bySeller) {
      const sum = (f: (l: LineCalc) => Minor) => ls.reduce((a, l) => a + f(l), 0n);
      const gross = sum((l) => l.gross);
      const net = sum((l) => l.net);
      const tax = sum((l) => l.tax);
      const com = sum((l) => l.commission);
      const ent = sum((l) => l.entitlement);
      const ship = shippingBySeller.get(sellerId) ?? 0n;
      const total = net + ship + tax;
      await this.db.exec(
        `insert into public.checkout_seller_financial_snapshots (calculation_run_id, checkout_session_id, seller_id,
                 product_gross_amount, discount_total, product_net_amount, shipping_amount, tax_amount, customer_fee_amount,
                 platform_commission_total, referral_commission_total, processor_fee_estimate_allocated, seller_entitlement_estimate,
                 customer_total, currency_code, calculation_breakdown)
         values ($1,$2,$3,$4,0,$5,$6,$7,0,$8,0,0,$9,$10,$11,$12::jsonb)`,
        [runId, sessionId, sellerId, fromMinor(gross), fromMinor(net), fromMinor(ship), fromMinor(tax), fromMinor(com), fromMinor(ent),
         fromMinor(total), currency, JSON.stringify({ engine: ENGINE, tax: taxEvidence })],
        c,
      );
      G.gross += gross; G.net += net; G.ship += ship; G.tax += tax; G.com += com; G.ent += ent; G.total += total;
    }
    await this.db.exec(
      `insert into public.checkout_financial_snapshots (calculation_run_id, checkout_session_id, product_gross_amount, discount_total,
               product_net_amount, shipping_total, tax_total, customer_fee_total, grand_total, platform_commission_total,
               referral_commission_total, processor_fee_estimate, seller_entitlement_estimate_total, currency_code, calculation_breakdown)
       values ($1,$2,$3,0,$4,$5,$6,0,$7,$8,0,0,$9,$10,$11::jsonb)`,
      [runId, sessionId, fromMinor(G.gross), fromMinor(G.net), fromMinor(G.ship), fromMinor(G.tax), fromMinor(G.total), fromMinor(G.com),
       fromMinor(G.ent), currency, JSON.stringify({ engine: ENGINE, tax: taxEvidence })],
      c,
    );
    await this.db.exec(`select public.finalize_checkout_calculation_run($1)`, [runId], c);
  }

  private validateSandboxCard(card?: PlaceOrderInput['card']) {
    if (!card) throw badRequest('CARD_REQUIRED', 'Ingresa los datos de la tarjeta.');
    const digits = card.number.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) throw badRequest('CARD_INVALID', 'El número de tarjeta no es válido.');
    const now = new Date();
    const y = card.expYear < 100 ? 2000 + card.expYear : card.expYear;
    if (!(card.expMonth >= 1 && card.expMonth <= 12) || y < now.getFullYear() || (y === now.getFullYear() && card.expMonth < now.getMonth() + 1))
      throw badRequest('CARD_EXPIRED', 'La tarjeta está vencida.');
    if (!/^\d{3,4}$/.test(card.cvc)) throw badRequest('CARD_CVC_INVALID', 'El CVV no es válido.');
    if (!card.name?.trim()) throw badRequest('CARD_NAME_REQUIRED', 'Ingresa el nombre que aparece en la tarjeta.');
    if (config.paymentEnvironment === 'TEST' && digits === '4000000000000002')
      throw new AppError('CARD_DECLINED', 'La tarjeta fue rechazada por el emisor (tarjeta de prueba de rechazo).', HttpStatus.PAYMENT_REQUIRED);
  }

  async resultFor(checkoutId: string, userId?: string) {
    const r = await this.db.one(
      `select cs.id, cs.public_number, cs.status, pay.id as payment_id, pay.public_number as payment_number, pay.status as payment_status, pay.provider_code,
              pay.expected_amount::text as amount, pay.currency_code, pay.order_id, o.public_number as order_number
         from public.checkout_sessions cs
         left join public.payments pay on pay.checkout_session_id = cs.id
         left join public.orders o on o.id = pay.order_id
        where cs.id = $1 order by pay.created_at desc nulls last limit 1`,
      [checkoutId],
    );
    if (!r) throw notFound('Compra');
    const pendingOnline = ['REQUIRES_ACTION', 'REQUIRES_PAYMENT_METHOD'].includes(r.payment_status) && ['STRIPE', 'PAYPAL'].includes(r.provider_code);
    const bt = r.payment_status === 'REQUIRES_ACTION' && r.provider_code === SANDBOX_PROVIDER ? await this.settings.get('payments.bank_transfer') : null;
    return {
      provider: r.provider_code,
      paymentAction: pendingOnline && userId ? await this.payments.clientAction(checkoutId, userId) : null,
      checkoutId: r.id,
      status: r.status,
      paymentId: r.payment_id,
      paymentStatus: r.payment_status,
      amount: r.amount,
      currency: r.currency_code,
      orderId: r.order_id,
      orderNumber: r.order_number ? orderRef(r.order_number) : null,
      bankTransfer: bt
        ? {
            reference: paymentRef(r.payment_number),
            bank: bt.bank_name,
            accountName: bt.account_holder,
            accountNumber: bt.account_number,
            routingOrSwift: bt.routing_or_swift ?? null,
            iban: bt.iban ?? null,
            instructions: bt.instructions,
          }
        : null,
    };
  }
}

function luhn(d: string) {
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function cardBrand(n: string) {
  const d = n.replace(/\D/g, '');
  if (/^4/.test(d)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'MASTERCARD';
  if (/^3[47]/.test(d)) return 'AMEX';
  return 'CARD';
}

function scopeIdFor(rule: CommissionRule, item: any): string | null {
  switch (rule.scopeType) {
    case 'SELLER':
      return item.seller_id;
    case 'PRODUCT':
      return item.product_id;
    case 'VARIANT':
      return item.variant_id;
    case 'CATEGORY':
      return item.category_id;
    default:
      return null;
  }
}

/** Formats a scaled integer (value / 10^scale) as an exact decimal string. */
function decimalString(v: bigint, scale: number) {
  const base = 10n ** BigInt(scale);
  const int = v / base;
  const frac = (v % base).toString().padStart(scale, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : `${int}`;
}

export { allocate };

/** Order-independent fingerprint of the purchasable lines (seller, variant, quantity). */
function cartSignature(lines: Array<{ sellerId: string; variantId: string; quantity: number }>) {
  const agg = new Map<string, number>();
  for (const l of lines) agg.set(`${l.sellerId}|${l.variantId}`, (agg.get(`${l.sellerId}|${l.variantId}`) ?? 0) + Number(l.quantity));
  return [...agg.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, q]) => `${k}:${q}`).join(',');
}
