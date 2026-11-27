import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { TaxService } from '../tax/tax.service';
import { lineTax, normalizeTaxClass, shippingTax, TaxClass } from '../tax/tax-calc';
import { StripeTaxLine, StripeTaxService } from '../tax/stripe-tax.service';
import { OriginAddress, Parcel, ShippingOption, ShippingService } from '../shipping/shipping.service';
import { CartService } from '../cart/cart.service';
import { AppError, badRequest, conflict, notFound } from '../common/errors';
import { allocate, applyRate, fromMinor, Minor, toMinor } from '../common/money';
import { config } from '../config';
import { postSaleAllocation } from './sale-ledger';
import { CouponResult, CouponsService } from '../promotions/coupons.service';
import { AffiliatesService } from '../promotions/affiliates.service';
import { orderRef, paymentRef } from '../common/refs';
import { ONLINE_PAYMENT_TTL_MIN, PaymentsService } from '../payments/payments.service';
import { MailService } from '../mail/mail.service';
import { AvailabilityService } from '../geo/availability';
import { freeShippingPolicies, qualifiesForFreeShipping, SELLER_FREE_SHIPPING, sellerFreeShippingOption } from '../shipping/free-shipping';

const ENGINE = 'nx-checkout-2.0';
const SANDBOX_PROVIDER = 'RD_SANDBOX';

export type PaymentMethod = 'CARD' | 'PAYPAL' | 'BANK_TRANSFER';

export interface PlaceOrderInput {
  addressId: string;
  addressVersion?: string;
  shipping: Record<string, string>; // sellerId -> rate code
  paymentMethod: PaymentMethod;
  card?: { number: string; expMonth: number; expYear: number; cvc: string; name: string };
  /** Stripe: keep the new card for next purchases / pay with a saved one. */
  saveCard?: boolean;
  savedCardId?: string;
  /** Store coupon codes typed by the buyer (one per store). */
  coupons?: string[];
  idempotencyKey: string;
  /** Total the buyer saw and accepted (from the quote); the order is refused when it no longer matches. */
  quotedTotal?: string;
}

function checkoutAddressVersion(address: { id: string; row_version: string }) {
  return createHash('sha256').update(`${address.id}:${address.row_version}`).digest('hex');
}

function addressChanged() {
  return conflict('CHECKOUT_ADDRESS_CHANGED', 'La dirección de envío cambió. Revisa la nueva cotización antes de confirmar.');
}

function shippingUnavailable() {
  return conflict('SHIPPING_OPTION_UNAVAILABLE', 'Una opción de envío ya no está disponible. Revisa los métodos de envío.');
}

function destinationUnavailable() {
  return conflict('DESTINATION_UNAVAILABLE', 'Algunos productos no se envían al país de tu dirección. Quítalos del carrito o elige otra dirección.');
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
  taxRate: string;
  taxClass: TaxClass;
  commission: Minor;
  commissionRaw: string;
  entitlement: Minor;
}

/** Shipping of one fulfillment group: tax-exclusive amount and its tax. */
interface ShippingTaxLine {
  groupId: string;
  sellerId: string;
  amount: Minor;
  tax: Minor;
  rate: string;
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
    private readonly coupons: CouponsService,
    private readonly affiliates: AffiliatesService,
    private readonly stripeTax: StripeTaxService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * Confirmed restrictions (marketplace, store or product) for the confirmed address country (NX-GEO-001 §5),
   * evaluated per cart variant (each one ships from the warehouse that stocks it). Keyed by variant id.
   * Only UNAVAILABLE blocks; uncertainty is settled by the live shipping options.
   */
  private async destinationBlocks(groups: any[], country: string | null | undefined, client?: PoolClient) {
    const blocked = new Map<string, string>();
    if (!country) return blocked;
    const ids = groups.flatMap((g: any) => g.items.filter((i: any) => i.purchasable).map((i: any) => i.variantId as string));
    for (let i = 0; i < ids.length; i += 100) {
      const r = await this.availability.forItems(country, [], ids.slice(i, i + 100), client);
      for (const [id, a] of Object.entries(r.variants)) if (a.status === 'UNAVAILABLE') blocked.set(id, a.reason);
    }
    return blocked;
  }

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

  /** Default (or chosen) address and its row revision; lock it when creating the checkout snapshot. */
  private async buyerAddress(userId: string, addressId?: string | null, c?: PoolClient) {
    return this.db.one(
      `select a.*, a.xmin::text as row_version from public.addresses a
        where a.user_id = $1 and a.deleted_at is null and ($2::uuid is null or a.id = $2)
        order by (a.id = $2) desc nulls last, a.is_default_shipping desc, a.created_at limit 1${c ? ' for share of a' : ''}`,
      [userId, addressId ?? null],
      c,
    );
  }

