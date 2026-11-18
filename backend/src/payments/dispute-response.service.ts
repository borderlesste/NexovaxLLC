import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { orderRef } from '../common/refs';
import { RequestUser } from '../auth/auth';
import { StripeService } from './stripe.service';
import { PaypalService } from './paypal.service';

export type EvidenceFileKind = 'RECEIPT' | 'SHIPPING' | 'COMMUNICATION' | 'OTHER';
export interface EvidenceFile { buffer: Buffer; originalname: string; mimetype: string; size: number; kind: EvidenceFileKind }
export interface DisputeAnswer {
  productDescription?: string;
  note: string;
  carrier?: string;
  trackingNumber?: string;
  shippingDate?: string;
}

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
const STRIPE_FIELD: Record<EvidenceFileKind, 'receipt' | 'shipping_documentation' | 'customer_communication' | 'uncategorized_file'> = {
  RECEIPT: 'receipt', SHIPPING: 'shipping_documentation', COMMUNICATION: 'customer_communication', OTHER: 'uncategorized_file',
};
/** PayPal carrier codes for the carriers NEXOVAX ships with; anything else goes as OTHER + name. */
const PAYPAL_CARRIER: Record<string, string> = { USPS: 'USPS', UPS: 'UPS', FEDEX: 'FEDEX', DHL: 'DHL', DHL_EXPRESS: 'DHL', CANADA_POST: 'CANADA_POST' };

/**
 * Answering a dispute from NEXOVAX: the order's own data (customer, address, carrier, tracking,
 * delivery) is assembled automatically; the admin adds a note and documents, and NEXOVAX sends
 * the evidence to Stripe or PayPal — or accepts the dispute. Every attempt is recorded.
 */
@Injectable()
export class DisputeResponseService {
  constructor(
    private readonly db: DbService,
    private readonly stripe: StripeService,
    private readonly paypal: PaypalService,
  ) {}

  private async incident(id: string) {
    const i = await this.db.one(
      `select i.*, i.amount::text as amount, d.status as dispute_status, d.provider_status as dispute_provider_status, d.external_charge_id
         from public.nx_payment_incidents i left join public.payment_disputes d on d.id = i.dispute_id where i.id = $1`,
      [id],
    );
    if (!i || i.kind !== 'DISPUTE') throw notFound('Disputa');
    return i;
  }

  /** Whether the processor is still waiting for the store's answer. */
  private open(i: any) {
    if (i.status !== 'OPEN') return false;
    // Already answered: wait for the processor (a new PayPal request for evidence clears this).
    if (i.provider_status === 'under_review' || /evidence sent$/.test(i.provider_status ?? '')) return false;
    if (i.provider_code === 'STRIPE') return ['needs_response', 'warning_needs_response'].includes(i.dispute_provider_status);
    return /WAITING_FOR_SELLER_RESPONSE|OPEN/.test(i.provider_status ?? '') && !/RESOLVED/.test(i.provider_status ?? '');
  }

