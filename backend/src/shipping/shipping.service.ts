import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { SettingsService } from '../settings/settings.service';
import { AppError, conflict, notFound } from '../common/errors';
import { fromMinor, toMinor } from '../common/money';
import { NormalizedTrackEvent, ShippoAddress, ShippoParcel, ShippoService } from './shippo.service';

export const SHIPPO = 'SHIPPO';
export const MARKETPLACE = 'MARKETPLACE';

/** One option the buyer can choose for a seller group. */
export interface ShippingOption {
  code: string; // SHIPPO:<servicelevel token> | FLAT:<code> | PICKUP
  provider: 'SHIPPO' | 'MARKETPLACE';
  carrierCode: string;
  carrierName: string;
  serviceToken: string;
  serviceName: string;
  description: string;
  amount: string; // in checkout currency
  currency: string;
  estimatedDays: number | null;
  providerRateId: string | null;
  providerShipmentId: string | null;
  providerAmount: string | null;
  providerCurrency: string | null;
  attributes: string[];
  carrierLogo: string | null;
}

export interface OriginAddress {
  id: string;
  contact_name: string;
  company_name: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  phone: string | null;
}

export interface DestinationAddress {
  recipient_name: string;
  company_name?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postal_code?: string | null;
  country_code: string;
  phone?: string | null;
}

export interface Parcel {
  weightKg: string;
  length: string;
  width: string;
  height: string;
}

/** Manual carriers a seller can pick when not buying a Shippo label; `shippo` = Shippo carrier token for automatic tracking. */
export const CARRIERS: { code: string; name: string; shippo?: string }[] = [
  { code: 'USPS', name: 'USPS', shippo: 'usps' },
  { code: 'UPS', name: 'UPS', shippo: 'ups' },
  { code: 'FEDEX', name: 'FedEx', shippo: 'fedex' },
  { code: 'DHL_EXPRESS', name: 'DHL Express', shippo: 'dhl_express' },
  { code: 'CANADA_POST', name: 'Canada Post', shippo: 'canada_post' },
  { code: 'ROYAL_MAIL', name: 'Royal Mail', shippo: 'royal_mail' },
  { code: 'CORREOS', name: 'Correos (España)', shippo: 'correos' },
  { code: 'DEUTSCHE_POST', name: 'Deutsche Post', shippo: 'deutsche_post' },
  { code: 'ESTAFETA', name: 'Estafeta' },
  { code: 'SERVIENTREGA', name: 'Servientrega' },
  { code: 'VIMENCA', name: 'Vimenca Courier' },
  { code: 'OWN_DELIVERY', name: 'Entrega propia del vendedor' },
  { code: 'PICKUP', name: 'Retiro en tienda' },
  { code: 'OTHER', name: 'Otra transportadora' },
];

const RATE_TTL_MS = 20 * 60_000;
const MAX_SHIPPO_OPTIONS = 6;

/**
 * Shipping options, labels and tracking.
 * - Live carrier rates from Shippo when enabled and the route is served.
 * - Marketplace flat rates (settings `shipping.rates`) as fallback.
 * - Store pickup when origin and destination are in the same country.
 */