  /**
   * Physical origins of each seller's cart lines: the same allocation the order will make (highest
   * fulfillment priority first), read without locks. Returns, per seller, the lines grouped by the
   * ship-from address of the warehouse that will dispatch them. Lines without enough stock fall back
   * to the store's default origin (the order then fails with INSUFFICIENT_INVENTORY anyway).
   */
  private async originPlan(dims: any[]) {
    const plan = new Map<string, Map<string, any[]>>(); // sellerId -> shipFromId|'' -> lines with qty
    const vids = [...new Set(dims.map((d: any) => d.variant_id))];
    const stock = vids.length
      ? await this.db.many(
          `select ii.variant_id, ii.seller_id, ii.available_to_sell::int as available, il.ship_from_address_id
             from public.inventory_items ii join public.inventory_locations il on il.id = ii.location_id
            where ii.variant_id = any($1::uuid[]) and ii.status = 'ACTIVE' and il.status = 'ACTIVE' and il.fulfillment_enabled
            order by ii.variant_id, il.fulfillment_priority, ii.available_to_sell desc`,
          [vids],
        )
      : [];
    const add = (sellerId: string, origin: string, line: any, qty: number) => {
      if (!plan.has(sellerId)) plan.set(sellerId, new Map());
      const m = plan.get(sellerId)!;
      m.set(origin, [...(m.get(origin) ?? []), { ...line, qty }]);
    };
    for (const d of dims) {
      let need = Number(d.qty);
      for (const s of stock) {
        if (need <= 0) break;
        if (s.variant_id !== d.variant_id || s.seller_id !== d.seller_id || !s.ship_from_address_id) continue;
        const take = Math.min(need, s.available);
        if (take <= 0) continue;
        add(d.seller_id, s.ship_from_address_id, d, take);
        need -= take;
      }
      if (need > 0) add(d.seller_id, '', d, need);
    }
    return plan;
  }

  /**
   * Shipping options for every seller group of the current cart (also used to validate the order).
   * A store whose items leave from several warehouses is quoted once per origin: it offers only the
   * methods every origin can ship, priced as the sum of each origin's rate (what the order charges).
   */
  private async groupOptions(cartId: string, groups: any[], address: any, currency: string, blocked?: ReadonlyMap<string, string>) {
    const addressVersion = checkoutAddressVersion(address);
    const [dims, freePolicies] = await Promise.all([
      this.db.many(
        `select ci.seller_id, ci.variant_id, ci.quantity::int as qty, p.requires_shipping,
                v.weight_value, v.weight_unit, v.length_value, v.width_value, v.height_value, v.dimension_unit
           from public.cart_items ci join public.product_variants v on v.id = ci.variant_id
           join public.products p on p.id = v.product_id
          where ci.cart_id = $1 and ci.status = 'ACTIVE'`,
        [cartId],
      ),
      freeShippingPolicies(this.db, groups.flatMap((group) => group.items.map((item: any) => item.productId))),
    ]);
    type Opts = Awaited<ReturnType<ShippingService['options']>>;
    const out = new Map<string, Opts & { parcel: Parcel; origins: { id: string | null; parcel: Parcel; options: ShippingOption[] }[] }>();
    const purchasableDims = dims.filter((d: any) =>
      groups.some((g: any) => g.sellerId === d.seller_id && g.items.some((i: any) => i.purchasable && i.variantId === d.variant_id)),
    );
    const plan = await this.originPlan(purchasableDims);
    await Promise.all(
      groups.map(async (g: any) => {
        const byOrigin = plan.get(g.sellerId) ?? new Map<string, any[]>([['', []]]);
        const fallback = byOrigin.has('') ? await this.shipping.originFor(g.sellerId) : null;
        const quoted = await Promise.all(
          [...byOrigin.entries()].map(async ([originId, lines]) => {
            const origin = originId
              ? await this.db.one<OriginAddress>(
                  `select id, contact_name, company_name, line1, line2, city, region, postal_code, country_code, phone
                     from public.seller_ship_from_addresses where id = $1 and seller_id = $2 and status = 'ACTIVE'`,
                  [originId, g.sellerId],
                )
              : fallback;
            const parcel = ShippingService.parcelFor(lines);
            return { id: origin?.id ?? null, parcel, res: await this.shipping.options(origin, address, parcel, currency, addressVersion) };
          }),
        );
        // The default origin may be the same address as a warehouse already in the plan.
        const merged = new Map<string | null, (typeof quoted)[number]>();
        for (const q of quoted) if (!merged.has(q.id)) merged.set(q.id, q);
        const items = g.items.filter((item: any) => item.purchasable);
        const warehouses = [...merged.values()];
        const lines = items.map((item: any) => ({
          productId: item.productId,
          requiresShipping: purchasableDims.find((line) => line.variant_id === item.variantId)?.requires_shipping,
        }));
        const canOfferFree = items.length > 0
          && !items.some((item: any) => blocked?.has(item.variantId))
          && warehouses.every((q) => q.id)
          && qualifiesForFreeShipping(freePolicies, lines, address.country_code, currency,
            items.reduce((sum: Minor, item: any) => sum + toMinor(item.unitPrice) * BigInt(item.quantity), 0n));
        // Keep live/cached rates as-is. The store uses its own carrier on this additional route.
        const list = canOfferFree ? warehouses.map((q) => ({
          ...q, res: { ...q.res, options: [sellerFreeShippingOption(currency), ...q.res.options] },
        })) : warehouses;
        const origins = list.map((q) => ({ id: q.id, parcel: q.parcel, options: q.res.options }));
        if (list.length === 1) {
          out.set(g.sellerId, { ...list[0].res, parcel: list[0].parcel, origins });
          return;
        }
        const common = list[0].res.options.filter((o) => list.every((q) => q.res.options.some((x) => x.code === o.code)));
        const options = common.map((o) => {
          const all = list.map((q) => q.res.options.find((x) => x.code === o.code)!);
          return {
            ...o,
            amount: fromMinor(all.reduce((acc, x) => acc + toMinor(x.amount), 0n)),
            estimatedDays: all.some((x) => x.estimatedDays == null) ? null : Math.max(...all.map((x) => x.estimatedDays!)),
            description: o.description,
          };
        });
        const messages = [...new Set(list.flatMap((q) => q.res.messages))];
        if (!options.length) messages.push('Los productos de esta tienda salen de varios almacenes y no hay un método de envío común a todos.');
        out.set(g.sellerId, { options, messages, liveRates: list.every((q) => q.res.liveRates), parcel: list[0].parcel, origins });
      }),
    );
    return out;
  }