  /** Everything NEXOVAX knows about the order, ready to send as evidence. */
  async draft(id: string) {
    const i = await this.incident(id);
    const o = await this.db.one(
      `select o.public_number, o.placed_at, o.paid_at, coalesce(up.display_name, u.email::text) as customer_name, u.email::text as customer_email,
              a.recipient_name, a.line1, a.line2, a.city, a.region, a.postal_code, a.country_code
         from public.orders o join public.users u on u.id = o.customer_id left join public.user_profiles up on up.user_id = u.id
         left join lateral (select * from public.order_address_snapshots x where x.order_id = o.id and x.address_type = 'SHIPPING' limit 1) a on true
        where o.id = $1`,
      [i.order_id],
    );
    const items = await this.db.many(
      `select p.title, oi.quantity::int as qty from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = $1 order by oi.created_at`,
      [i.order_id],
    );
    const ships = await this.db.many(
      `select coalesce(sh.actual_carrier_name, sh.actual_carrier_code, st.carrier_code) as carrier, st.carrier_code, st.tracking_number, st.tracking_url,
              sh.shipped_at, coalesce(st.delivered_at, sh.delivered_at) as delivered_at, st.current_status,
              (select json_agg(json_build_object('at', e.event_at, 'status', e.normalized_status, 'detail', e.status_detail, 'city', e.location_city) order by e.event_at)
                 from public.tracking_events e where e.tracking_id = st.id) as events
         from public.shipments sh left join public.shipment_trackings st on st.shipment_id = sh.id
        where sh.order_id = $1 and sh.status <> 'CANCELLED' order by sh.created_at`,
      [i.order_id],
    );
    const messages = (await this.db.one<{ n: number }>(
      `select count(*)::int as n from public.conversation_messages m join public.conversations c on c.id = m.conversation_id where c.order_id = $1`,
      [i.order_id],
    ).catch(() => ({ n: 0 })))!.n;
    const history = await this.db.many(
      `select r.action, r.status, r.evidence, r.files, r.error, r.submitted_at, coalesce(up.display_name, u.email::text) as by
         from public.nx_dispute_responses r left join public.users u on u.id = r.submitted_by left join public.user_profiles up on up.user_id = u.id
        where r.incident_id = $1 order by r.submitted_at desc`,
      [id],
    );
    const addr = o ? [o.recipient_name, o.line1, o.line2, [o.city, o.region, o.postal_code].filter(Boolean).join(', '), o.country_code].filter(Boolean).join(', ') : '';
    const s0 = ships.find((s: any) => s.tracking_number) ?? ships[0];
    return {
      incidentId: id, provider: i.provider_code, environment: i.environment, disputeId: i.external_id, reason: i.reason, dueBy: i.due_by, amount: i.amount, currency: i.currency_code,
      canRespond: this.open(i),
      order: o && { number: orderRef(o.public_number), placedAt: o.placed_at, customerName: o.customer_name, customerEmail: o.customer_email, shippingAddress: addr },
      items, shipments: ships, messages,
      suggested: {
        productDescription: items.map((x: any) => `${x.qty} × ${x.title}`).join('; ').slice(0, 1000),
        carrier: s0?.carrier ?? '', trackingNumber: s0?.tracking_number ?? '', shippingDate: s0?.shipped_at ? new Date(s0.shipped_at).toISOString().slice(0, 10) : '',
        delivered: !!s0?.delivered_at, deliveredAt: s0?.delivered_at ?? null,
      },
      history: history.map((h: any) => ({ action: h.action, status: h.status, note: h.evidence?.note ?? null, files: h.files, error: h.error, at: h.submitted_at, by: h.by })),
    };
  }

