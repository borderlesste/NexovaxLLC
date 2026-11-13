import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { SettingsService, ShippingRate } from '../settings/settings.service';
import { CartService } from '../cart/cart.service';
import { AppError, badRequest, conflict, notFound } from '../common/errors';
import { allocate, applyRate, fromMinor, Minor, toMinor } from '../common/money';
import { config } from '../config';
import { postSaleAllocation } from './sale-ledger';

const ENGINE = 'rd-checkout-1.0';
const SHIPPING_PROVIDER = 'RD_LOCAL';
const PAYMENT_PROVIDER = 'RD_SANDBOX';
const CHECKOUT_TTL_MIN = 60 * 72; // bank transfers may take up to 72 h to confirm

export type PaymentMethod = 'CARD' | 'BANK_TRANSFER';

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

  private async activeRates(): Promise<ShippingRate[]> {
    const rates = await this.settings.get('shipping.rates');
    return Array.isArray(rates) ? rates : [];
  }

  /** Price preview from the current cart (no writes). Used by the checkout screen. */
  async quote(userId: string, input: { shipping?: Record<string, string> }) {
    const cart = await this.carts.getCart(userId);
    if (!cart.groups.length) throw conflict('CART_EMPTY', 'Tu carrito está vacío.');
    const rates = await this.activeRates();
    const taxRate = String(await this.settings.get('tax.itbis_rate'));
    const lines = await this.db.many(
      `select ci.variant_id, ci.seller_id, ci.product_id, p.category_id from public.cart_items ci
         join public.products p on p.id = ci.product_id
        where ci.cart_id = $1 and ci.status = 'ACTIVE'`,
      [cart.id],
    );
    const meta = new Map(lines.map((l: any) => [l.variant_id, l]));
    const groups = [];
    let totals = { subtotal: 0n, shipping: 0n, tax: 0n };
    for (const g of cart.groups) {
      const items = g.items.filter((i: any) => i.purchasable);
      let subtotal = 0n;
      let tax = 0n;
      for (const i of items) {
        const net = toMinor(i.unitPrice) * BigInt(i.quantity);
        subtotal += net;
        tax += applyRate(net, taxRate);
        void meta;
      }
      const code = input.shipping?.[g.sellerId] ?? rates[0]?.code;
      const rate = rates.find((r) => r.code === code) ?? rates[0];
      const shipping = rate ? toMinor(rate.amount) : 0n;
      totals.subtotal += subtotal;
      totals.shipping += shipping;
      totals.tax += tax;
      groups.push({
        ...g,
        items,
        rates,
        selectedRate: rate?.code ?? null,
        subtotal: fromMinor(subtotal),
        shipping: fromMinor(shipping),
        tax: fromMinor(tax),
        total: fromMinor(subtotal + shipping + tax),
      });
    }
    return {
      currency: cart.currency,
      groups,
      itbisRate: Number(taxRate),
      subtotal: fromMinor(totals.subtotal),
      shipping: fromMinor(totals.shipping),
      tax: fromMinor(totals.tax),
      total: fromMinor(totals.subtotal + totals.shipping + totals.tax),
      paymentMethods: [
        { code: 'CARD', name: 'Tarjeta de crédito / débito', available: true, sandbox: config.paymentEnvironment === 'TEST' },
        { code: 'PAYPAL', name: 'PayPal', available: false, reason: 'Disponible cuando se configure la cuenta PayPal del marketplace.' },
        { code: 'BANK_TRANSFER', name: 'Transferencia bancaria', available: true },
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
    if (prior) return this.resultFor(prior.id);

    if (input.paymentMethod === 'CARD') this.validateSandboxCard(input.card);
    else if (input.paymentMethod !== 'BANK_TRANSFER')
      throw badRequest('PAYMENT_METHOD_UNAVAILABLE', 'Método de pago no disponible.');

    const checkoutId = await this.db.tx(async (c) => {
      const corr = randomUUID();
      const cart = await this.carts.ensureMutableCart(userId, c);
      const address = await this.db.one(
        `select * from public.addresses where id = $1 and user_id = $2 and deleted_at is null`,
        [input.addressId, userId],
        c,
      );
      if (!address) throw badRequest('CHECKOUT_SHIPPING_ADDRESS_REQUIRED', 'Selecciona una dirección de envío válida.');

      const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MIN * 60_000);
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
         values ($1,$2,'SHIPPING',$3,$4,$5,$6,$7,$8,$9,$10,$11, jsonb_build_object('city_id', $12::text, 'label', $13::text))`,
        [sessionId, address.id, address.recipient_name, address.line1, address.line2, address.city, address.region,
         address.postal_code, address.country_code, address.phone, address.company_name, address.city_id, address.label],
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
      const rates = await this.activeRates();
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
        const pkg = this.packageFor(groupAllocs);
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

        const quoteId: string = (await this.db.one(
          `select public.create_shipping_quote_request($1,$2,$3,$4,$5,null,$6::jsonb,$7) as id`,
          [sessionId, groupId, plan!.id, SHIPPING_PROVIDER, `${input.idempotencyKey}:quote:${groupId}`,
           JSON.stringify({ provider: SHIPPING_PROVIDER, destination_city: address.city, package: pkg }), corr],
          c,
        ))!.id;

        const chosenCode = input.shipping?.[sellerId] ?? rates[0]?.code;
        const chosen = rates.find((r) => r.code === chosenCode);
        if (!chosen) throw badRequest('SHIPPING_RATE_INVALID', 'Selecciona un método de envío válido.');
        let chosenRateId: string | null = null;
        for (const r of rates) {
          const ro = await this.db.one(
            `insert into public.shipping_rate_options (quote_request_id, fulfillment_group_id, seller_id, shipping_provider_code,
                     provider_rate_id, carrier_code, carrier_name, service_token, service_name, provider_amount,
                     provider_currency_code, checkout_currency_amount, checkout_currency_code, estimated_days, duration_terms,
                     expires_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$11,$12,$13, now() + interval '3 days') returning id`,
            [quoteId, groupId, sellerId, SHIPPING_PROVIDER, `${SHIPPING_PROVIDER}:${r.code}:${groupId}`,
             r.code === 'PICKUP' ? 'PICKUP' : 'RD_EXPRESS', r.code === 'PICKUP' ? 'Retiro en tienda' : 'RD Express',
             r.code, r.name, fromMinor(toMinor(r.amount)), currency, r.estimated_days, r.description],
            c,
          );
          if (r.code === chosen.code) chosenRateId = ro!.id;
        }
        await this.db.exec(
          `update public.shipping_quote_requests set status = 'READY', completed_at = now(), expires_at = now() + interval '3 days' where id = $1`,
          [quoteId],
          c,
        );
        await this.db.exec(
          `select public.select_checkout_shipping_rate($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
          [sessionId, groupId, chosenRateId, fromMinor(toMinor(chosen.amount)), `${input.idempotencyKey}:ship:${groupId}`, userId,
           JSON.stringify({ rate_code: chosen.code, source: 'shipping.rates setting' }), corr],
          c,
        );
        shippingBySeller.set(sellerId, (shippingBySeller.get(sellerId) ?? 0n) + toMinor(chosen.amount));
      }

      // ---- authoritative financial calculation
      await this.calculate(c, sessionId, currency, items, shippingBySeller, corr);

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
        [PAYMENT_PROVIDER, config.paymentEnvironment],
        c,
      );
      if (!prov) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'El procesador de pagos no está disponible.', HttpStatus.SERVICE_UNAVAILABLE);
      const paymentId: string = (await this.db.one(
        `select public.begin_checkout_payment($1,$2,$3,$4,$5,$6) as id`,
        [sessionId, userId, prov.cfg_id, prov.acc_id, `${input.idempotencyKey}:pay`, corr],
        c,
      ))!.id;
      const pay = await this.db.one(`select expected_amount::text as amount, currency_code from public.payments where id = $1`, [paymentId], c);

      if (input.paymentMethod === 'CARD') {
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

    return this.resultFor(checkoutId);
  }

  /** Writes calculation run + immutable snapshots + commission evidence, then finalizes. */
  private async calculate(c: PoolClient, sessionId: string, currency: string, items: any[], shippingBySeller: Map<string, Minor>, corr: string) {
    const taxRate = String(await this.settings.get('tax.itbis_rate', c));
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
         JSON.stringify({ engine: ENGINE, tax: { code: 'ITBIS', rate: taxRate, base: fromMinor(l.net) }, commission_rule_version_id: l.rule?.versionId ?? null })],
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
         fromMinor(total), currency, JSON.stringify({ engine: ENGINE, shipping_provider: SHIPPING_PROVIDER })],
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
       fromMinor(G.ent), currency, JSON.stringify({ engine: ENGINE, tax: { code: 'ITBIS', rate: taxRate } })],
      c,
    );
    await this.db.exec(`select public.finalize_checkout_calculation_run($1)`, [runId], c);
  }

  private packageFor(allocs: { item: any; qty: number }[]) {
    let weight = 0;
    let length = 0, width = 0, height = 0;
    for (const a of allocs) {
      const w = a.item.weight_value ? Number(a.item.weight_value) * (a.item.weight_unit === 'g' ? 0.001 : a.item.weight_unit === 'lb' ? 0.4536 : a.item.weight_unit === 'oz' ? 0.02835 : 1) : 0.5;
      weight += w * a.qty;
      const f = a.item.dimension_unit === 'mm' ? 0.1 : a.item.dimension_unit === 'm' ? 100 : a.item.dimension_unit === 'in' ? 2.54 : 1;
      length = Math.max(length, a.item.length_value ? Number(a.item.length_value) * f : 30);
      width = Math.max(width, a.item.width_value ? Number(a.item.width_value) * f : 20);
      height += (a.item.height_value ? Number(a.item.height_value) * f : 10) * a.qty;
    }
    return { weightKg: Math.max(weight, 0.1).toFixed(3), length: length.toFixed(1), width: width.toFixed(1), height: Math.min(Math.max(height, 1), 200).toFixed(1) };
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

  async resultFor(checkoutId: string) {
    const r = await this.db.one(
      `select cs.id, cs.public_number, cs.status, pay.id as payment_id, pay.public_number as payment_number, pay.status as payment_status,
              pay.expected_amount::text as amount, pay.currency_code, pay.order_id, o.public_number as order_number
         from public.checkout_sessions cs
         left join public.payments pay on pay.checkout_session_id = cs.id
         left join public.orders o on o.id = pay.order_id
        where cs.id = $1 order by pay.created_at desc nulls last limit 1`,
      [checkoutId],
    );
    if (!r) throw notFound('Compra');
    return {
      checkoutId: r.id,
      status: r.status,
      paymentId: r.payment_id,
      paymentStatus: r.payment_status,
      amount: r.amount,
      currency: r.currency_code,
      orderId: r.order_id,
      orderNumber: r.order_number ? `RD-${r.order_number}` : null,
      bankTransfer:
        r.payment_status === 'REQUIRES_ACTION'
          ? {
              reference: `RD-PAY-${r.payment_number}`,
              bank: 'Banco de Reservas (Banreservas)',
              accountName: 'RD Marketplace SRL',
              accountNumber: '960-123456-7',
              accountType: 'Cuenta corriente',
              instructions: 'Transfiere el monto exacto e incluye la referencia. Tu pedido se confirmará cuando validemos el pago (máx. 72 h).',
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