  /** Price preview from the current cart (no writes). Used by the checkout screen. */
  async quote(userId: string, input: { addressId?: string; shipping?: Record<string, string>; coupons?: string[] }) {
    const cart = await this.carts.getCart(userId);
    if (!cart.groups.length) throw conflict('CART_EMPTY', 'Tu carrito está vacío.');
    const address = await this.buyerAddress(userId, input.addressId);
    const tax = await this.tax.forDestination(address?.country_code, address?.region);
    const classOf = await this.tax.classesFor(cart.groups.flatMap((g: any) => g.items.map((i: any) => i.productId)));
    const blocked = await this.destinationBlocks(cart.groups, address?.country_code);
    // No address yet: no shipping options or amount until the buyer adds one.
    const optionsBySeller = address
      ? await this.groupOptions(cart.id, cart.groups, address, cart.currency, blocked)
      : (new Map(cart.groups.map((g: any) => [g.sellerId, { options: [], messages: [], liveRates: false }])) as unknown as Awaited<ReturnType<CheckoutService['groupOptions']>>);
    const groups = [];
    const totals = { subtotal: 0n, discount: 0n, shipping: 0n, tax: 0n };
    const lines = cart.groups.flatMap((g: any) => g.items.filter((i: any) => i.purchasable).map((i: any) => ({ key: i.variantId, sellerId: g.sellerId, productId: i.productId, gross: toMinor(i.unitPrice) * BigInt(i.quantity) })));
    const promo = await this.coupons.evaluate(input.coupons ?? [], lines, userId);
    const discountOf = new Map<string, bigint>();
    for (const r of promo.results) for (const a of r.allocations) discountOf.set(a.key, (discountOf.get(a.key) ?? 0n) + a.discount);
    const viaStripe = tax.calculationProvider === 'STRIPE_TAX' && !!address;
    const stripeLines: (StripeTaxLine & { sellerId: string })[] = [];
    for (const g of cart.groups) {
      const items = g.items.filter((i: any) => i.purchasable);
      let subtotal = 0n;
      let discount = 0n;
      let taxAmount = 0n;
      for (const i of items) {
        const gross = toMinor(i.unitPrice) * BigInt(i.quantity);
        const d = discountOf.get(i.variantId) ?? 0n;
        subtotal += gross;
        discount += d;
        taxAmount += lineTax(tax, classOf.get(i.productId) ?? 'STANDARD', toMinor(i.unitPrice), i.quantity, d).tax;
        if (viaStripe) stripeLines.push({ reference: i.variantId, amount: gross - d, quantity: i.quantity, taxClass: classOf.get(i.productId) ?? 'STANDARD', sellerId: g.sellerId });
      }
      const coupon = promo.results.find((r) => r.sellerId === g.sellerId);
      const opt = optionsBySeller.get(g.sellerId)!;
      const chosen = opt.options.find((o) => o.code === input.shipping?.[g.sellerId]) ?? opt.options[0] ?? null;
      const shipping = chosen ? toMinor(chosen.amount) : 0n;
      // Taxed per physical origin, as the order does (each origin is its own shipment).
      const perOrigin = chosen ? (opt.origins ?? []).map((o) => toMinor(o.options.find((x) => x.code === chosen.code)?.amount ?? '0')) : [];
      for (const amt of perOrigin.length ? perOrigin : [shipping]) taxAmount += shippingTax(tax, amt).tax;
      if (viaStripe)
        (perOrigin.length ? perOrigin : [shipping]).forEach((amt, n) => stripeLines.push({ reference: `ship:${g.sellerId}:${n}`, amount: amt, shipping: true, sellerId: g.sellerId }));
      // Inclusive countries: the listed amounts already contain the tax (shown as "includes").
      const groupTotal = subtotal - discount + shipping + (tax.pricesIncludeTax ? 0n : taxAmount);
      totals.subtotal += subtotal;
      totals.discount += discount;
      totals.shipping += shipping;
      totals.tax += taxAmount;
      groups.push({
        ...g,
        items,
        shippingOptions: opt.options.map((o) => ({
          code: o.code, provider: o.provider, carrierName: o.carrierName, serviceName: o.serviceName, description: o.description,
          amount: o.amount, estimatedDays: o.estimatedDays, attributes: o.attributes, carrierLogo: o.carrierLogo,
          freeShipping: o.code === SELLER_FREE_SHIPPING,
        })),
        shippingMessages: opt.messages,
        liveRates: opt.liveRates,
        /** Items that can't be shipped to the address country, with the reason code. */
        destinationBlocked: items.filter((i: any) => blocked.has(i.variantId)).map((i: any) => ({ productId: i.productId, variantId: i.variantId, reason: blocked.get(i.variantId) })),
        selectedShipping: chosen?.code ?? null,
        subtotal: fromMinor(subtotal),
        discount: fromMinor(discount),
        coupon: coupon ? { code: coupon.code, discount: fromMinor(coupon.discount) } : null,
        shipping: fromMinor(shipping),
        tax: fromMinor(taxAmount),
        total: fromMinor(groupTotal),
      });
    }
    // Stripe Tax (e.g. US sales tax): exact tax for the address replaces the configured rates.
    let effectiveRate = Number(tax.rate);
    if (viaStripe) {
      const r = await this.stripeTax.calculate(cart.currency, address, stripeLines, { cache: true });
      totals.tax = 0n;
      for (const g of groups as any[]) {
        const t = stripeLines.filter((l) => l.sellerId === g.sellerId).reduce((a, l) => a + (r.byRef.get(l.reference) ?? 0n), 0n);
        g.tax = fromMinor(t);
        g.total = fromMinor(toMinor(g.subtotal) - toMinor(g.discount) + toMinor(g.shipping) + t);
        totals.tax += t;
      }
      const base = totals.subtotal - totals.discount + totals.shipping;
      effectiveRate = base > 0n ? Number((totals.tax * 1_000_000n) / base) / 1_000_000 : 0;
    }
    const bt = await this.settings.get('payments.bank_transfer');
    const stripe = this.payments.providerFor('CARD');
    const paypal = this.payments.providerFor('PAYPAL');
    return {
      currency: cart.currency,
      addressId: address?.id ?? null,
      addressVersion: address ? checkoutAddressVersion(address) : null,
      destinationCountry: address?.country_code ?? null,
      needsAddress: !address,
      groups,
      tax: { name: tax.taxName, rate: effectiveRate, country: tax.countryCode, included: tax.pricesIncludeTax, appliesToShipping: tax.appliesToShipping, provider: tax.calculationProvider },
      subtotal: fromMinor(totals.subtotal),
      discount: fromMinor(totals.discount),
      coupons: promo.results.map((r) => ({ code: r.code, sellerId: r.sellerId, discount: fromMinor(r.discount) })),
      couponErrors: promo.errors,
      shipping: fromMinor(totals.shipping),
      taxTotal: fromMinor(totals.tax),
      total: fromMinor(totals.subtotal - totals.discount + totals.shipping + (tax.pricesIncludeTax ? 0n : totals.tax)),
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
    // Unpaid transfers hold stock: cap how long and how many at once (Admin → Configuración → Seguridad).
    const security = await this.settings.get('security.controls');
    if (input.paymentMethod === 'BANK_TRANSFER') {
      const open = await this.db.one<{ n: number }>(
        `select count(*)::int as n from public.payments p
          where p.customer_id = $1 and p.status = 'REQUIRES_ACTION' and p.provider_code = 'RD_SANDBOX'
            and exists (select 1 from public.payment_provider_intents bi where bi.payment_id = p.id and bi.sanitized_metadata->>'method' = 'BANK_TRANSFER')`,
        [userId],
      );
      if ((open?.n ?? 0) >= security.bankTransferMaxOpenOrders)
        throw conflict('BANK_TRANSFER_LIMIT', 'Ya tienes transferencias pendientes de confirmar. Paga o cancela una antes de crear otra.');
    }

    const address = await this.buyerAddress(userId, input.addressId);
    if (!address || checkoutAddressVersion(address) !== input.addressVersion) throw addressChanged();
    // Earlier card/PayPal attempts the buyer abandoned must not block the new checkout.
    await this.payments.releaseAbandoned(userId);

    // Live shipping options are fetched before the transaction (external API calls).
    const preCart = await this.carts.getCart(userId);
    if (!preCart.groups.length) throw conflict('CART_EMPTY', 'Tu carrito está vacío.');
    if ((await this.destinationBlocks(preCart.groups, address.country_code)).size) throw destinationUnavailable();
    const optionsBySeller = await this.groupOptions(preCart.id, preCart.groups, address, preCart.currency);
    for (const g of preCart.groups) {
      const code = input.shipping?.[g.sellerId];
      if (!code || !optionsBySeller.get(g.sellerId)!.options.some((o) => o.code === code)) throw shippingUnavailable();
    }
    const freeSellerIds = preCart.groups.filter((g: any) => input.shipping[g.sellerId] === SELLER_FREE_SHIPPING).map((g: any) => g.sellerId);

    // Shipping was quoted for exactly these lines; the transaction must bill the same cart.
    const quotedCart = cartSignature(preCart.groups.flatMap((g: any) => g.items.map((i: any) => ({ sellerId: g.sellerId, variantId: i.variantId, quantity: i.quantity }))));

    const checkoutId = await this.db.tx(async (c) => {
      const corr = randomUUID();
      const cart = await this.carts.ensureMutableCart(userId, c);
      // Wait for concurrent edits, then use the already validated address only if it is still current.
      const currentAddress = await this.buyerAddress(userId, input.addressId, c);
      if (!currentAddress || checkoutAddressVersion(currentAddress) !== input.addressVersion) throw addressChanged();

      const expiresAt = new Date(Date.now() + (input.paymentMethod === 'BANK_TRANSFER' ? security.bankTransferReserveHours * 60 : ONLINE_PAYMENT_TTL_MIN) * 60_000);
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
                ci.dimension_unit, p.category_id, csg.id as seller_group_id,
                coalesce(p.tax_class, (select cat.tax_class from public.categories cat where cat.id = p.category_id), 'STANDARD') as tax_class
           from public.checkout_items ci
           join public.products p on p.id = ci.product_id
           join public.checkout_seller_groups csg on csg.checkout_session_id = ci.checkout_session_id and csg.seller_id = ci.seller_id
          where ci.checkout_session_id = $1 order by ci.created_at, ci.id`,
        [sessionId],
        c,
      );
      if (cartSignature(items.map((i: any) => ({ sellerId: i.seller_id, variantId: i.variant_id, quantity: i.quantity }))) !== quotedCart)
        throw conflict('CART_CHANGED', 'Tu carrito cambió mientras confirmabas el pedido. Revisa el resumen e inténtalo de nuevo.');

      // A promotion can change after the quote, and the checkout snapshot can reprice a cart line.
      const freeLines = items.filter((item) => freeSellerIds.includes(item.seller_id));
      const freePolicies = await freeShippingPolicies(this.db, freeLines.map((item) => item.product_id), c);
      for (const sellerId of freeSellerIds) {
        const lines = freeLines.filter((item) => item.seller_id === sellerId);
        const subtotal = lines.reduce((sum, item) => sum + toMinor(item.unit_price) * BigInt(item.quantity), 0n);
        if (!qualifiesForFreeShipping(freePolicies, lines.map((item) => ({ productId: item.product_id, requiresShipping: item.requires_shipping })),
          address.country_code, currency, subtotal)) throw shippingUnavailable();
      }
      if (freeSellerIds.length) {
        const groups = preCart.groups.filter((group: any) => freeSellerIds.includes(group.sellerId));
        if ((await this.destinationBlocks(groups, address.country_code, c)).size) throw destinationUnavailable();
      }

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

      // ---- the origins the order ships from must be the ones the buyer's shipping price was quoted for
      for (const sellerId of new Set(allocations.map((a) => a.item.seller_id as string))) {
        const actual = new Set(allocations.filter((a) => a.item.seller_id === sellerId).map((a) => a.shipFrom));
        const quoted = optionsBySeller.get(sellerId)?.origins ?? [];
        if (actual.size !== quoted.length || quoted.some((o) => !o.id || !actual.has(o.id)))
          throw conflict('SHIPPING_ORIGIN_CHANGED', 'El almacén desde el que se despacha uno de tus productos cambió. Revisa el envío y el total e inténtalo de nuevo.');
      }

      // ---- packages, quotes and selected rate per group
      const shippingBySeller = new Map<string, Minor>();
      const chargedOrigins = new Set<string>();
      const taxInfo = await this.tax.forDestination(address.country_code, address.region, c);
      const shippingLines: ShippingTaxLine[] = [];
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

        // Shipping was quoted per physical origin (see groupOptions): each origin is charged its own
        // rate for the chosen method, once, even when several locations share that ship-from address.
        const opt = optionsBySeller.get(sellerId)!;
        const shipFrom = groupAllocs[0].shipFrom;
        const origin = opt.origins.find((o) => o.id === shipFrom)!;
        const originOptions = origin.options;
        const chosen = originOptions.find((o) => o.code === input.shipping![sellerId])!;
        const firstGroupOfOrigin = !chargedOrigins.has(`${sellerId}:${shipFrom}`);
        chargedOrigins.add(`${sellerId}:${shipFrom}`);
        // The stored shipping is tax-exclusive; its tax (when the country taxes shipping) is kept per group.
        const shipSplit = shippingTax(taxInfo, firstGroupOfOrigin ? toMinor(chosen.amount) : 0n);
        const charge = shipSplit.amount;
        shippingLines.push({ groupId, sellerId, amount: charge, tax: shipSplit.tax, rate: shipSplit.rate });
        const quoteIds = new Map<string, string>();
        for (const provider of Array.from(new Set(originOptions.map((o) => o.provider)))) {
          const qid: string = (await this.db.one(
            `select public.create_shipping_quote_request($1,$2,$3,$4,$5,null,$6::jsonb,$7) as id`,
            [sessionId, groupId, plan!.id, provider, `${input.idempotencyKey}:quote:${groupId}:${provider}`,
             JSON.stringify({ provider, destination: { city: address.city, region: address.region, postal_code: address.postal_code, country: address.country_code }, package: pkg }), corr],
            c,
          ))!.id;
          quoteIds.set(provider, qid);
        }
        let chosenRateId: string | null = null;
        for (const o of originOptions) {
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
           JSON.stringify({ option_code: chosen.code, provider: chosen.provider, provider_rate_id: chosen.providerRateId, charged_on_first_group_of_origin: firstGroupOfOrigin, ship_from_address_id: shipFrom }), corr],
          c,
        );
        shippingBySeller.set(sellerId, (shippingBySeller.get(sellerId) ?? 0n) + charge);
      }

      // ---- authoritative financial calculation
      // ---- store coupons: validated against the billed lines and reserved for this checkout
      const promo = await this.coupons.evaluate(
        input.coupons ?? [],
        items.map((i: any) => ({ key: i.id, sellerId: i.seller_id, productId: i.product_id, gross: toMinor(i.unit_price) * BigInt(i.quantity) })),
        userId,
        c,
      );
      if (promo.errors.length) throw badRequest('COUPON_INVALID', `${promo.errors[0].code}: ${promo.errors[0].message}`);
      const reserved: (CouponResult & { reservationId: string })[] = [];
      for (const r of promo.results) {
        try {
          const res = await this.db.one(`select public.reserve_promotion_code_for_checkout($1,$2,$3,$4,$5,$6) as id`, [sessionId, userId, r.code, expiresAt, `${input.idempotencyKey}:promo:${r.code}`, corr], c);
          reserved.push({ ...r, reservationId: res!.id });
        } catch (e: any) {
          const m = String(e?.message ?? '');
          throw badRequest('COUPON_INVALID', `${r.code}: ${/LIMIT_REACHED/.test(m) ? 'el cupón ya alcanzó su límite de usos.' : /CUSTOMER_LIMIT/.test(m) ? 'ya usaste este cupón el máximo de veces permitido.' : /NOT_ACTIVE/.test(m) ? 'el cupón no está vigente.' : 'el cupón no se pudo aplicar.'}`);
        }
      }

      await this.calculate(c, sessionId, currency, items, shippingBySeller, corr, address.country_code, reserved, userId, shippingLines, address);

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
      // The amount charged must be the one the buyer accepted (address, origins, shipping, tax, coupons).
      if (input.quotedTotal != null && toMinor(input.quotedTotal) !== toMinor(pay!.amount))
        throw conflict('CHECKOUT_TOTAL_CHANGED', 'El total de tu pedido cambió mientras lo confirmabas. Revisa el resumen e inténtalo de nuevo.');

      if (online) {
        const ref = await this.db.one(
          `select cs.public_number, u.email::text as email from public.checkout_sessions cs join public.users u on u.id = cs.customer_id where cs.id = $1`,
          [sessionId],
          c,
        );
        await this.payments.startProviderPayment(c, {
          paymentId, checkoutId: sessionId, provider: online.code, amount: pay!.amount, currency: pay!.currency_code,
          customerEmail: ref?.email, reference: `NX-CHK-${ref?.public_number ?? ''}`, corr,
          userId, saveCard: input.paymentMethod === 'CARD' && !!input.saveCard, savedCardId: input.paymentMethod === 'CARD' ? input.savedCardId : undefined,
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
    if (result.orderId) {
      this.mail.fire(() => this.mail.orderConfirmed(result.orderId!));
      this.stripeTax.fire(result.orderId);
    }
    else if (result.bankTransfer && result.paymentId) this.mail.fire(() => this.mail.transferInstructions(result.paymentId, result.bankTransfer!));
    return result;
  }

  /** Writes calculation run + immutable snapshots + commission evidence, then finalizes. */
  private async calculate(c: PoolClient, sessionId: string, currency: string, items: any[], shippingBySeller: Map<string, Minor>, corr: string, destinationCountry: string,
    coupons: (CouponResult & { reservationId: string })[] = [], customerId?: string, shippingLines: ShippingTaxLine[] = [], address?: any) {
    const taxInfo = await this.tax.forDestination(destinationCountry, address?.region, c);
    const taxEvidence = {
      code: taxInfo.taxName, rate: taxInfo.rate, reducedRate: taxInfo.reducedRate, country: destinationCountry, region: taxInfo.regionCode ?? null,
      source: taxInfo.regionCode ? 'marketplace_tax_region_rates' : 'marketplace_tax_rates',
      pricesIncludeTax: taxInfo.pricesIncludeTax, appliesToShipping: taxInfo.appliesToShipping,
    };
    const dec = await this.db.one(`select decimal_places from public.currencies where code = $1`, [currency], c);
    const rev = await this.db.one(`select coalesce(max(revision),0)+1 as r from public.checkout_calculation_runs where checkout_session_id = $1`, [sessionId], c);
    const run = await this.db.one(
      `insert into public.checkout_calculation_runs (checkout_session_id, revision, currency_code, calculation_engine_version, correlation_id)
       values ($1,$2,$3,$4,$5) returning id`,
      [sessionId, rev!.r, currency, ENGINE, corr],
      c,
    );
    const runId = run!.id;
    // Store coupons (funded by the store): discount per checkout item.
    const discountOf = new Map<string, { amount: Minor; coupon: CouponResult & { reservationId: string } }>();
    for (const cp of coupons) for (const al of cp.allocations) discountOf.set(al.key, { amount: al.discount, coupon: cp });
    const lines: (LineCalc & { item: any; rule: CommissionRule | null; base: Minor; referral: Minor })[] = [];
    for (const it of items) {
      // Listed price and coupon are what the buyer sees; in tax-inclusive countries they are
      // converted to tax-exclusive amounts so commission and seller earnings never include tax.
      const lt = lineTax(taxInfo, normalizeTaxClass(it.tax_class), toMinor(it.unit_price), it.quantity, discountOf.get(it.id)?.amount ?? 0n);
      const { unit, gross, discount, net } = lt;
      const rule = await this.commissionRule(c, it.seller_id, it.category_id, it.product_id, it.variant_id);
      const com = this.computeCommission(rule, gross, net);
      lines.push({
        key: it.id, sellerId: it.seller_id, quantity: it.quantity, unit, gross, discount, net,
        tax: lt.tax, taxRate: lt.rate, taxClass: lt.taxClass, commission: com.amount, commissionRaw: com.raw, entitlement: net - com.amount,
        item: it, rule, base: com.base, referral: 0n,
      });
    }
    // Stripe Tax (e.g. US sales tax): exact tax per line and per shipping group for the address.
    let stripeCalculationId: string | null = null;
    if (taxInfo.calculationProvider === 'STRIPE_TAX' && address) {
      const r = await this.stripeTax.calculate(currency, address, [
        ...lines.map((l) => ({ reference: l.key, amount: l.net, quantity: l.quantity, taxClass: l.taxClass })),
        ...shippingLines.map((x) => ({ reference: `ship:${x.groupId}`, amount: x.amount, shipping: true })),
      ]);
      stripeCalculationId = r.id;
      const eff = (t: Minor, b: Minor) => (b > 0n ? (Number((t * 1_000_000n) / b) / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : '0');
      for (const l of lines) {
        l.tax = r.byRef.get(l.key) ?? 0n;
        l.taxRate = eff(l.tax, l.net);
      }
      for (const x of shippingLines) {
        x.tax = r.byRef.get(`ship:${x.groupId}`) ?? 0n;
        x.rate = eff(x.tax, x.amount);
      }
    }
    // Affiliate commission (funded by the store): per store, when the buyer came through an affiliate link.
    const referrals: { sellerId: string; r: NonNullable<Awaited<ReturnType<AffiliatesService['forCheckout']>>> }[] = [];
    if (customerId)
      for (const sellerId of [...new Set(lines.map((l) => l.sellerId))]) {
        const r = await this.affiliates.forCheckout(c, customerId, sellerId, lines.filter((l) => l.sellerId === sellerId).map((l) => ({ key: l.key, productId: l.item.product_id, net: l.net })));
        if (!r) continue;
        referrals.push({ sellerId, r });
        for (const x of r.items) lines.find((l) => l.key === x.itemId)!.referral = x.commission;
      }
    for (const l of lines) {
      const promo = discountOf.get(l.key);
      await this.db.exec(
        `insert into public.checkout_item_financial_snapshots (calculation_run_id, checkout_session_id, checkout_item_id, seller_id,
                 quantity, unit_price, gross_amount, discount_amount, product_net_amount, taxable_amount, tax_amount,
                 platform_commission_amount, referral_commission_amount, processor_fee_estimate_allocated, seller_product_entitlement,
                 currency_code, calculation_breakdown)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,0,$13,$14,$15::jsonb)`,
        [runId, sessionId, l.key, l.sellerId, l.quantity, fromMinor(l.unit), fromMinor(l.gross), fromMinor(l.discount), fromMinor(l.net), fromMinor(l.tax),
         fromMinor(l.commission), fromMinor(l.referral), fromMinor(l.entitlement), currency,
         JSON.stringify({
           engine: ENGINE, tax: { ...taxEvidence, rate: l.taxRate, taxClass: l.taxClass, base: fromMinor(l.net), amount: fromMinor(l.tax) }, commission_rule_version_id: l.rule?.versionId ?? null,
           ...(promo ? { promotion: { platformFunded: '0', sellerFunded: fromMinor(l.discount), applications: [{ code: promo.coupon.code, ruleVersionId: promo.coupon.ruleVersionId, discount: fromMinor(l.discount) }] } } : {}),
           ...(l.referral > 0n ? { referral: { commission: fromMinor(l.referral), fundingSource: 'SELLER' } } : {}),
         })],
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
    for (const cp of coupons) {
      // Stored discounts are the snapshot (tax-exclusive) amounts, so they reconcile with the items.
      const stored = (key: string, listed: Minor) => lines.find((l) => l.key === key)?.discount ?? listed;
      const allocations = cp.allocations.map((a) => ({ itemId: a.key, discount: fromMinor(stored(a.key, a.discount)), sellerFunded: fromMinor(stored(a.key, a.discount)), platformFunded: '0' }));
      const cpDiscount = cp.allocations.reduce((acc, a) => acc + stored(a.key, a.discount), 0n);
      await this.db.exec(
        `insert into public.checkout_promotion_applications (calculation_run_id, checkout_session_id, promotion_code_reservation_id, promotion_code_id,
                 business_rule_version_id, discount_amount, platform_funded_amount, seller_funded_amount, other_funded_amount, currency_code, application_snapshot)
         values ($1,$2,$3,$4,$5,$6,0,$6,0,$7,$8::jsonb)`,
        [runId, sessionId, cp.reservationId, cp.codeId, cp.ruleVersionId, fromMinor(cpDiscount), currency,
         JSON.stringify({ engine: 'CUSTOMER_PROMOTION_1', component: 'PRODUCT', code: cp.code, sellerId: cp.sellerId,
           rule: { groupId: cp.ruleGroupId, ruleVersionId: cp.ruleVersionId, fundingSource: 'SELLER' },
           discount: fromMinor(cpDiscount), sellerFunded: fromMinor(cpDiscount), platformFunded: '0', allocations })],
        c,
      );
    }
    for (const { r } of referrals)
      await this.db.exec(
        `insert into public.checkout_referral_applications (calculation_run_id, checkout_session_id, referral_attribution_id, program_id, referrer_id,
                 status, eligible_amount, commission_estimate, currency_code, eligibility_snapshot)
         values ($1,$2,$3,$4,$5,'ELIGIBLE',$6,$7,$8,$9::jsonb)`,
        [runId, sessionId, r.attributionId, r.programId, r.referrerId, fromMinor(r.eligible), fromMinor(r.commission), currency, JSON.stringify(r.snapshot)],
        c,
      );
    const bySeller = new Map<string, typeof lines>();
    for (const l of lines) {
      if (!bySeller.has(l.sellerId)) bySeller.set(l.sellerId, []);
      bySeller.get(l.sellerId)!.push(l);
    }
    const G = { gross: 0n, disc: 0n, net: 0n, ship: 0n, tax: 0n, com: 0n, ref: 0n, ent: 0n, total: 0n };
    for (const [sellerId, ls] of bySeller) {
      const sum = (f: (l: (typeof lines)[number]) => Minor) => ls.reduce((a, l) => a + f(l), 0n);
      const gross = sum((l) => l.gross);
      const disc = sum((l) => l.discount);
      const net = sum((l) => l.net);
      const shipTax = shippingLines.filter((x) => x.sellerId === sellerId).reduce((a, x) => a + x.tax, 0n);
      const tax = sum((l) => l.tax) + shipTax;
      const com = sum((l) => l.commission);
      const ref = sum((l) => l.referral);
      const ent = sum((l) => l.entitlement);
      const ship = shippingBySeller.get(sellerId) ?? 0n;
      const total = net + ship + tax;
      await this.db.exec(
        `insert into public.checkout_seller_financial_snapshots (calculation_run_id, checkout_session_id, seller_id,
                 product_gross_amount, discount_total, product_net_amount, shipping_amount, tax_amount, customer_fee_amount,
                 platform_commission_total, referral_commission_total, processor_fee_estimate_allocated, seller_entitlement_estimate,
                 customer_total, currency_code, calculation_breakdown)
         values ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,0,$11,$12,$13,$14::jsonb)`,
        [runId, sessionId, sellerId, fromMinor(gross), fromMinor(disc), fromMinor(net), fromMinor(ship), fromMinor(tax), fromMinor(com), fromMinor(ref), fromMinor(ent),
         fromMinor(total), currency, JSON.stringify({ engine: ENGINE, tax: { ...taxEvidence, shippingTax: fromMinor(shipTax) }, ...(disc > 0n ? { coupon: coupons.find((x) => x.sellerId === sellerId)?.code } : {}) })],
        c,
      );
      G.gross += gross; G.disc += disc; G.net += net; G.ship += ship; G.tax += tax; G.com += com; G.ref += ref; G.ent += ent; G.total += total;
    }
    // When shipping carries tax, the order keeps the per-group evidence the refund engine needs
    // to return that tax proportionally (tax-versioned refunds: snapshots + shippingLines).
    const hasShippingTax = shippingLines.some((x) => x.tax > 0n);
    const globalTax = {
      ...taxEvidence,
      ...(stripeCalculationId ? { provider: 'STRIPE_TAX', stripeCalculationId } : {}),
      ...(hasShippingTax
        ? {
            snapshots: lines.map((l) => ({ checkoutItemId: l.key, taxClass: l.taxClass, rate: l.taxRate, base: fromMinor(l.net), amount: fromMinor(l.tax) })),
            shippingLines: shippingLines.map((x) => ({
              fulfillmentGroupId: x.groupId, sellerId: x.sellerId, base: fromMinor(x.amount), rate: x.rate, amount: fromMinor(x.tax),
              evidence: { calculationReference: `${runId}:${x.groupId}` },
            })),
          }
        : {}),
    };
    await this.db.exec(
      `insert into public.checkout_financial_snapshots (calculation_run_id, checkout_session_id, product_gross_amount, discount_total,
               product_net_amount, shipping_total, tax_total, customer_fee_total, grand_total, platform_commission_total,
               referral_commission_total, processor_fee_estimate, seller_entitlement_estimate_total, currency_code, calculation_breakdown)
       values ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,0,$11,$12,$13::jsonb)`,
      [runId, sessionId, fromMinor(G.gross), fromMinor(G.disc), fromMinor(G.net), fromMinor(G.ship), fromMinor(G.tax), fromMinor(G.total), fromMinor(G.com),
       fromMinor(G.ref), fromMinor(G.ent), currency, JSON.stringify({ engine: ENGINE, tax: globalTax })],
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