  private validateFiles(files: EvidenceFile[]) {
    if (files.length > 4) throw badRequest('EVIDENCE_TOO_MANY_FILES', 'Adjunta como máximo 4 archivos.');
    const total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files) {
      if (!ALLOWED.includes(f.mimetype)) throw badRequest('EVIDENCE_FILE_TYPE', 'Solo se aceptan PDF, JPG o PNG.');
      if (f.size > 4 * 1024 * 1024) throw badRequest('EVIDENCE_FILE_SIZE', 'Cada archivo puede pesar hasta 4 MB.');
    }
    if (total > 4.5 * 1024 * 1024) throw badRequest('EVIDENCE_TOTAL_SIZE', 'Entre todos los archivos no pueden pasar de 4,5 MB.');
  }

  /** Sends the evidence to the processor (the dispute moves to review). */
  async respond(user: RequestUser, id: string, a: DisputeAnswer, files: EvidenceFile[]) {
    const i = await this.incident(id);
    if (!this.open(i)) throw conflict('DISPUTE_NOT_AWAITING_RESPONSE', 'Esta disputa ya no espera respuesta de la tienda.');
    const note = a.note?.trim() ?? '';
    if (note.length < 20 || note.length > 5000) throw badRequest('EVIDENCE_NOTE', 'Explica lo ocurrido en 20 a 5000 caracteres.');
    this.validateFiles(files);
    const d = await this.draft(id);
    const ev = {
      note, productDescription: (a.productDescription?.trim() || d.suggested.productDescription).slice(0, 1000),
      carrier: (a.carrier?.trim() || d.suggested.carrier).slice(0, 80), trackingNumber: (a.trackingNumber?.trim() || d.suggested.trackingNumber).slice(0, 80),
      shippingDate: (a.shippingDate?.trim() || d.suggested.shippingDate).slice(0, 10),
    };
    const fileMeta = files.map((f) => ({ name: f.originalname.slice(0, 120), type: f.mimetype, size: f.size, kind: f.kind }));
    try {
      let ref: string;
      if (i.provider_code === 'STRIPE') {
        const e: Record<string, string> = {
          customer_name: d.order?.customerName ?? '', customer_email_address: d.order?.customerEmail ?? '', shipping_address: d.order?.shippingAddress ?? '',
          product_description: ev.productDescription, uncategorized_text: note,
          ...(ev.carrier ? { shipping_carrier: ev.carrier } : {}), ...(ev.trackingNumber ? { shipping_tracking_number: ev.trackingNumber } : {}),
          ...(/^\d{4}-\d{2}-\d{2}$/.test(ev.shippingDate) ? { shipping_date: ev.shippingDate } : {}),
        };
        for (const f of files) {
          const up = await this.stripe.uploadDisputeFile(f.buffer, f.originalname, f.mimetype);
          const field = STRIPE_FIELD[f.kind];
          if (e[field]) e.uncategorized_file = up.id; else e[field] = up.id;
        }
        ref = (await this.stripe.submitDisputeEvidence(i.external_id, e as any)).id;
      } else {
        const code = (ev.carrier || '').toUpperCase().replace(/[^A-Z]/g, '_');
        const tracking = ev.trackingNumber ? [{ carrier_name: PAYPAL_CARRIER[code] ?? 'OTHER', ...(PAYPAL_CARRIER[code] ? {} : { carrier_name_other: ev.carrier || 'OTHER' }), tracking_number: ev.trackingNumber }] : [];
        const r = await this.paypal.provideDisputeEvidence(i.external_id, {
          evidences: [{ evidence_type: tracking.length ? 'PROOF_OF_FULFILLMENT' : 'OTHER', ...(tracking.length ? { evidence_info: { tracking_info: tracking } } : {}), notes: `${note}\n\n${ev.productDescription}`.slice(0, 2000) }],
        }, files.map((f) => ({ data: f.buffer, name: f.originalname, type: f.mimetype })));
        ref = r?.links?.[0]?.href ?? i.external_id;
      }
      await this.record(user, id, 'RESPOND', ev, fileMeta, 'SUBMITTED', ref, null);
      await this.db.exec(`update public.nx_payment_incidents set provider_status = $2, updated_at = now() where id = $1`, [id, i.provider_code === 'STRIPE' ? 'under_review' : `${i.provider_status ?? ''} · evidence sent`.slice(0, 60)]);
      return { ok: true };
    } catch (e: any) {
      await this.record(user, id, 'RESPOND', ev, fileMeta, 'FAILED', null, String(e?.raw?.message ?? e?.message ?? e).slice(0, 300));
      throw conflict('DISPUTE_RESPONSE_FAILED', `El procesador no aceptó la respuesta: ${String(e?.raw?.message ?? e?.message ?? e).slice(0, 200)}`);
    }
  }

  /** Accepts the dispute: the customer keeps the money and the loss is booked when the processor closes it. */
  async accept(user: RequestUser, id: string, note: string) {
    const i = await this.incident(id);
    if (!this.open(i)) throw conflict('DISPUTE_NOT_AWAITING_RESPONSE', 'Esta disputa ya no espera respuesta de la tienda.');
    if (!note?.trim() || note.trim().length < 5) throw badRequest('EVIDENCE_NOTE', 'Indica el motivo (mínimo 5 caracteres).');
    try {
      const ref = i.provider_code === 'STRIPE' ? (await this.stripe.closeDispute(i.external_id)).id : ((await this.paypal.acceptClaim(i.external_id, note.trim()))?.links?.[0]?.href ?? i.external_id);
      await this.record(user, id, 'ACCEPT', { note: note.trim() }, [], 'SUBMITTED', ref, null);
      return { ok: true };
    } catch (e: any) {
      await this.record(user, id, 'ACCEPT', { note: note.trim() }, [], 'FAILED', null, String(e?.raw?.message ?? e?.message ?? e).slice(0, 300));
      throw conflict('DISPUTE_RESPONSE_FAILED', `El procesador no aceptó la respuesta: ${String(e?.raw?.message ?? e?.message ?? e).slice(0, 200)}`);
    }
  }

  private record(user: RequestUser, id: string, action: string, evidence: object, files: object[], status: string, ref: string | null, error: string | null) {
    return this.db.exec(
      `insert into public.nx_dispute_responses (incident_id, action, evidence, files, status, provider_reference, error, submitted_by) values ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8)`,
      [id, action, JSON.stringify(evidence), JSON.stringify(files), status, ref, error, user.id],
    );
  }
}