@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);
  private readonly cache = new Map<string, { at: number; options: ShippingOption[]; messages: string[] }>();

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly shippo: ShippoService,
  ) {}

  get shippoEnabled() {
    return this.shippo.enabled;
  }

  static parcelFor(items: { weight_value?: any; weight_unit?: string; length_value?: any; width_value?: any; height_value?: any; dimension_unit?: string; qty: number }[]): Parcel {
    let weight = 0;
    let length = 0, width = 0, height = 0;
    for (const a of items) {
      const w = a.weight_value ? Number(a.weight_value) * (a.weight_unit === 'g' ? 0.001 : a.weight_unit === 'lb' ? 0.4536 : a.weight_unit === 'oz' ? 0.02835 : 1) : 0.5;
      weight += w * a.qty;
      const f = a.dimension_unit === 'mm' ? 0.1 : a.dimension_unit === 'm' ? 100 : a.dimension_unit === 'in' ? 2.54 : 1;
      length = Math.max(length, a.length_value ? Number(a.length_value) * f : 30);
      width = Math.max(width, a.width_value ? Number(a.width_value) * f : 20);
      height += (a.height_value ? Number(a.height_value) * f : 10) * a.qty;
    }
    return { weightKg: Math.max(weight, 0.1).toFixed(3), length: length.toFixed(1), width: width.toFixed(1), height: Math.min(Math.max(height, 1), 200).toFixed(1) };
  }

  static toShippoAddress(a: OriginAddress | DestinationAddress, email?: string | null): ShippoAddress {
    const o = a as any;
    return {
      name: (o.contact_name ?? o.recipient_name ?? '').slice(0, 64),
      company: o.company_name ?? undefined,
      street1: o.line1,
      street2: o.line2 ?? undefined,
      city: o.city,
      state: o.region ?? undefined,
      zip: o.postal_code ?? undefined,
      country: o.country_code,
      phone: o.phone ?? undefined,
      email: email ?? undefined,
    };
  }

  static shippoParcel(p: Parcel): ShippoParcel {
    return { length: p.length, width: p.width, height: p.height, distance_unit: 'cm', weight: p.weightKg, mass_unit: 'kg' };
  }

  async originFor(sellerId: string, c?: PoolClient): Promise<OriginAddress | null> {
    return this.db.one<OriginAddress>(
      `select id, contact_name, company_name, line1, line2, city, region, postal_code, country_code, phone
         from public.seller_ship_from_addresses where seller_id = $1 and status = 'ACTIVE' order by is_default desc, created_at limit 1`,
      [sellerId],
      c,
    );
  }

  private cacheKey(origin: OriginAddress, dest: DestinationAddress, parcel: Parcel, currency: string) {
    return createHash('sha256')
      .update(JSON.stringify([origin.id, origin.line1, origin.postal_code, origin.country_code, dest.line1, dest.line2, dest.city, dest.region, dest.postal_code, dest.country_code, parcel, currency]))
      .digest('hex');
  }

  /** All options for one seller group, cheapest first (pickup last). */
  async options(origin: OriginAddress | null, dest: DestinationAddress | null, parcel: Parcel, currency: string): Promise<{ options: ShippingOption[]; messages: string[]; liveRates: boolean }> {
    const messages: string[] = [];
    let live: ShippingOption[] = [];
    const shippoOn = this.shippo.enabled && (await this.settings.get('shipping.shippo_enabled'));
    if (shippoOn && origin && dest) {
      const key = this.cacheKey(origin, dest, parcel, currency);
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < RATE_TTL_MS) {
        live = hit.options;
        messages.push(...hit.messages);
      } else {
        try {
          const s = await this.shippo.shipment(ShippingService.toShippoAddress(origin), ShippingService.toShippoAddress(dest), ShippingService.shippoParcel(parcel));
          live = s.rates
            .map((r): ShippingOption | null => {
              const amount = r.currency === currency ? r.amount : r.currency_local === currency ? r.amount_local : null;
              if (amount == null) return null;
              return {
                code: `SHIPPO:${r.servicelevel.token}`,
                provider: 'SHIPPO',
                carrierCode: r.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
                carrierName: r.provider,
                serviceToken: r.servicelevel.token,
                serviceName: `${r.provider} ${r.servicelevel.name}`.trim(),
                description: r.duration_terms || (r.estimated_days ? `${r.estimated_days} días` : ''),
                amount: fromMinor(toMinor(amount)),
                currency,
                estimatedDays: r.estimated_days ?? null,
                providerRateId: r.object_id,
                providerShipmentId: s.shipmentId,
                providerAmount: r.amount,
                providerCurrency: r.currency,
                attributes: r.attributes ?? [],
                carrierLogo: r.provider_image_75 ?? null,
              };
            })
            .filter((x): x is ShippingOption => !!x)
            .sort((a, b) => Number(a.amount) - Number(b.amount));
          // keep the cheapest per service and cap the list
          const seen = new Set<string>();
          live = live.filter((o) => (seen.has(o.code) ? false : (seen.add(o.code), true))).slice(0, MAX_SHIPPO_OPTIONS);
          if (!live.length && s.messages.length) messages.push(...s.messages.slice(0, 3));
          this.cache.set(key, { at: Date.now(), options: live, messages: [...messages] });
          if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
        } catch (e: any) {
          this.logger.warn(`Shippo rates unavailable: ${e?.message}`);
          messages.push('Tarifas en vivo no disponibles en este momento.');
        }
      }
    }
    const out: ShippingOption[] = [...live];
    const flat = (await this.settings.get('shipping.rates')) ?? [];
    for (const r of flat) {
      if (r.code === 'PICKUP') continue;
      if (live.length) break; // carrier rates available: flat rates are only a fallback
      out.push({
        code: `FLAT:${r.code}`,
        provider: 'MARKETPLACE',
        carrierCode: 'SELLER_ARRANGED',
        carrierName: 'NEXOVAX',
        serviceToken: r.code,
        serviceName: r.name,
        description: r.description,
        amount: fromMinor(toMinor(r.amount)),
        currency,
        estimatedDays: r.estimated_days ?? null,
        providerRateId: null,
        providerShipmentId: null,
        providerAmount: null,
        providerCurrency: null,
        attributes: [],
        carrierLogo: null,
      });
    }
    const pickup = flat.find((r) => r.code === 'PICKUP');
    if (pickup && origin && (!dest || dest.country_code === origin.country_code))
      out.push({
        code: 'PICKUP',
        provider: 'MARKETPLACE',
        carrierCode: 'PICKUP',
        carrierName: 'Retiro en tienda',
        serviceToken: 'PICKUP',
        serviceName: pickup.name,
        description: `${pickup.description} (${origin.city})`,
        amount: fromMinor(toMinor(pickup.amount)),
        currency,
        estimatedDays: pickup.estimated_days ?? 1,
        providerRateId: null,
        providerShipmentId: null,
        providerAmount: null,
        providerCurrency: null,
        attributes: [],
        carrierLogo: null,
      });
    if (live.length) {
      live[0].attributes = Array.from(new Set([...live[0].attributes, 'CHEAPEST']));
      const fastest = [...live].sort((a, b) => (a.estimatedDays ?? 99) - (b.estimatedDays ?? 99))[0];
      fastest.attributes = Array.from(new Set([...fastest.attributes, 'FASTEST']));
    }
    return { options: out, messages, liveRates: live.length > 0 };
  }

  // ------------------------------------------------------------------ labels

  /**
   * Buys a Shippo label for a shipment that is READY_TO_SHIP. Re-quotes the
   * shipment (with a customs declaration for international routes) so the
   * rate is fresh, preferring the service the buyer paid for.
   */
  async buyLabel(shipmentId: string) {
    const s = await this.db.one(
      `select sh.id, sh.order_id, sh.seller_id, sh.status, o.public_number, osg.service_token, osg.carrier_rate_amount::text as paid_amount,
              osg.currency_code, osg.shipping_provider_code
         from public.shipments sh join public.orders o on o.id = sh.order_id
         join public.order_shipping_groups osg on osg.id = sh.order_shipping_group_id
        where sh.id = $1`,
      [shipmentId],
    );
    if (!s) throw notFound('Envío');
    if (!['READY_TO_SHIP', 'LABEL_CREATED'].includes(s.status)) throw conflict('SHIPMENT_NOT_READY_FOR_LABEL', 'El envío no está listo para generar etiqueta.');
    const existing = await this.db.one(`select id from public.shipping_labels where shipment_id = $1 and status = 'PURCHASED'`, [shipmentId]);
    if (existing) return { labelId: existing.id, alreadyPurchased: true };

    const from = await this.db.one(`select * from public.shipment_address_snapshots where shipment_id = $1 and address_type = 'FROM'`, [shipmentId]);
    const to = await this.db.one(`select * from public.shipment_address_snapshots where shipment_id = $1 and address_type = 'TO'`, [shipmentId]);
    const pkg = await this.db.one(`select * from public.shipment_packages where shipment_id = $1 order by package_sequence limit 1`, [shipmentId]);
    if (!from || !to || !pkg) throw conflict('SHIPMENT_INCOMPLETE', 'Faltan datos del envío (direcciones o paquete).');
    const parcel: Parcel = {
      weightKg: (pkg.weight_unit === 'kg' ? Number(pkg.weight_value) : Number(pkg.weight_value) * 0.4536).toFixed(3),
      length: Number(pkg.length_value).toFixed(1),
      width: Number(pkg.width_value).toFixed(1),
      height: Number(pkg.height_value).toFixed(1),
    };
    const sellerEmail = from.email ?? (await this.db.one(
      `select coalesce(ssp.support_email, u.email::text) as email from public.sellers s join public.users u on u.id = s.owner_user_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id where s.id = $1`,
      [s.seller_id],
    ))?.email;
    const fromAddr = ShippingService.toShippoAddress({ ...from, contact_name: from.recipient_name } as any, sellerEmail);
    const toAddr = ShippingService.toShippoAddress(to as any, to.email);
    let customsId: string | undefined;
    if (from.country_code !== to.country_code) {
      const items = await this.db.many(
        `select coalesce(ois.product_title, 'Merchandise') as title, spi.quantity::int as qty, oifs.unit_price::text as unit_price,
                oi.currency_code, v.weight_value, v.weight_unit
           from public.shipment_package_items spi join public.order_items oi on oi.id = spi.order_item_id
           left join public.order_item_snapshots ois on ois.order_item_id = oi.id
           left join public.order_item_financial_snapshots oifs on oifs.order_item_id = oi.id
           left join public.product_variants v on v.id = oi.variant_id
          where spi.shipment_id = $1`,
        [shipmentId],
      );
      customsId = await this.shippo.customsDeclaration({
        signer: from.recipient_name || 'Seller',
        reference: `NX-${s.public_number}`,
        items: items.map((i) => ({
          description: String(i.title).slice(0, 100),
          quantity: i.qty,
          net_weight: (i.weight_value ? Number(i.weight_value) * (i.weight_unit === 'g' ? 0.001 : i.weight_unit === 'lb' ? 0.4536 : 1) : 0.5).toFixed(3),
          mass_unit: 'kg' as const,
          value_amount: Number(i.unit_price ?? 0).toFixed(2),
          value_currency: i.currency_code,
          origin_country: from.country_code,
        })),
      });
    }
    const quote = await this.shippo.shipment(fromAddr, toAddr, ShippingService.shippoParcel(parcel), { customsDeclarationId: customsId, reference: `NX-${s.public_number}` });
    if (!quote.rates.length)
      throw new AppError('SHIPPING_NO_RATES', 'La transportadora no ofrece servicio para esta ruta en este momento.', HttpStatus.CONFLICT, { messages: quote.messages.slice(0, 3) });
    const rate = quote.rates.find((r) => r.servicelevel.token === s.service_token) ?? [...quote.rates].sort((a, b) => Number(a.amount) - Number(b.amount))[0];

    const corr = randomUUID();
    const labelId: string = (await this.db.one(`select public.request_shipping_label($1,'SHIPPO',$2,$3,null,$4) as id`, [shipmentId, rate.object_id, `label:${shipmentId}:${rate.object_id}`, corr]))!.id;
    const tx = await this.shippo.buyLabel(rate.object_id, `NX-${s.public_number}`).catch(async (e) => {
      await this.failLabel(labelId, 'PROVIDER_ERROR', e?.details?.provider ?? e?.message);
      throw e;
    });
    if (tx.status !== 'SUCCESS' || !tx.trackingNumber) {
      await this.failLabel(labelId, 'LABEL_REJECTED', tx.messages.join(' | ') || tx.status);
      throw new AppError('SHIPPING_LABEL_FAILED', `Shippo no pudo generar la etiqueta: ${tx.messages[0] ?? tx.status}`, HttpStatus.BAD_GATEWAY);
    }
    const carrierCode = rate.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    await this.db.tx(async (c) => {
      const trackingId: string = (await this.db.one(
        `select public.mark_shipping_label_purchased($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,null,$13,$14) as id`,
        [labelId, tx.transactionId, tx.status, rate.amount, rate.currency, carrierCode, rate.provider, rate.servicelevel.token,
         `${rate.provider} ${rate.servicelevel.name}`, tx.trackingNumber, tx.trackingUrl, 'PDF', tx.labelUrl, null],
        c,
      ))!.id;
      await this.db.exec(
        `update public.shipping_labels set provider_messages = $2::jsonb, commercial_invoice_asset_id = null where id = $1`,
        [labelId, JSON.stringify({ commercial_invoice_url: tx.commercialInvoiceUrl, shippo_shipment_id: quote.shipmentId, test: this.shippo.testMode })],
        c,
      );
      await this.db.exec(
        `update public.shipments set provider_shipment_id = $2, metadata = coalesce(metadata,'{}'::jsonb) || $3::jsonb where id = $1`,
        [shipmentId, quote.shipmentId, JSON.stringify({ shippo_carrier: rate.provider.toLowerCase().replace(/\s+/g, '_'), label_url: tx.labelUrl })],
        c,
      );
      await this.db.exec(
        `update public.shipment_trackings set provider_tracking_id = $2 where id = $1`,
        [trackingId, this.shippoCarrierToken(rate.provider)],
        c,
      );
    });
    if (!this.shippo.testMode)
      this.shippo.registerTrack(this.shippoCarrierToken(rate.provider), tx.trackingNumber, shipmentId).catch(() => undefined);
    return { labelId, trackingNumber: tx.trackingNumber, labelUrl: tx.labelUrl, carrier: rate.provider, service: rate.servicelevel.name, cost: rate.amount, currency: rate.currency };
  }

  private shippoCarrierToken(provider: string) {
    const p = provider.toLowerCase();
    if (p.includes('dhl')) return 'dhl_express';
    if (p.includes('canada')) return 'canada_post';
    if (p.includes('fedex')) return 'fedex';
    if (p.includes('ups')) return 'ups';
    if (p.includes('usps')) return 'usps';
    return p.replace(/[^a-z0-9]+/g, '_');
  }

  private async failLabel(labelId: string, code: string, detail: string) {
    await this.db
      .exec(`update public.shipping_labels set status = 'FAILED', failed_at = now(), failure_code = $2, failure_detail = $3, updated_at = now() where id = $1 and status in ('REQUESTED','QUEUED')`,
        [labelId, code, String(detail ?? '').slice(0, 500)])
      .catch(() => undefined);
  }

  /** Registers a manually entered tracking number with Shippo when the carrier is supported (live mode). */
  async watchManualTracking(carrierCode: string, trackingNumber: string, shipmentId: string) {
    const carrier = CARRIERS.find((x) => x.code === carrierCode);
    if (!carrier?.shippo || !this.shippo.enabled || this.shippo.testMode) return;
    await this.db.exec(`update public.shipment_trackings set provider_tracking_id = $2 where shipment_id = $1 and tracking_number = $3`, [shipmentId, carrier.shippo, trackingNumber]);
    await this.shippo.registerTrack(carrier.shippo, trackingNumber, shipmentId).catch(() => undefined);
  }

  // ------------------------------------------------------------------ tracking

  /**
   * Pulls the latest tracking from Shippo for one shipment tracking row.
   * Test mode: Shippo cannot track real carriers, so the shipment advances
   * through Shippo's own test tracking numbers (PRE_TRANSIT → TRANSIT → DELIVERED).
   */
  async refreshTracking(trackingId: string): Promise<{ applied: number; delivered: boolean; status: string } | null> {
    const t = await this.db.one(
      `select st.id, st.shipment_id, st.carrier_code, st.tracking_number, st.current_status, st.provider_tracking_id, st.source_code, sh.order_id
         from public.shipment_trackings st join public.shipments sh on sh.id = st.shipment_id where st.id = $1`,
      [trackingId],
    );
    if (!t || !t.provider_tracking_id || ['DELIVERED', 'RETURNED'].includes(t.current_status)) return null;
    let track;
    if (this.shippo.testMode) {
      const next = t.current_status === 'PRE_TRANSIT' || t.current_status === 'UNKNOWN' ? 'SHIPPO_TRANSIT' : 'SHIPPO_DELIVERED';
      track = await this.shippo.track('shippo', next);
      // Shippo test events carry fixed past dates; stamp them now so the timeline stays ordered.
      const now = Date.now();
      const evs = [...track.history, ...(track.current ? [track.current] : [])];
      evs.forEach((e, i) => (e.at = new Date(now - (evs.length - i) * 1000).toISOString()));
      for (const e of evs) e.objectId = `test:${t.id}:${next}:${e.providerStatus}:${e.detail}`.slice(0, 200);
      track.history = evs;
      track.current = evs[evs.length - 1] ?? null;
    } else {
      track = await this.shippo.track(t.provider_tracking_id, t.tracking_number);
    }
    return this.applyTrack(t, track.history.length ? track.history : track.current ? [track.current] : []);
  }

  /** Applies normalized provider events to a tracking row (idempotent per provider event). */
  async applyTrack(t: { id: string; shipment_id: string; order_id: string }, events: NormalizedTrackEvent[]) {
    let applied = 0;
    let delivered = false;
    let last = 'UNKNOWN';
    const sorted = [...events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    await this.db.tx(async (c) => {
      for (const e of sorted) {
        const status = e.status === 'LABEL_CREATED' ? 'PRE_TRANSIT' : e.substatus === 'out_for_delivery' && e.status === 'IN_TRANSIT' ? 'OUT_FOR_DELIVERY' : e.status;
        const key = `shippo:${e.objectId ?? `${e.providerStatus}:${e.at}`}`;
        const dup = await this.db.one(`select 1 from public.tracking_events where tracking_id = $1 and deduplication_key = $2`, [t.id, key], c);
        if (dup) continue;
        await this.db.exec(
          `select public.apply_tracking_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,null,$13::jsonb)`,
          [t.id, key, status, e.at, e.providerStatus, e.substatus, e.detail?.trim() || null, e.city, e.region, e.postalCode,
           e.country && e.country.length === 2 ? e.country : null, e.objectId, JSON.stringify({ source: 'shippo' })],
          c,
        );
        applied++;
        last = status;
        if (status === 'DELIVERED') delivered = true;
      }
    });
    return { applied, delivered, status: last };
  }

  /** Trackings that still need provider updates (for the polling job). */
  pendingTrackings(limit = 50) {
    return this.db.many<{ id: string }>(
      `select st.id from public.shipment_trackings st join public.shipments sh on sh.id = st.shipment_id
        where st.provider_tracking_id is not null and st.current_status not in ('DELIVERED','RETURNED')
          and sh.status not in ('CANCELLED','DELIVERED')
        order by st.last_event_at nulls first limit $1`,
      [limit],
    );
  }
}
