import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { AppError } from '../common/errors';

const API = 'https://api.goshippo.com';

export interface ShippoAddress {
  name: string;
  company?: string | null;
  street1: string;
  street2?: string | null;
  city: string;
  state?: string | null;
  zip?: string | null;
  country: string;
  phone?: string | null;
  email?: string | null;
}

export interface ShippoParcel {
  length: string;
  width: string;
  height: string;
  distance_unit: 'cm' | 'in';
  weight: string;
  mass_unit: 'kg' | 'lb';
}

export interface ShippoRate {
  object_id: string;
  provider: string;
  provider_image_75?: string;
  servicelevel: { name: string; token: string; terms?: string };
  amount: string;
  currency: string;
  amount_local: string;
  currency_local: string;
  estimated_days: number | null;
  duration_terms?: string;
  attributes: string[];
  carrier_account: string;
}

export interface ShippoCustomsItem {
  description: string;
  quantity: number;
  net_weight: string;
  mass_unit: 'kg';
  value_amount: string;
  value_currency: string;
  origin_country: string;
}

/** Normalized Shippo tracking statuses → our tracking_events.normalized_status. */
export const SHIPPO_STATUS: Record<string, string> = {
  PRE_TRANSIT: 'PRE_TRANSIT',
  TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  RETURNED: 'RETURNED',
  FAILURE: 'FAILURE',
  UNKNOWN: 'UNKNOWN',
};

/** Thin, typed client for the Shippo REST API (https://docs.goshippo.com). */
@Injectable()
export class ShippoService {
  private readonly logger = new Logger(ShippoService.name);

  get enabled() {
    return !!config.shippoApiKey;
  }

  get testMode() {
    return !!config.shippoApiKey?.startsWith('shippo_test_');
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 25_000): Promise<T> {
    if (!config.shippoApiKey) throw new AppError('SHIPPING_PROVIDER_NOT_CONFIGURED', 'Shippo no está configurado.', HttpStatus.SERVICE_UNAVAILABLE);
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${API}${path}`, {
          method,
          headers: { Authorization: `ShippoToken ${config.shippoApiKey}`, 'Content-Type': 'application/json', 'Shippo-API-Version': '2018-02-08' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (res.ok) return data as T;
        lastErr = `${res.status} ${text.slice(0, 400)}`;
        if (res.status !== 429 && res.status < 500) break;
      } catch (e: any) {
        lastErr = e?.message ?? String(e);
      }
      await new Promise((r) => setTimeout(r, 700 * attempt));
    }
    this.logger.warn(`Shippo ${method} ${path} failed: ${lastErr}`);
    throw new AppError('SHIPPING_PROVIDER_ERROR', 'El proveedor de envíos no respondió. Inténtalo de nuevo.', HttpStatus.BAD_GATEWAY, { provider: lastErr.slice(0, 300) });
  }

  /** Creates a Shippo shipment and returns its live rates. */
  async shipment(from: ShippoAddress, to: ShippoAddress, parcel: ShippoParcel, opts: { customsDeclarationId?: string; reference?: string } = {}) {
    const s = await this.call<any>('POST', '/shipments/', {
      address_from: from,
      address_to: to,
      parcels: [parcel],
      customs_declaration: opts.customsDeclarationId,
      metadata: opts.reference?.slice(0, 100),
      async: false,
    });
    return {
      shipmentId: s.object_id as string,
      status: s.status as string,
      rates: (s.rates ?? []) as ShippoRate[],
      messages: ((s.messages ?? []) as any[]).map((m) => `${m.source ?? ''}: ${m.text ?? ''}`.trim()).filter((m) => !/doesn't support one or more shipment options/i.test(m)),
    };
  }

  async customsDeclaration(input: { signer: string; items: ShippoCustomsItem[]; reference?: string }) {
    const d = await this.call<any>('POST', '/customs/declarations/', {
      contents_type: 'MERCHANDISE',
      non_delivery_option: 'RETURN',
      certify: true,
      certify_signer: input.signer.slice(0, 35),
      eel_pfc: 'NOEEI_30_37_a',
      incoterm: 'DDU',
      items: input.items,
      metadata: input.reference?.slice(0, 100),
    });
    return d.object_id as string;
  }

  /** Buys a label for a rate. */
  async buyLabel(rateId: string, reference?: string) {
    const t = await this.call<any>('POST', '/transactions/', { rate: rateId, label_file_type: config.shippoLabelFormat, async: false, metadata: reference?.slice(0, 100) }, 45_000);
    return {
      transactionId: t.object_id as string,
      status: t.status as string, // SUCCESS | ERROR | QUEUED | WAITING
      trackingNumber: (t.tracking_number as string) || null,
      trackingUrl: (t.tracking_url_provider as string) || null,
      labelUrl: (t.label_url as string) || null,
      commercialInvoiceUrl: (t.commercial_invoice_url as string) || null,
      messages: ((t.messages ?? []) as any[]).map((m) => m.text ?? String(m)),
      rate: t.rate,
    };
  }

  async rate(rateId: string) {
    return this.call<ShippoRate>('GET', `/rates/${encodeURIComponent(rateId)}`);
  }

  /** Current tracking status and history for a carrier/tracking number. */
  async track(carrier: string, trackingNumber: string) {
    const t = await this.call<any>('GET', `/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`);
    return normalizeTrack(t);
  }

  /** Registers a tracking number so Shippo sends `track_updated` webhooks for it. */
  async registerTrack(carrier: string, trackingNumber: string, metadata?: string) {
    const t = await this.call<any>('POST', '/tracks/', { carrier, tracking_number: trackingNumber, metadata: metadata?.slice(0, 100) });
    return normalizeTrack(t);
  }
}

export interface NormalizedTrackEvent {
  status: string; // normalized (IN_TRANSIT, DELIVERED…)
  providerStatus: string;
  substatus: string | null;
  detail: string;
  at: string;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  objectId: string | null;
}

export function normalizeTrack(t: any) {
  const ev = (e: any): NormalizedTrackEvent => ({
    status: SHIPPO_STATUS[e?.status] ?? 'UNKNOWN',
    providerStatus: e?.status ?? 'UNKNOWN',
    substatus: e?.substatus?.code ?? null,
    detail: e?.status_details || e?.substatus?.text || e?.status || '',
    at: e?.status_date || e?.object_updated || new Date().toISOString(),
    city: e?.location?.city ?? null,
    region: e?.location?.state ?? null,
    postalCode: e?.location?.zip ?? null,
    country: e?.location?.country ?? null,
    objectId: e?.object_id ?? null,
  });
  return {
    carrier: t?.carrier as string,
    trackingNumber: t?.tracking_number as string,
    eta: (t?.eta as string) ?? null,
    current: t?.tracking_status ? ev(t.tracking_status) : null,
    history: ((t?.tracking_history ?? []) as any[]).map(ev),
  };
}
