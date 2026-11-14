import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { trackingLink } from '../common/tracking-links';
import { DbService } from '../db/db.service';
import { categoryForTemplate, NotificationsService } from '../notifications/notifications.service';
import { orderRef, paymentRef, payoutRef, refundRef, returnRef, ticketRef } from '../common/refs';
import { esc, ItemLine, itemsTable, itemsText, layout, Locale, money, p, Rendered, rows } from './mail.templates';

interface SendInput {
  template: string;
  dedupeKey: string;
  to: string;
  userId?: string | null;
  entityType?: string;
  entityId?: string | null;
  message: Rendered;
}

interface Contact {
  email: string;
  name: string;
  locale: Locale;
}

const RESEND_URL = 'https://api.resend.com/emails';
const loc = (v: unknown): Locale => (v === 'en' ? 'en' : 'es');
/** Picks the Spanish or English variant. */
const tr = (l: Locale) => (es: string, en: string) => (l === 'en' ? en : es);

/**
 * Transactional e-mail through Resend, in the recipient's language (users.locale).
 * - Every business event is sent at most once (`email_deliveries.dedupe_key`).
 * - Sending never breaks the business operation: callers fire-and-forget
 *   after their transaction commits and failures are only logged/recorded.
 * - Demo/seed domains are suppressed to protect the sender reputation.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {
    if (!config.resendApiKey) this.logger.warn('RESEND_API_KEY not configured: transactional e-mails are disabled.');
  }

  get enabled() {
    return !!config.resendApiKey;
  }

  /** Runs an e-mail job in the background; never throws. */
  fire(job: () => Promise<unknown>) {
    setImmediate(() => job().catch((e) => this.logger.error(`E-mail job failed: ${e?.message ?? e}`)));
  }

  async send(i: SendInput): Promise<'SENT' | 'FAILED' | 'SUPPRESSED' | 'SKIPPED' | 'DUPLICATE'> {
    // Every business e-mail also shows up in the bell; the e-mail itself respects the user's preferences.
    if (i.userId && i.message.notice)
      await this.notifications.fromEmail(i.userId, i.template, i.dedupeKey, i.message.notice, { type: i.entityType, id: i.entityId });
    if (i.userId && !(await this.notifications.enabled(i.userId, categoryForTemplate(i.template), 'EMAIL').catch(() => true))) return 'SKIPPED';
    const to = (config.mailRedirectTo ?? i.to).trim().toLowerCase();
    const domain = to.split('@')[1] ?? '';
    const status = !this.enabled ? 'SKIPPED' : config.mailSuppressDomains.includes(domain) ? 'SUPPRESSED' : 'PENDING';
    if (config.mailRedirectTo) i = { ...i, message: { ...i.message, subject: `[→ ${i.to}] ${i.message.subject}` } };
    const row = await this.db.one<{ id: string }>(
      `insert into public.email_deliveries (template_code, dedupe_key, to_email, user_id, entity_type, entity_id, subject, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (dedupe_key) do nothing returning id`,
      [i.template, i.dedupeKey, to, i.userId ?? null, i.entityType ?? null, i.entityId ?? null, i.message.subject, status],
    );
    if (!row) return 'DUPLICATE';
    if (status !== 'PENDING') return status;

    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': i.dedupeKey.slice(0, 256) },
          body: JSON.stringify({
            from: config.mailFrom,
            to: [to],
            subject: i.message.subject,
            html: i.message.html,
            text: i.message.text,
            reply_to: config.mailReplyTo,
            tags: [{ name: 'template', value: i.template.replace(/[^A-Za-z0-9_-]/g, '_') }],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        const body: any = await res.json().catch(() => ({}));
        if (res.ok) {
          await this.db.exec(
            `update public.email_deliveries set status = 'SENT', provider_message_id = $2, attempts = $3, sent_at = now(), last_error = null, updated_at = now() where id = $1`,
            [row.id, body?.id ?? null, attempt],
          );
          this.logger.log(`E-mail ${i.template} sent (${body?.id})`);
          return 'SENT';
        }
        lastError = `${res.status} ${body?.name ?? ''} ${body?.message ?? ''}`.trim();
        if (res.status !== 429 && res.status < 500) break;
      } catch (e: any) {
        lastError = e?.message ?? String(e);
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    await this.db.exec(`update public.email_deliveries set status = 'FAILED', attempts = attempts + 1, last_error = $2, updated_at = now() where id = $1`, [row.id, lastError.slice(0, 500)]);
    this.logger.warn(`E-mail ${i.template} failed: ${lastError}`);
    return 'FAILED';
  }

  private async userContact(userId: string): Promise<Contact | null> {
    const r = await this.db.one(
      `select u.email::text as email, u.locale, coalesce(nullif(up.first_name, ''), nullif(up.display_name, ''), split_part(u.email::text, '@', 1)) as name
         from public.users u left join public.user_profiles up on up.user_id = u.id where u.id = $1`,
      [userId],
    );
    return r ? { email: r.email, name: r.name, locale: loc(r.locale) } : null;
  }

  private async sellerContact(sellerId: string) {
    const r = await this.db.one(
      `select u.email::text as email, u.locale, coalesce(nullif(up.first_name, ''), nullif(up.display_name, ''), split_part(u.email::text, '@', 1)) as name,
              coalesce(ssp.display_name, s.slug) as store, s.owner_user_id
         from public.sellers s join public.users u on u.id = s.owner_user_id
         left join public.user_profiles up on up.user_id = u.id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where s.id = $1`,
      [sellerId],
    );
    return r ? { email: r.email as string, name: r.name as string, store: r.store as string, ownerUserId: r.owner_user_id as string, locale: loc(r.locale) } : null;
  }

  private async orderItems(orderId: string, sellerOrderId?: string): Promise<ItemLine[]> {
    const items = await this.db.many(
      `select coalesce(ois.product_title, 'Producto') as title, ois.variant_title, oi.quantity::int as quantity,
              coalesce(oifs.product_net_amount, 0)::text as total
         from public.order_items oi
         left join public.order_item_snapshots ois on ois.order_item_id = oi.id
         left join public.order_item_financial_snapshots oifs on oifs.order_item_id = oi.id
        where oi.order_id = $1 and ($2::uuid is null or oi.seller_order_id = $2) order by oi.created_at`,
      [orderId, sellerOrderId ?? null],
    );
    return items.map((r) => ({ title: r.title, variant: r.variant_title, quantity: r.quantity, total: r.total }));
  }

  // ------------------------------------------------------------------ account

  async welcome(userId: string) {
    const u = await this.userContact(userId);
    if (!u) return;
    const t = tr(u.locale);
    await this.send({
      template: 'WELCOME',
      dedupeKey: `welcome:${userId}`,
      to: u.email,
      userId,
      entityType: 'USER',
      entityId: userId,
      message: layout({
        locale: u.locale,
        subject: t('¡Bienvenido a NEXOVAX!', 'Welcome to NEXOVAX!'),
        preheader: t('Tu cuenta está lista. Descubre tiendas de todo el mundo.', 'Your account is ready. Discover stores from around the world.'),
        title: t(`¡Hola, ${u.name}!`, `Hi ${u.name}!`),
        body:
          p(t('Tu cuenta en <b>NEXOVAX</b> fue creada con éxito. Ya puedes comprar en múltiples tiendas con un solo carrito, guardar favoritos y seguir tus pedidos.',
              'Your <b>NEXOVAX</b> account is ready. Shop from multiple stores with a single cart, save favorites and track your orders.')) +
          p(t('¿Tienes un negocio? También puedes abrir tu tienda y vender a clientes de todo el mundo.', 'Own a business? Open your store and sell to customers worldwide.')),
        cta: { label: t('Explorar productos', 'Browse products'), url: `${config.webUrl}/catalogo` },
        text: t('Tu cuenta en NEXOVAX fue creada con éxito.', 'Your NEXOVAX account is ready.'),
      }),
    });
  }

  async emailVerification(userId: string, email: string, link: string) {
    const u = await this.userContact(userId);
    const l = u?.locale ?? 'es';
    const t = tr(l);
    await this.send({
      template: 'EMAIL_VERIFICATION',
      dedupeKey: `verify:${userId}:${randomUUID()}`,
      to: email,
      userId,
      entityType: 'USER',
      entityId: userId,
      message: layout({
        locale: l,
        subject: t('Confirma tu correo en NEXOVAX', 'Confirm your NEXOVAX e-mail'),
        preheader: t('Un paso más para activar tu cuenta.', 'One more step to activate your account.'),
        title: t(`¡Hola${u?.name ? `, ${u.name}` : ''}!`, `Hi${u?.name ? ` ${u.name}` : ''}!`),
        body:
          p(t('Gracias por registrarte en <b>NEXOVAX</b>. Confirma que este correo te pertenece para activar tu cuenta.',
              'Thanks for signing up to <b>NEXOVAX</b>. Confirm this e-mail belongs to you to activate your account.')) +
          p(`<span style="color:#64748b;font-size:13px">${t('El enlace solo puede usarse una vez y vence pronto. Si no creaste esta cuenta, ignora este correo.', 'The link can be used once and expires soon. If you didn’t create this account, ignore this e-mail.')}</span>`),
        cta: { label: t('Confirmar correo', 'Confirm e-mail'), url: link },
        text: t('Confirma tu correo para activar tu cuenta de NEXOVAX.', 'Confirm your e-mail to activate your NEXOVAX account.'),
      }),
    });
  }

  async passwordRecovery(userId: string | null, email: string, link: string) {
    const u = userId ? await this.userContact(userId) : null;
    const l = u?.locale ?? 'es';
    const t = tr(l);
    await this.send({
      template: 'PASSWORD_RECOVERY',
      dedupeKey: `recovery:${email.toLowerCase()}:${randomUUID()}`,
      to: email,
      userId,
      entityType: 'USER',
      entityId: userId,
      message: layout({
        locale: l,
        subject: t('Restablece tu contraseña de NEXOVAX', 'Reset your NEXOVAX password'),
        preheader: t('Usa este enlace para crear una nueva contraseña.', 'Use this link to create a new password.'),
        title: t('Restablecer contraseña', 'Reset your password'),
        body:
          p(t('Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón para crear una nueva.', 'We received a request to reset your password. Click the button to create a new one.')) +
          p(`<span style="color:#64748b;font-size:13px">${t('El enlace vence en 1 hora y solo puede usarse una vez. Si no fuiste tú, ignora este correo: tu contraseña no cambiará.', 'The link expires in 1 hour and can be used once. If this wasn’t you, ignore this e-mail: your password won’t change.')}</span>`),
        cta: { label: t('Crear nueva contraseña', 'Create a new password'), url: link },
        text: t('Recibimos una solicitud para restablecer tu contraseña. El enlace vence en 1 hora.', 'We received a request to reset your password. The link expires in 1 hour.'),
      }),
    });
  }

  // ------------------------------------------------------------------ orders

  /** Buyer confirmation + one "new sale" e-mail per seller. Call once the payment is captured. */
  async orderConfirmed(orderId: string) {
    const o = await this.db.one(
      `select o.id, o.public_number, o.customer_id, o.currency_code, ofs.product_net_amount::text as subtotal, ofs.shipping_total::text as shipping,
              ofs.tax_total::text as tax, ofs.grand_total::text as total, ofs.calculation_breakdown->'tax'->>'code' as tax_name,
              a.recipient_name, a.line1, a.line2, a.city, a.region, a.postal_code, a.country_code
         from public.orders o
         left join public.order_financial_snapshots ofs on ofs.order_id = o.id
         left join public.order_address_snapshots a on a.order_id = o.id and a.address_type = 'SHIPPING'
        where o.id = $1`,
      [orderId],
    );
    if (!o) return;
    const cur = o.currency_code;
    const u = await this.userContact(o.customer_id);
    const items = await this.orderItems(orderId);
    const ref = orderRef(o.public_number);
    if (u) {
      const l = u.locale;
      const t = tr(l);
      const country = countryName(o.country_code, l);
      const address = [o.recipient_name, o.line1, o.line2, [o.city, o.region, o.postal_code].filter(Boolean).join(', '), country].filter(Boolean);
      await this.send({
        template: 'ORDER_CONFIRMED',
        dedupeKey: `order-confirmed:${orderId}`,
        to: u.email,
        userId: o.customer_id,
        entityType: 'ORDER',
        entityId: orderId,
        message: layout({
          locale: l,
          subject: t(`Confirmamos tu pedido ${ref}`, `Your order ${ref} is confirmed`),
          preheader: t(`Total pagado ${money(o.total, cur, l)}. Te avisaremos cuando se envíe.`, `Total paid ${money(o.total, cur, l)}. We’ll let you know when it ships.`),
          title: t('¡Gracias por tu compra!', 'Thanks for your order!'),
          body:
            p(t(`Hola ${esc(u.name)}, recibimos el pago de tu pedido <b>${ref}</b>. Las tiendas ya fueron notificadas y te avisaremos cuando tus productos vayan en camino.`,
                `Hi ${esc(u.name)}, we received the payment for order <b>${ref}</b>. The stores have been notified and we’ll let you know when your items ship.`)) +
            itemsTable(items, cur, l) +
            rows(
              [
                [t('Subtotal', 'Subtotal'), esc(money(o.subtotal, cur, l))],
                [t('Envío', 'Shipping'), esc(money(o.shipping, cur, l))],
                [o.tax_name || t('Impuestos', 'Tax'), esc(money(o.tax, cur, l))],
                [t('Total pagado', 'Total paid'), esc(money(o.total, cur, l))],
              ],
              { boldLast: true },
            ) +
            (address.length ? p(`<b>${t('Dirección de entrega', 'Shipping address')}</b><br>${address.map(esc).join('<br>')}`) : ''),
          cta: { label: t('Ver mi pedido', 'View my order'), url: `${config.webUrl}/cuenta/pedidos/${orderId}` },
          text: `${t('Pedido', 'Order')} ${ref}\n\n${itemsText(items, cur, l)}\n\n${t('Total pagado', 'Total paid')}: ${money(o.total, cur, l)}`,
        }),
      });
    }

    const sellerOrders = await this.db.many(
      `select so.id, so.seller_id, sofs.product_net_amount::text as subtotal, sofs.platform_commission_total::text as commission,
              sofs.seller_entitlement_estimate::text as net
         from public.seller_orders so left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
        where so.order_id = $1`,
      [orderId],
    );
    for (const so of sellerOrders) {
      const s = await this.sellerContact(so.seller_id);
      if (!s) continue;
      const l = s.locale;
      const t = tr(l);
      const soItems = await this.orderItems(orderId, so.id);
      await this.send({
        template: 'SELLER_NEW_ORDER',
        dedupeKey: `seller-new-order:${so.id}`,
        to: s.email,
        userId: s.ownerUserId,
        entityType: 'SELLER_ORDER',
        entityId: so.id,
        message: layout({
          locale: l,
          subject: t(`Nueva venta en ${s.store}: pedido ${ref}`, `New sale at ${s.store}: order ${ref}`),
          preheader: t('Prepara el pedido para enviarlo lo antes posible.', 'Prepare the order so it ships as soon as possible.'),
          title: t('¡Tienes una nueva venta!', 'You have a new sale!'),
          body:
            p(t(`El pedido <b>${ref}</b> fue pagado y está listo para que lo prepares.`, `Order <b>${ref}</b> has been paid and is ready to be prepared.`)) +
            itemsTable(soItems, cur, l) +
            rows(
              [
                [t('Venta de productos', 'Product sales'), esc(money(so.subtotal, cur, l))],
                [t('Comisión de la plataforma', 'Platform commission'), esc(`− ${money(so.commission, cur, l)}`)],
                [t('Ingreso estimado', 'Estimated earnings'), esc(money(so.net, cur, l))],
              ],
              { boldLast: true },
            ) +
            p(t('El dinero queda disponible para retiro cuando el pedido sea entregado.', 'Funds become available for payout once the order is delivered.')),
          cta: { label: t('Gestionar pedido', 'Manage order'), url: `${config.webUrl}/vendedor/pedidos/${orderId}` },
          text: `${t('Pedido', 'Order')} ${ref}\n\n${itemsText(soItems, cur, l)}\n\n${t('Ingreso estimado', 'Estimated earnings')}: ${money(so.net, cur, l)}`,
        }),
      });
    }
  }

  /** Bank-transfer instructions right after checkout. */
  async transferInstructions(paymentId: string, bt: { reference: string; bank: string; accountName: string; accountNumber: string; routingOrSwift?: string | null; iban?: string | null; instructions: string }) {
    const pay = await this.db.one(`select p.customer_id, p.expected_amount::text as amount, p.currency_code from public.payments p where p.id = $1`, [paymentId]);
    if (!pay) return;
    const u = await this.userContact(pay.customer_id);
    if (!u) return;
    const l = u.locale;
    const t = tr(l);
    const amount = money(pay.amount, pay.currency_code, l);
    const details: Array<[string, string]> = [
      [t('Monto', 'Amount'), `<b>${esc(amount)}</b>`],
      [t('Referencia', 'Reference'), `<b>${esc(bt.reference)}</b>`],
      [t('Banco', 'Bank'), esc(bt.bank)],
      [t('Titular', 'Account holder'), esc(bt.accountName)],
      [t('Cuenta', 'Account'), esc(bt.accountNumber)],
    ];
    if (bt.routingOrSwift) details.push(['Routing / SWIFT', esc(bt.routingOrSwift)]);
    if (bt.iban) details.push(['IBAN', esc(bt.iban)]);
    await this.send({
      template: 'BANK_TRANSFER_PENDING',
      dedupeKey: `transfer-pending:${paymentId}`,
      to: u.email,
      userId: pay.customer_id,
      entityType: 'PAYMENT',
      entityId: paymentId,
      message: layout({
        locale: l,
        subject: t(`Completa tu pago por transferencia (${bt.reference})`, `Complete your bank transfer (${bt.reference})`),
        preheader: t(`Transfiere ${amount} con la referencia ${bt.reference}.`, `Transfer ${amount} using reference ${bt.reference}.`),
        title: t('Tu pedido está reservado', 'Your order is reserved'),
        body:
          p(t(`Hola ${esc(u.name)}, para confirmar tu compra realiza una transferencia por el monto exacto e incluye la referencia.`,
              `Hi ${esc(u.name)}, to confirm your purchase send a bank transfer for the exact amount and include the reference.`)) +
          rows(details) +
          p(esc(bt.instructions)),
        cta: { label: t('Ver mis pedidos', 'View my orders'), url: `${config.webUrl}/cuenta/pedidos` },
        text: `${t('Transfiere', 'Transfer')} ${amount} → ${bt.bank}, ${bt.accountNumber} (${bt.accountName}). ${t('Referencia', 'Reference')}: ${bt.reference}. ${bt.instructions}`,
      }),
    });
  }

  async transferRejected(paymentId: string, reason: string) {
    const pay = await this.db.one(`select customer_id, public_number, expected_amount::text as amount, currency_code from public.payments where id = $1`, [paymentId]);
    if (!pay) return;
    const u = await this.userContact(pay.customer_id);
    if (!u) return;
    const l = u.locale;
    const t = tr(l);
    const ref = paymentRef(pay.public_number);
    await this.send({
      template: 'BANK_TRANSFER_REJECTED',
      dedupeKey: `transfer-rejected:${paymentId}`,
      to: u.email,
      userId: pay.customer_id,
      entityType: 'PAYMENT',
      entityId: paymentId,
      message: layout({
        locale: l,
        subject: t(`No pudimos validar tu transferencia ${ref}`, `We couldn’t verify your transfer ${ref}`),
        preheader: t('Tu compra fue cancelada.', 'Your purchase was cancelled.'),
        title: t('Transferencia no validada', 'Transfer not verified'),
        body:
          p(t(`Hola ${esc(u.name)}, no pudimos validar la transferencia de <b>${esc(money(pay.amount, pay.currency_code, l))}</b> (referencia ${ref}), por lo que la compra fue cancelada.`,
              `Hi ${esc(u.name)}, we couldn’t verify the transfer of <b>${esc(money(pay.amount, pay.currency_code, l))}</b> (reference ${ref}), so the purchase was cancelled.`)) +
          p(`<b>${t('Motivo', 'Reason')}:</b> ${esc(reason || t('No especificado', 'Not specified'))}`),
        cta: { label: t('Contactar soporte', 'Contact support'), url: `${config.webUrl}/ayuda/reportar` },
        text: `${ref}: ${reason || ''}`,
      }),
    });
  }

  async sellerOrderShipped(sellerOrderId: string) {
    const list = await this.db.many(
      `select so.order_id, o.public_number, o.customer_id, o.currency_code, coalesce(ssp.display_name, s.slug) as store,
              sh.id as shipment_id, sh.actual_carrier_name as carrier, sh.actual_service_name as service, st.tracking_number, st.tracking_url, st.carrier_code, st.provider_tracking_id
         from public.seller_orders so join public.orders o on o.id = so.order_id
         join public.sellers s on s.id = so.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         join public.shipments sh on sh.seller_order_id = so.id and sh.status not in ('CANCELLED','READY_TO_SHIP','DRAFT')
         left join lateral (select * from public.shipment_trackings t where t.shipment_id = sh.id order by t.created_at desc limit 1) st on true
        where so.id = $1`,
      [sellerOrderId],
    );
    for (const r of list) {
      const u = await this.userContact(r.customer_id);
      if (!u) continue;
      const l = u.locale;
      const t = tr(l);
      const ref = orderRef(r.public_number);
      const items = await this.orderItems(r.order_id, sellerOrderId);
      const link = trackingLink(r);
      const tracking = link.url
        ? `<a href="${esc(link.url)}" style="color:#0a6cf5">${esc(r.tracking_number)}</a>${link.external ? ` <span style="color:#64748b;font-size:12px">(${esc(t('enlace externo', 'external link'))}: ${esc(link.host)})</span>` : ''}`
        : `<b>${esc(r.tracking_number ?? '—')}</b>`;
      await this.send({
        template: 'ORDER_SHIPPED',
        dedupeKey: `shipped:${r.shipment_id}`,
        to: u.email,
        userId: r.customer_id,
        entityType: 'SHIPMENT',
        entityId: r.shipment_id,
        message: layout({
          locale: l,
          subject: t(`Tu pedido ${ref} va en camino`, `Your order ${ref} is on its way`),
          preheader: t(`${r.store} despachó tu paquete con ${r.carrier}.`, `${r.store} shipped your package with ${r.carrier}.`),
          title: t('¡Tu paquete va en camino!', 'Your package is on its way!'),
          body:
            p(t(`Hola ${esc(u.name)}, <b>${esc(r.store)}</b> despachó tu paquete del pedido <b>${ref}</b>.`, `Hi ${esc(u.name)}, <b>${esc(r.store)}</b> shipped your package for order <b>${ref}</b>.`)) +
            rows([
              [t('Transportadora', 'Carrier'), esc(r.service || r.carrier || '—')],
              [t('Número de rastreo', 'Tracking number'), tracking],
            ]) +
            itemsTable(items, r.currency_code, l),
          cta: { label: t('Seguir mi pedido', 'Track my order'), url: `${config.webUrl}/cuenta/pedidos/${r.order_id}` },
          text: `${ref}: ${r.carrier} ${r.tracking_number ?? ''}`,
        }),
      });
    }
  }

  async shipmentDelivered(shipmentId: string) {
    const r = await this.db.one(
      `select sh.order_id, sh.seller_id, o.public_number, o.customer_id, coalesce(ssp.display_name, s.slug) as store
         from public.shipments sh join public.orders o on o.id = sh.order_id
         join public.sellers s on s.id = sh.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where sh.id = $1`,
      [shipmentId],
    );
    if (!r) return;
    const ref = orderRef(r.public_number);
    const u = await this.userContact(r.customer_id);
    if (u) {
      const t = tr(u.locale);
      await this.send({
        template: 'ORDER_DELIVERED',
        dedupeKey: `delivered:${shipmentId}`,
        to: u.email,
        userId: r.customer_id,
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        message: layout({
          locale: u.locale,
          subject: t(`Entregamos tu pedido ${ref}`, `Your order ${ref} was delivered`),
          preheader: t('Cuéntanos qué te parecieron tus productos.', 'Tell us what you think of your products.'),
          title: t('¡Pedido entregado!', 'Order delivered!'),
          body:
            p(t(`Hola ${esc(u.name)}, tu paquete de <b>${esc(r.store)}</b> (pedido ${ref}) fue entregado.`, `Hi ${esc(u.name)}, your package from <b>${esc(r.store)}</b> (order ${ref}) was delivered.`)) +
            p(t('Tu opinión ayuda a otros compradores: deja una reseña de los productos que recibiste.', 'Your feedback helps other shoppers: leave a review of the products you received.')),
          cta: { label: t('Calificar productos', 'Review products'), url: `${config.webUrl}/cuenta/pedidos/${r.order_id}` },
          text: `${ref}: ${t('entregado', 'delivered')}`,
        }),
      });
    }
    const s = await this.sellerContact(r.seller_id);
    if (s) {
      const t = tr(s.locale);
      await this.send({
        template: 'SELLER_ORDER_DELIVERED',
        dedupeKey: `seller-delivered:${shipmentId}`,
        to: s.email,
        userId: s.ownerUserId,
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        message: layout({
          locale: s.locale,
          subject: t(`Pedido ${ref} entregado`, `Order ${ref} delivered`),
          preheader: t('Los fondos de esta venta pasan a tu balance disponible.', 'Funds from this sale move to your available balance.'),
          title: t('Pedido entregado', 'Order delivered'),
          body: p(t(`El pedido <b>${ref}</b> fue entregado al cliente. Los fondos de esta venta pasan a tu balance disponible según la política de pagos.`,
                    `Order <b>${ref}</b> was delivered to the customer. Funds from this sale move to your available balance according to the payout policy.`)),
          cta: { label: t('Ver mis finanzas', 'View my finances'), url: `${config.webUrl}/vendedor/finanzas` },
          text: `${ref}: ${t('entregado', 'delivered')}`,
        }),
      });
    }
  }

  // ------------------------------------------------------------------ sellers

  async sellerApplicationReceived(sellerId: string) {
    const s = await this.sellerContact(sellerId);
    if (!s) return;
    const t = tr(s.locale);
    await this.send({
      template: 'SELLER_APPLICATION_RECEIVED',
      dedupeKey: `seller-application:${sellerId}`,
      to: s.email,
      userId: s.ownerUserId,
      entityType: 'SELLER',
      entityId: sellerId,
      message: layout({
        locale: s.locale,
        subject: t(`Recibimos la solicitud de ${s.store}`, `We received ${s.store}’s application`),
        preheader: t('Revisaremos tus datos y te avisaremos.', 'We’ll review your details and get back to you.'),
        title: t('Solicitud recibida', 'Application received'),
        body: p(t(`Hola ${esc(s.name)}, recibimos la solicitud para abrir <b>${esc(s.store)}</b>. Nuestro equipo verificará los datos y te avisaremos por este medio. Mientras tanto ya puedes preparar tus productos.`,
                  `Hi ${esc(s.name)}, we received the application to open <b>${esc(s.store)}</b>. Our team will verify the details and let you know by e-mail. Meanwhile you can start preparing your products.`)),
        cta: { label: t('Ir a mi panel', 'Go to my dashboard'), url: `${config.webUrl}/vendedor/dashboard` },
        text: t(`Recibimos la solicitud para abrir ${s.store}.`, `We received the application to open ${s.store}.`),
      }),
    });
  }

  async sellerStatusChanged(sellerId: string, action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE', reason?: string) {
    const s = await this.sellerContact(sellerId);
    if (!s) return;
    const t = tr(s.locale);
    const copy = {
      APPROVE: { subject: t(`¡${s.store} fue aprobada!`, `${s.store} has been approved!`), title: t('¡Tu tienda está activa!', 'Your store is live!'),
        body: t('Tu tienda fue verificada y aprobada. Tus productos aprobados ya pueden verse en el marketplace.', 'Your store was verified and approved. Your approved products are now visible on the marketplace.'), cta: t('Ir a mi panel', 'Go to my dashboard') },
      REJECT: { subject: t(`Solicitud de ${s.store} no aprobada`, `${s.store}’s application was not approved`), title: t('Solicitud no aprobada', 'Application not approved'),
        body: t('Revisamos tu solicitud y no pudimos aprobarla en este momento.', 'We reviewed your application and couldn’t approve it at this time.'), cta: t('Revisar mi información', 'Review my information') },
      SUSPEND: { subject: t(`${s.store} fue suspendida`, `${s.store} has been suspended`), title: t('Tienda suspendida', 'Store suspended'),
        body: t('Tu tienda fue suspendida y tus productos dejaron de mostrarse temporalmente.', 'Your store was suspended and your products are temporarily hidden.'), cta: t('Contactar soporte', 'Contact support') },
      REACTIVATE: { subject: t(`${s.store} fue reactivada`, `${s.store} has been reactivated`), title: t('Tienda reactivada', 'Store reactivated'),
        body: t('Tu tienda fue reactivada. Ya puedes volver a publicar tus productos.', 'Your store was reactivated. You can publish your products again.'), cta: t('Ir a mi panel', 'Go to my dashboard') },
    }[action];
    await this.send({
      template: `SELLER_${action}`,
      dedupeKey: `seller-status:${sellerId}:${action}:${randomUUID()}`,
      to: s.email,
      userId: s.ownerUserId,
      entityType: 'SELLER',
      entityId: sellerId,
      message: layout({
        locale: s.locale,
        subject: copy.subject,
        preheader: copy.body,
        title: copy.title,
        body: p(`${t('Hola', 'Hi')} ${esc(s.name)}, ${esc(copy.body.charAt(0).toLowerCase() + copy.body.slice(1))}`) + (reason?.trim() ? p(`<b>${t('Motivo', 'Reason')}:</b> ${esc(reason.trim())}`) : ''),
        cta: { label: copy.cta, url: action === 'SUSPEND' ? `${config.webUrl}/ayuda/reportar` : `${config.webUrl}/vendedor/dashboard` },
        text: `${copy.body}${reason?.trim() ? `\n${t('Motivo', 'Reason')}: ${reason.trim()}` : ''}`,
      }),
    });
  }

  async productModerated(productId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES', note?: string) {
    const pr = await this.db.one(`select id, seller_id, coalesce(title, slug) as title from public.products where id = $1`, [productId]);
    if (!pr) return;
    const s = await this.sellerContact(pr.seller_id);
    if (!s) return;
    const t = tr(s.locale);
    const copy = {
      APPROVE: [t('Producto aprobado', 'Product approved'), t(`«${pr.title}» fue aprobado y ya está publicado en el marketplace.`, `“${pr.title}” was approved and is now live on the marketplace.`)],
      REJECT: [t('Producto rechazado', 'Product rejected'), t(`«${pr.title}» no cumple las políticas del marketplace y fue rechazado.`, `“${pr.title}” doesn’t meet the marketplace policies and was rejected.`)],
      REQUEST_CHANGES: [t('Tu producto requiere cambios', 'Your product needs changes'), t(`«${pr.title}» necesita algunos ajustes antes de publicarse.`, `“${pr.title}” needs a few changes before it can be published.`)],
    }[decision];
    await this.send({
      template: `PRODUCT_${decision}`,
      dedupeKey: `product-moderated:${productId}:${decision}:${randomUUID()}`,
      to: s.email,
      userId: s.ownerUserId,
      entityType: 'PRODUCT',
      entityId: productId,
      message: layout({
        locale: s.locale,
        subject: `${copy[0]}: ${pr.title}`,
        preheader: copy[1],
        title: copy[0],
        body: p(esc(copy[1])) + (note?.trim() ? p(`<b>${t('Nota del moderador', 'Moderator note')}:</b> ${esc(note.trim())}`) : ''),
        cta: { label: t('Ver mis productos', 'View my products'), url: `${config.webUrl}/vendedor/productos` },
        text: `${copy[1]}${note?.trim() ? `\n${note.trim()}` : ''}`,
      }),
    });
  }

  /** A scheduled (automatic) payout was requested for the seller. */
  async payoutScheduled(payoutId: string) {
    const po = await this.db.one(`select seller_id, public_number, requested_amount::text as amount, currency_code, status from public.payouts where id = $1`, [payoutId]);
    if (!po) return;
    const s = await this.sellerContact(po.seller_id);
    if (!s) return;
    const t = tr(s.locale);
    const amount = money(po.amount, po.currency_code, s.locale);
    const line = po.status === 'APPROVAL_REQUIRED'
      ? t(`Solicitamos tu retiro programado de ${amount}. Finanzas lo revisará y te avisaremos cuando se transfiera.`, `We requested your scheduled payout of ${amount}. Finance will review it and we will let you know when it is sent.`)
      : t(`Solicitamos tu retiro programado de ${amount}. Te avisaremos cuando se transfiera.`, `We requested your scheduled payout of ${amount}. We will let you know when it is sent.`);
    await this.send({
      template: 'PAYOUT_SCHEDULED',
      dedupeKey: `payout:${payoutId}:SCHEDULED`,
      to: s.email,
      userId: s.ownerUserId,
      entityType: 'PAYOUT',
      entityId: payoutId,
      message: layout({
        locale: s.locale,
        subject: `${t('Retiro programado solicitado', 'Scheduled payout requested')} (${payoutRef(po.public_number)})`,
        preheader: line,
        title: t('Retiro programado solicitado', 'Scheduled payout requested'),
        body: p(`${t('Hola', 'Hi')} ${esc(s.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`),
        cta: { label: t('Ver mis finanzas', 'View my finances'), url: `${config.webUrl}/vendedor/finanzas` },
        text: line,
      }),
    });
  }

  async payoutUpdated(payoutId: string, action: 'MARK_PAID' | 'FAIL' | 'CANCEL', detail?: string) {
    const po = await this.db.one(`select seller_id, public_number, requested_amount::text as amount, currency_code from public.payouts where id = $1`, [payoutId]);
    if (!po) return;
    const s = await this.sellerContact(po.seller_id);
    if (!s) return;
    const t = tr(s.locale);
    const amount = money(po.amount, po.currency_code, s.locale);
    const copy = {
      MARK_PAID: [t('Retiro pagado', 'Payout sent'), t(`Transferimos ${amount} a tu cuenta de cobro.`, `We transferred ${amount} to your payout account.`)],
      FAIL: [t('Retiro no completado', 'Payout failed'), t(`No pudimos completar la transferencia de ${amount}. El monto volvió a tu balance disponible.`, `We couldn’t complete the transfer of ${amount}. The amount is back in your available balance.`)],
      CANCEL: [t('Retiro cancelado', 'Payout cancelled'), t(`El retiro de ${amount} fue cancelado y el monto volvió a tu balance disponible.`, `The payout of ${amount} was cancelled and the amount is back in your available balance.`)],
    }[action];
    const label = action === 'MARK_PAID' ? t('Referencia', 'Reference') : t('Motivo', 'Reason');
    await this.send({
      template: `PAYOUT_${action}`,
      dedupeKey: `payout:${payoutId}:${action}`,
      to: s.email,
      userId: s.ownerUserId,
      entityType: 'PAYOUT',
      entityId: payoutId,
      message: layout({
        locale: s.locale,
        subject: `${copy[0]} (${payoutRef(po.public_number)})`,
        preheader: copy[1],
        title: copy[0],
        body: p(`${t('Hola', 'Hi')} ${esc(s.name)}, ${esc(copy[1].charAt(0).toLowerCase() + copy[1].slice(1))}`) + (detail?.trim() ? p(`<b>${label}:</b> ${esc(detail.trim())}`) : ''),
        cta: { label: t('Ver mis finanzas', 'View my finances'), url: `${config.webUrl}/vendedor/finanzas` },
        text: `${copy[1]}${detail?.trim() ? `\n${label}: ${detail.trim()}` : ''}`,
      }),
    });
  }

  // ------------------------------------------------------------------ returns & refunds

  /** Return lifecycle e-mails: the store hears about requests and shipments, the buyer about every decision. */
  async returnEvent(returnId: string, event: 'REQUESTED' | 'IN_TRANSIT' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'INSPECTED' | 'REFUNDED' | 'CLOSED_NO_REFUND') {
    const r = await this.db.one(
      `select rr.id, rr.public_number, rr.customer_id, rr.seller_id, rr.order_id, rr.currency_code, rr.rejection_detail, rr.seller_comment,
              o.public_number as order_number, coalesce(ssp.display_name, s.slug) as store,
              (select coalesce(sum(f.refund_amount),0)::text from public.refunds f where f.return_request_id = rr.id and f.status = 'COMPLETED') as refunded,
              (select f.public_number from public.refunds f where f.return_request_id = rr.id and f.status = 'COMPLETED' order by f.completed_at desc limit 1) as refund_number,
              (select string_agg(coalesce(ois.product_title,'Producto') || ' ×' || ri.requested_quantity, ', ') from public.return_items ri
                 left join public.order_item_snapshots ois on ois.order_item_id = ri.order_item_id where ri.return_request_id = rr.id) as products,
              sh.carrier, sh.tracking_number
         from public.return_requests rr join public.orders o on o.id = rr.order_id
         join public.sellers s on s.id = rr.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join public.nx_return_request_shipping sh on sh.return_request_id = rr.id
        where rr.id = $1`,
      [returnId],
    );
    if (!r) return;
    const ref = returnRef(r.public_number);
    const oref = orderRef(r.order_number);
    if (event === 'REQUESTED' || event === 'IN_TRANSIT') {
      const s = await this.sellerContact(r.seller_id);
      if (!s) return;
      const t = tr(s.locale);
      const [title, line] =
        event === 'REQUESTED'
          ? [t('Nueva solicitud de devolución', 'New return request'), t(`Un cliente pidió devolver productos del pedido ${oref}: ${r.products}. Revísala y apruébala o recházala.`, `A customer asked to return items from order ${oref}: ${r.products}. Review it and approve or reject it.`)]
          : [t('El cliente envió la devolución', 'The customer shipped the return'), t(`El cliente despachó la devolución ${ref} con ${r.carrier}${r.tracking_number ? ` (guía ${r.tracking_number})` : ''}. Márcala como recibida cuando llegue.`, `The customer shipped return ${ref} with ${r.carrier}${r.tracking_number ? ` (tracking ${r.tracking_number})` : ''}. Mark it as received when it arrives.`)];
      await this.send({
        template: `RETURN_${event}_SELLER`,
        dedupeKey: `return:${returnId}:${event}:seller`,
        to: s.email,
        userId: s.ownerUserId,
        entityType: 'RETURN_REQUEST',
        entityId: returnId,
        message: layout({
          locale: s.locale,
          subject: `${title} (${ref})`,
          preheader: line,
          title,
          body: p(`${t('Hola', 'Hi')} ${esc(s.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`),
          cta: { label: t('Ver devolución', 'View return'), url: `${config.webUrl}/vendedor/devoluciones/${returnId}` },
          text: line,
        }),
      });
      return;
    }
    const u = await this.userContact(r.customer_id);
    if (!u) return;
    const t = tr(u.locale);
    const amount = money(r.refunded, r.currency_code, u.locale);
    const copy: Record<string, [string, string]> = {
      APPROVED: [t('Devolución aprobada', 'Return approved'), t(`${r.store} aprobó tu devolución ${ref}. Envía el paquete a la dirección que verás en la solicitud y registra la guía.`, `${r.store} approved your return ${ref}. Ship the package to the address shown in the request and add the tracking number.`)],
      REJECTED: [t('Devolución rechazada', 'Return rejected'), t(`${r.store} rechazó tu devolución ${ref}.${r.rejection_detail ? ` Motivo: ${r.rejection_detail}` : ''} Si no estás de acuerdo, abre un reporte en el centro de ayuda.`, `${r.store} rejected your return ${ref}.${r.rejection_detail ? ` Reason: ${r.rejection_detail}` : ''} If you disagree, open a report in the help center.`)],
      RECEIVED: [t('La tienda recibió tu devolución', 'The store received your return'), t(`${r.store} recibió el paquete de la devolución ${ref} y lo está revisando.`, `${r.store} received the package for return ${ref} and is checking it.`)],
      INSPECTED: [t('Devolución revisada', 'Return checked'), t(`${r.store} revisó los productos de la devolución ${ref}. Procesaremos tu reembolso en breve.`, `${r.store} checked the items of return ${ref}. We will process your refund shortly.`)],
      REFUNDED: [t('Reembolso realizado', 'Refund issued'), t(`Te devolvimos ${amount} por la devolución ${ref} al mismo medio de pago. Según tu banco puede tardar de 5 a 10 días hábiles en verse.`, `We refunded ${amount} for return ${ref} to your original payment method. Depending on your bank it can take 5–10 business days to show.`)],
      CLOSED_NO_REFUND: [t('Devolución cerrada', 'Return closed'), t(`La revisión de la devolución ${ref} no aceptó unidades para reembolso. Si tienes dudas, abre un reporte en el centro de ayuda.`, `The inspection of return ${ref} accepted no units for a refund. If you have questions, open a report in the help center.`)],
    };
    const [title, line] = copy[event];
    await this.send({
      template: event === 'REFUNDED' ? 'REFUND_COMPLETED' : `RETURN_${event}`,
      dedupeKey: `return:${returnId}:${event}`,
      to: u.email,
      userId: r.customer_id,
      entityType: 'RETURN_REQUEST',
      entityId: returnId,
      message: layout({
        locale: u.locale,
        subject: `${title} (${ref})`,
        preheader: line,
        title,
        body: p(`${t('Hola', 'Hi')} ${esc(u.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`) +
          (event === 'REFUNDED' && r.refund_number ? rows([[t('Reembolso', 'Refund'), esc(refundRef(r.refund_number))], [t('Monto', 'Amount'), esc(amount)], [t('Pedido', 'Order'), esc(oref)]]) : ''),
        cta: { label: t('Ver mi devolución', 'View my return'), url: `${config.webUrl}/cuenta/devoluciones/${returnId}` },
        text: line,
      }),
    });
    if (event === 'REFUNDED') {
      const s = await this.sellerContact(r.seller_id);
      if (s) {
        const ts = tr(s.locale);
        const line2 = ts(`Se reembolsaron ${money(r.refunded, r.currency_code, s.locale)} al cliente por la devolución ${ref}; el monto correspondiente se descontó de tu balance.`, `${money(r.refunded, r.currency_code, s.locale)} was refunded to the customer for return ${ref}; your share was deducted from your balance.`);
        await this.send({
          template: 'REFUND_COMPLETED_SELLER',
          dedupeKey: `return:${returnId}:REFUNDED:seller`,
          to: s.email,
          userId: s.ownerUserId,
          entityType: 'RETURN_REQUEST',
          entityId: returnId,
          message: layout({
            locale: s.locale,
            subject: `${ts('Reembolso de devolución', 'Return refund')} (${ref})`,
            preheader: line2,
            title: ts('Reembolso de devolución', 'Return refund'),
            body: p(`${ts('Hola', 'Hi')} ${esc(s.name)}, ${esc(line2.charAt(0).toLowerCase() + line2.slice(1))}`),
            cta: { label: ts('Ver devolución', 'View return'), url: `${config.webUrl}/vendedor/devoluciones/${returnId}` },
            text: line2,
          }),
        });
      }
    }
  }

  // ------------------------------------------------------------------ account deletion

  async accountDeletionEvent(requestId: string, event: 'REQUESTED' | 'REJECTED') {
    const r = await this.db.one(`select user_id, email_snapshot, decision_note from public.nx_account_deletion_requests where id = $1`, [requestId]);
    if (!r?.user_id) return;
    const u = await this.userContact(r.user_id);
    if (!u) return;
    const t = tr(u.locale);
    const [title, line] =
      event === 'REQUESTED'
        ? [t('Recibimos tu solicitud para eliminar la cuenta', 'We received your account deletion request'),
           t('Nuestro equipo la revisará en un máximo de 3 días hábiles. Mientras tanto puedes cancelarla desde Seguridad.', 'Our team will review it within 3 business days. Meanwhile you can cancel it from Security.')]
        : [t('No pudimos eliminar tu cuenta', 'We could not delete your account'),
           t(`Tu solicitud de eliminación fue rechazada.${r.decision_note ? ` Motivo: ${r.decision_note}` : ''}`, `Your deletion request was rejected.${r.decision_note ? ` Reason: ${r.decision_note}` : ''}`)];
    await this.send({
      template: `ACCOUNT_DELETION_${event}`,
      dedupeKey: `account-deletion:${requestId}:${event}`,
      to: u.email,
      userId: r.user_id,
      entityType: 'ACCOUNT_DELETION',
      entityId: requestId,
      message: layout({
        locale: u.locale,
        subject: title,
        preheader: line,
        title,
        body: p(`${t('Hola', 'Hi')} ${esc(u.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`),
        cta: { label: t('Ir a Seguridad', 'Go to Security'), url: `${config.webUrl}/cuenta/seguridad` },
        text: line,
      }),
    });
  }

  /** Last e-mail to the address the account had (the account itself no longer exists). */
  async accountDeleted(email: string, name: string | null, locale: Locale, requestId: string) {
    const t = tr(locale);
    const line = t('Eliminamos tu cuenta de NEXOVAX y tus datos personales. Los registros de compras que la ley nos obliga a conservar quedaron anónimos.',
                   'We deleted your NEXOVAX account and your personal data. Purchase records we are legally required to keep are now anonymous.');
    await this.send({
      template: 'ACCOUNT_DELETED',
      dedupeKey: `account-deletion:${requestId}:DELETED`,
      to: email,
      userId: null,
      entityType: 'ACCOUNT_DELETION',
      entityId: requestId,
      message: layout({
        locale,
        subject: t('Tu cuenta fue eliminada', 'Your account was deleted'),
        preheader: line,
        title: t('Cuenta eliminada', 'Account deleted'),
        body: p(`${t('Hola', 'Hi')}${name ? ` ${esc(name)}` : ''}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`) +
          p(t('Gracias por haber sido parte de NEXOVAX. Si cambias de opinión, puedes crear una cuenta nueva cuando quieras.', 'Thank you for being part of NEXOVAX. If you change your mind, you can create a new account at any time.')),
        text: line,
      }),
    });
  }

  // ------------------------------------------------------------------ support

  private async ticket(ticketId: string) {
    const tk = await this.db.one(`select requester_user_id, public_number, subject from public.support_tickets where id = $1`, [ticketId]);
    if (!tk?.requester_user_id) return null;
    const u = await this.userContact(tk.requester_user_id);
    return u ? { tk, u, code: ticketRef(tk.public_number) } : null;
  }

  async supportTicketCreated(ticketId: string) {
    const x = await this.ticket(ticketId);
    if (!x) return;
    const t = tr(x.u.locale);
    await this.send({
      template: 'SUPPORT_TICKET_CREATED',
      dedupeKey: `ticket-created:${ticketId}`,
      to: x.u.email,
      userId: x.tk.requester_user_id,
      entityType: 'SUPPORT_TICKET',
      entityId: ticketId,
      message: layout({
        locale: x.u.locale,
        subject: t(`Recibimos tu reporte ${x.code}`, `We received your report ${x.code}`),
        preheader: t('Nuestro equipo lo revisará pronto.', 'Our team will review it shortly.'),
        title: t('Reporte recibido', 'Report received'),
        body: p(t(`Hola ${esc(x.u.name)}, recibimos tu reporte <b>«${esc(x.tk.subject)}»</b>. Tu código de seguimiento es <b>${x.code}</b>. Te escribiremos cuando tengamos novedades.`,
                  `Hi ${esc(x.u.name)}, we received your report <b>“${esc(x.tk.subject)}”</b>. Your tracking code is <b>${x.code}</b>. We’ll write back when we have news.`)),
        cta: { label: t('Ver mis reportes', 'View my reports'), url: `${config.webUrl}/cuenta/reportes` },
        text: `${x.code}: ${x.tk.subject}`,
      }),
    });
  }

  async supportReply(ticketId: string, body: string) {
    const x = await this.ticket(ticketId);
    if (!x) return;
    const t = tr(x.u.locale);
    await this.send({
      template: 'SUPPORT_REPLY',
      dedupeKey: `ticket-reply:${ticketId}:${randomUUID()}`,
      to: x.u.email,
      userId: x.tk.requester_user_id,
      entityType: 'SUPPORT_TICKET',
      entityId: ticketId,
      message: layout({
        locale: x.u.locale,
        subject: t(`Respuesta a tu reporte ${x.code}`, `Reply to your report ${x.code}`),
        preheader: body.slice(0, 120),
        title: t('Tienes una respuesta de soporte', 'You have a reply from support'),
        body:
          p(t(`Hola ${esc(x.u.name)}, nuestro equipo respondió tu reporte <b>«${esc(x.tk.subject)}»</b>:`, `Hi ${esc(x.u.name)}, our team replied to your report <b>“${esc(x.tk.subject)}”</b>:`)) +
          `<div style="margin:0 0 16px;padding:14px 16px;background:#f1f6ff;border-left:4px solid #0a6cf5;border-radius:8px;white-space:pre-wrap">${esc(body.trim())}</div>`,
        cta: { label: t('Responder', 'Reply'), url: `${config.webUrl}/cuenta/reportes` },
        text: `${x.code}:\n\n${body.trim()}`,
      }),
    });
  }

  async supportStatusChanged(ticketId: string, status: string) {
    if (!['RESOLVED', 'CLOSED'].includes(status)) return;
    const x = await this.ticket(ticketId);
    if (!x) return;
    const t = tr(x.u.locale);
    const resolved = status === 'RESOLVED';
    const word = resolved ? t('resuelto', 'resolved') : t('cerrado', 'closed');
    await this.send({
      template: `SUPPORT_${status}`,
      dedupeKey: `ticket-status:${ticketId}:${status}`,
      to: x.u.email,
      userId: x.tk.requester_user_id,
      entityType: 'SUPPORT_TICKET',
      entityId: ticketId,
      message: layout({
        locale: x.u.locale,
        subject: t(`Tu reporte ${x.code} fue ${word}`, `Your report ${x.code} was ${word}`),
        preheader: t('Gracias por ayudarnos a mejorar.', 'Thanks for helping us improve.'),
        title: resolved ? t('Reporte resuelto', 'Report resolved') : t('Reporte cerrado', 'Report closed'),
        body: p(t(`Hola ${esc(x.u.name)}, marcamos tu reporte <b>«${esc(x.tk.subject)}»</b> (${x.code}) como ${word}. Si el problema continúa, puedes responder desde tus reportes.`,
                  `Hi ${esc(x.u.name)}, we marked your report <b>“${esc(x.tk.subject)}”</b> (${x.code}) as ${word}. If the problem continues, you can reply from your reports.`)),
        cta: { label: t('Ver mis reportes', 'View my reports'), url: `${config.webUrl}/cuenta/reportes` },
        text: `${x.code}: ${word}`,
      }),
    });
  }
}

function countryName(code: string | null | undefined, l: Locale) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([l === 'en' ? 'en' : 'es'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
