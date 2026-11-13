import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { esc, ItemLine, itemsTable, itemsText, layout, money, p, Rendered, rows } from './mail.templates';

interface SendInput {
  template: string;
  dedupeKey: string;
  to: string;
  userId?: string | null;
  entityType?: string;
  entityId?: string | null;
  message: Rendered;
}

const RESEND_URL = 'https://api.resend.com/emails';
const orderNo = (n: unknown) => `RD-${n}`;

/**
 * Transactional e-mail through Resend.
 * - Every business event is sent at most once (`email_deliveries.dedupe_key`).
 * - Sending never breaks the business operation: callers fire-and-forget
 *   after their transaction commits and failures are only logged/recorded.
 * - Demo/seed domains are suppressed to protect the sender reputation.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly db: DbService) {
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
    const to = (config.mailRedirectTo ?? i.to).trim().toLowerCase();
    const domain = to.split('@')[1] ?? '';
    const status = !this.enabled ? 'SKIPPED' : config.mailSuppressDomains.includes(domain) ? 'SUPPRESSED' : 'PENDING';
    if (config.mailRedirectTo) i = { ...i, message: { ...i.message, subject: `[para ${i.to}] ${i.message.subject}` } };
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
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': i.dedupeKey.slice(0, 256),
          },
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
        if (res.status !== 429 && res.status < 500) break; // permanent error
      } catch (e: any) {
        lastError = e?.message ?? String(e);
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    await this.db.exec(
      `update public.email_deliveries set status = 'FAILED', attempts = attempts + 1, last_error = $2, updated_at = now() where id = $1`,
      [row.id, lastError.slice(0, 500)],
    );
    this.logger.warn(`E-mail ${i.template} failed: ${lastError}`);
    return 'FAILED';
  }

  private async userContact(userId: string) {
    return this.db.one<{ email: string; name: string }>(
      `select u.email::text as email, coalesce(nullif(up.first_name, ''), nullif(up.display_name, ''), split_part(u.email::text, '@', 1)) as name
         from public.users u left join public.user_profiles up on up.user_id = u.id where u.id = $1`,
      [userId],
    );
  }

  private async sellerContact(sellerId: string) {
    return this.db.one<{ email: string; name: string; store: string; owner_user_id: string }>(
      `select u.email::text as email, coalesce(nullif(up.first_name, ''), nullif(up.display_name, ''), 'vendedor') as name,
              coalesce(ssp.display_name, s.slug) as store, s.owner_user_id
         from public.sellers s join public.users u on u.id = s.owner_user_id
         left join public.user_profiles up on up.user_id = u.id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where s.id = $1`,
      [sellerId],
    );
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
    await this.send({
      template: 'WELCOME',
      dedupeKey: `welcome:${userId}`,
      to: u.email,
      userId,
      entityType: 'USER',
      entityId: userId,
      message: layout({
        subject: '¡Bienvenido a RD Marketplace!',
        preheader: 'Tu cuenta está lista. Descubre tiendas dominicanas.',
        title: `¡Hola, ${u.name}!`,
        body:
          p('Tu cuenta en <b>RD Marketplace</b> fue creada con éxito. Ya puedes comprar en múltiples tiendas dominicanas con un solo carrito, guardar favoritos y seguir tus pedidos.') +
          p('¿Tienes un negocio? También puedes abrir tu tienda y empezar a vender en todo el país.'),
        cta: { label: 'Explorar productos', url: `${config.webUrl}/catalogo` },
        text: `Tu cuenta en RD Marketplace fue creada con éxito. Ya puedes comprar en múltiples tiendas dominicanas, guardar favoritos y seguir tus pedidos.`,
      }),
    });
  }

  async passwordRecovery(userId: string | null, email: string, link: string) {
    await this.send({
      template: 'PASSWORD_RECOVERY',
      dedupeKey: `recovery:${email.toLowerCase()}:${randomUUID()}`,
      to: email,
      userId,
      entityType: 'USER',
      entityId: userId,
      message: layout({
        subject: 'Restablece tu contraseña de RD Marketplace',
        preheader: 'Usa este enlace para crear una nueva contraseña.',
        title: 'Restablecer contraseña',
        body:
          p('Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón para crear una nueva.') +
          p('<span style="color:#7a7590;font-size:13px">El enlace vence en 1 hora y solo puede usarse una vez. Si no fuiste tú, ignora este correo: tu contraseña no cambiará.</span>'),
        cta: { label: 'Crear nueva contraseña', url: link },
        text: 'Recibimos una solicitud para restablecer tu contraseña. El enlace vence en 1 hora. Si no fuiste tú, ignora este correo.',
      }),
    });
  }

  // ------------------------------------------------------------------ orders

  /** Buyer confirmation + one "new sale" e-mail per seller. Call once the payment is captured. */
  async orderConfirmed(orderId: string) {
    const o = await this.db.one(
      `select o.id, o.public_number, o.customer_id, o.currency_code, ofs.product_net_amount::text as subtotal, ofs.shipping_total::text as shipping,
              ofs.tax_total::text as tax, ofs.grand_total::text as total,
              a.recipient_name, a.line1, a.line2, a.city, a.region
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
    const address = [o.recipient_name, o.line1, o.line2, [o.city, o.region].filter(Boolean).join(', ')].filter(Boolean);
    if (u)
      await this.send({
        template: 'ORDER_CONFIRMED',
        dedupeKey: `order-confirmed:${orderId}`,
        to: u.email,
        userId: o.customer_id,
        entityType: 'ORDER',
        entityId: orderId,
        message: layout({
          subject: `Confirmamos tu pedido ${orderNo(o.public_number)}`,
          preheader: `Total pagado ${money(o.total, cur)}. Te avisaremos cuando se envíe.`,
          title: '¡Gracias por tu compra!',
          body:
            p(`Hola ${esc(u.name)}, recibimos el pago de tu pedido <b>${orderNo(o.public_number)}</b>. Las tiendas ya fueron notificadas y te avisaremos cuando tus productos vayan en camino.`) +
            itemsTable(items, cur) +
            rows(
              [
                ['Subtotal', esc(money(o.subtotal, cur))],
                ['Envío', esc(money(o.shipping, cur))],
                ['ITBIS', esc(money(o.tax, cur))],
                ['Total pagado', esc(money(o.total, cur))],
              ],
              { boldLast: true },
            ) +
            (address.length ? p(`<b>Dirección de entrega</b><br>${address.map(esc).join('<br>')}`) : ''),
          cta: { label: 'Ver mi pedido', url: `${config.webUrl}/cuenta/pedidos/${orderId}` },
          text: `Recibimos el pago de tu pedido ${orderNo(o.public_number)}.\n\n${itemsText(items, cur)}\n\nTotal pagado: ${money(o.total, cur)}`,
        }),
      });

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
      const soItems = await this.orderItems(orderId, so.id);
      await this.send({
        template: 'SELLER_NEW_ORDER',
        dedupeKey: `seller-new-order:${so.id}`,
        to: s.email,
        userId: s.owner_user_id,
        entityType: 'SELLER_ORDER',
        entityId: so.id,
        message: layout({
          subject: `Nueva venta en ${s.store}: pedido ${orderNo(o.public_number)}`,
          preheader: 'Prepara el pedido para enviarlo lo antes posible.',
          title: '¡Tienes una nueva venta!',
          body:
            p(`El pedido <b>${orderNo(o.public_number)}</b> fue pagado y está listo para que lo prepares.`) +
            itemsTable(soItems, cur) +
            rows(
              [
                ['Venta de productos', esc(money(so.subtotal, cur))],
                ['Comisión de la plataforma', esc(`− ${money(so.commission, cur)}`)],
                ['Ingreso estimado', esc(money(so.net, cur))],
              ],
              { boldLast: true },
            ) +
            p('El dinero queda disponible para retiro cuando el pedido sea entregado.'),
          cta: { label: 'Gestionar pedido', url: `${config.webUrl}/vendedor/pedidos/${orderId}` },
          text: `El pedido ${orderNo(o.public_number)} fue pagado.\n\n${itemsText(soItems, cur)}\n\nIngreso estimado: ${money(so.net, cur)}`,
        }),
      });
    }
  }

  /** Bank-transfer instructions right after checkout. */
  async transferInstructions(paymentId: string, bt: { reference: string; bank: string; accountName: string; accountNumber: string; accountType: string; instructions: string }) {
    const pay = await this.db.one(
      `select p.customer_id, p.expected_amount::text as amount, p.currency_code, cs.expires_at
         from public.payments p join public.checkout_sessions cs on cs.id = p.checkout_session_id where p.id = $1`,
      [paymentId],
    );
    if (!pay) return;
    const u = await this.userContact(pay.customer_id);
    if (!u) return;
    await this.send({
      template: 'BANK_TRANSFER_PENDING',
      dedupeKey: `transfer-pending:${paymentId}`,
      to: u.email,
      userId: pay.customer_id,
      entityType: 'PAYMENT',
      entityId: paymentId,
      message: layout({
        subject: `Completa tu pago por transferencia (${bt.reference})`,
        preheader: `Transfiere ${money(pay.amount, pay.currency_code)} con la referencia ${bt.reference}.`,
        title: 'Tu pedido está reservado',
        body:
          p(`Hola ${esc(u.name)}, para confirmar tu compra realiza una transferencia por el monto exacto e incluye la referencia.`) +
          rows([
            ['Monto', `<b>${esc(money(pay.amount, pay.currency_code))}</b>`],
            ['Referencia', `<b>${esc(bt.reference)}</b>`],
            ['Banco', esc(bt.bank)],
            ['Titular', esc(bt.accountName)],
            ['Cuenta', esc(`${bt.accountNumber} (${bt.accountType})`)],
          ]) +
          p(esc(bt.instructions)),
        cta: { label: 'Ver mis pedidos', url: `${config.webUrl}/cuenta/pedidos` },
        text: `Transfiere ${money(pay.amount, pay.currency_code)} a ${bt.bank}, cuenta ${bt.accountNumber} (${bt.accountName}) con la referencia ${bt.reference}. ${bt.instructions}`,
      }),
    });
  }

  async transferRejected(paymentId: string, reason: string) {
    const pay = await this.db.one(`select customer_id, public_number, expected_amount::text as amount, currency_code from public.payments where id = $1`, [paymentId]);
    if (!pay) return;
    const u = await this.userContact(pay.customer_id);
    if (!u) return;
    await this.send({
      template: 'BANK_TRANSFER_REJECTED',
      dedupeKey: `transfer-rejected:${paymentId}`,
      to: u.email,
      userId: pay.customer_id,
      entityType: 'PAYMENT',
      entityId: paymentId,
      message: layout({
        subject: `No pudimos validar tu transferencia RD-PAY-${pay.public_number}`,
        preheader: 'Tu compra fue cancelada.',
        title: 'Transferencia no validada',
        body: p(`Hola ${esc(u.name)}, no pudimos validar la transferencia de <b>${esc(money(pay.amount, pay.currency_code))}</b> (referencia RD-PAY-${esc(pay.public_number)}), por lo que la compra fue cancelada.`) + p(`<b>Motivo:</b> ${esc(reason || 'No especificado')}`),
        cta: { label: 'Contactar soporte', url: `${config.webUrl}/ayuda/reportar` },
        text: `No pudimos validar tu transferencia RD-PAY-${pay.public_number}. Motivo: ${reason || 'No especificado'}`,
      }),
    });
  }

  async sellerOrderShipped(sellerOrderId: string) {
    const r = await this.db.one(
      `select so.order_id, so.seller_id, o.public_number, o.customer_id, coalesce(ssp.display_name, s.slug) as store,
              sh.id as shipment_id, sh.actual_carrier_name as carrier, st.tracking_number, st.tracking_url
         from public.seller_orders so join public.orders o on o.id = so.order_id
         join public.sellers s on s.id = so.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         join lateral (select * from public.shipments x where x.seller_order_id = so.id and x.status <> 'CANCELLED' order by x.created_at desc limit 1) sh on true
         left join lateral (select * from public.shipment_trackings t where t.shipment_id = sh.id order by t.created_at desc limit 1) st on true
        where so.id = $1`,
      [sellerOrderId],
    );
    if (!r) return;
    const u = await this.userContact(r.customer_id);
    if (!u) return;
    const items = await this.orderItems(r.order_id, sellerOrderId);
    const tracking = r.tracking_url
      ? `<a href="${esc(r.tracking_url)}" style="color:#5b21e6">${esc(r.tracking_number)}</a>`
      : `<b>${esc(r.tracking_number ?? '—')}</b>`;
    await this.send({
      template: 'ORDER_SHIPPED',
      dedupeKey: `shipped:${r.shipment_id}`,
      to: u.email,
      userId: r.customer_id,
      entityType: 'SHIPMENT',
      entityId: r.shipment_id,
      message: layout({
        subject: `Tu pedido ${orderNo(r.public_number)} va en camino`,
        preheader: `${r.store} despachó tu paquete con ${r.carrier}.`,
        title: '¡Tu paquete va en camino!',
        body:
          p(`Hola ${esc(u.name)}, <b>${esc(r.store)}</b> despachó tu paquete del pedido <b>${orderNo(r.public_number)}</b>.`) +
          rows([
            ['Transportadora', esc(r.carrier ?? '—')],
            ['Número de rastreo', tracking],
          ]) +
          itemsTable(items, 'DOP'),
        cta: { label: 'Seguir mi pedido', url: `${config.webUrl}/cuenta/pedidos/${r.order_id}` },
        text: `${r.store} despachó tu pedido ${orderNo(r.public_number)} con ${r.carrier}. Rastreo: ${r.tracking_number ?? '—'}`,
      }),
    });
  }

  async shipmentDelivered(shipmentId: string) {
    const r = await this.db.one(
      `select sh.order_id, sh.seller_id, sh.seller_order_id, o.public_number, o.customer_id, coalesce(ssp.display_name, s.slug) as store
         from public.shipments sh join public.orders o on o.id = sh.order_id
         join public.sellers s on s.id = sh.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where sh.id = $1`,
      [shipmentId],
    );
    if (!r) return;
    const u = await this.userContact(r.customer_id);
    if (u)
      await this.send({
        template: 'ORDER_DELIVERED',
        dedupeKey: `delivered:${shipmentId}`,
        to: u.email,
        userId: r.customer_id,
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        message: layout({
          subject: `Entregamos tu pedido ${orderNo(r.public_number)}`,
          preheader: 'Cuéntanos qué te parecieron tus productos.',
          title: '¡Pedido entregado!',
          body: p(`Hola ${esc(u.name)}, tu paquete de <b>${esc(r.store)}</b> (pedido ${orderNo(r.public_number)}) fue entregado.`) + p('Tu opinión ayuda a otros compradores: deja una reseña de los productos que recibiste.'),
          cta: { label: 'Calificar productos', url: `${config.webUrl}/cuenta/pedidos/${r.order_id}` },
          text: `Tu paquete de ${r.store} (pedido ${orderNo(r.public_number)}) fue entregado. Deja una reseña de tus productos.`,
        }),
      });
    const s = await this.sellerContact(r.seller_id);
    if (s)
      await this.send({
        template: 'SELLER_ORDER_DELIVERED',
        dedupeKey: `seller-delivered:${shipmentId}`,
        to: s.email,
        userId: s.owner_user_id,
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        message: layout({
          subject: `Pedido ${orderNo(r.public_number)} entregado`,
          preheader: 'Los fondos de esta venta pasan a tu balance disponible.',
          title: 'Pedido entregado',
          body: p(`El pedido <b>${orderNo(r.public_number)}</b> fue entregado al cliente. Los fondos de esta venta pasan a tu balance disponible según la política de pagos.`),
          cta: { label: 'Ver mis finanzas', url: `${config.webUrl}/vendedor/finanzas` },
          text: `El pedido ${orderNo(r.public_number)} fue entregado. Los fondos pasan a tu balance disponible.`,
        }),
      });
  }

  // ------------------------------------------------------------------ sellers

  async sellerApplicationReceived(sellerId: string) {
    const s = await this.sellerContact(sellerId);
    if (!s) return;
    await this.send({
      template: 'SELLER_APPLICATION_RECEIVED',
      dedupeKey: `seller-application:${sellerId}`,
      to: s.email,
      userId: s.owner_user_id,
      entityType: 'SELLER',
      entityId: sellerId,
      message: layout({
        subject: `Recibimos la solicitud de ${s.store}`,
        preheader: 'Revisaremos tus datos y te avisaremos.',
        title: 'Solicitud recibida',
        body: p(`Hola ${esc(s.name)}, recibimos la solicitud para abrir <b>${esc(s.store)}</b>. Nuestro equipo verificará los datos y te avisaremos por este medio. Mientras tanto ya puedes preparar tus productos.`),
        cta: { label: 'Ir a mi panel', url: `${config.webUrl}/vendedor/dashboard` },
        text: `Recibimos la solicitud para abrir ${s.store}. Te avisaremos cuando sea revisada.`,
      }),
    });
  }

  async sellerStatusChanged(sellerId: string, action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE', reason?: string) {
    const s = await this.sellerContact(sellerId);
    if (!s) return;
    const copy = {
      APPROVE: { subject: `¡${s.store} fue aprobada!`, title: '¡Tu tienda está activa!', body: 'Tu tienda fue verificada y aprobada. Tus productos aprobados ya pueden verse en el marketplace.', cta: 'Ir a mi panel' },
      REJECT: { subject: `Solicitud de ${s.store} no aprobada`, title: 'Solicitud no aprobada', body: 'Revisamos tu solicitud y no pudimos aprobarla en este momento.', cta: 'Revisar mi información' },
      SUSPEND: { subject: `${s.store} fue suspendida`, title: 'Tienda suspendida', body: 'Tu tienda fue suspendida y tus productos dejaron de mostrarse temporalmente.', cta: 'Contactar soporte' },
      REACTIVATE: { subject: `${s.store} fue reactivada`, title: 'Tienda reactivada', body: 'Tu tienda fue reactivada. Ya puedes volver a publicar tus productos.', cta: 'Ir a mi panel' },
    }[action];
    await this.send({
      template: `SELLER_${action}`,
      dedupeKey: `seller-status:${sellerId}:${action}:${randomUUID()}`,
      to: s.email,
      userId: s.owner_user_id,
      entityType: 'SELLER',
      entityId: sellerId,
      message: layout({
        subject: copy.subject,
        preheader: copy.body,
        title: copy.title,
        body: p(`Hola ${esc(s.name)}, ${esc(copy.body.charAt(0).toLowerCase() + copy.body.slice(1))}`) + (reason?.trim() ? p(`<b>Motivo:</b> ${esc(reason.trim())}`) : ''),
        cta: { label: copy.cta, url: action === 'SUSPEND' ? `${config.webUrl}/ayuda/reportar` : `${config.webUrl}/vendedor/dashboard` },
        text: `${copy.body}${reason?.trim() ? `\nMotivo: ${reason.trim()}` : ''}`,
      }),
    });
  }

  async productModerated(productId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES', note?: string) {
    const pr = await this.db.one(`select id, seller_id, coalesce(title, slug) as title from public.products where id = $1`, [productId]);
    if (!pr) return;
    const s = await this.sellerContact(pr.seller_id);
    if (!s) return;
    const copy = {
      APPROVE: ['Producto aprobado', `«${pr.title}» fue aprobado y ya está publicado en el marketplace.`],
      REJECT: ['Producto rechazado', `«${pr.title}» no cumple las políticas del marketplace y fue rechazado.`],
      REQUEST_CHANGES: ['Tu producto requiere cambios', `«${pr.title}» necesita algunos ajustes antes de publicarse.`],
    }[decision];
    await this.send({
      template: `PRODUCT_${decision}`,
      dedupeKey: `product-moderated:${productId}:${decision}:${randomUUID()}`,
      to: s.email,
      userId: s.owner_user_id,
      entityType: 'PRODUCT',
      entityId: productId,
      message: layout({
        subject: `${copy[0]}: ${pr.title}`,
        preheader: copy[1],
        title: copy[0],
        body: p(esc(copy[1])) + (note?.trim() ? p(`<b>Nota del moderador:</b> ${esc(note.trim())}`) : ''),
        cta: { label: 'Ver mis productos', url: `${config.webUrl}/vendedor/productos` },
        text: `${copy[1]}${note?.trim() ? `\nNota: ${note.trim()}` : ''}`,
      }),
    });
  }

  async payoutUpdated(payoutId: string, action: 'MARK_PAID' | 'FAIL' | 'CANCEL', detail?: string) {
    const po = await this.db.one(`select seller_id, public_number, requested_amount::text as amount, currency_code from public.payouts where id = $1`, [payoutId]);
    if (!po) return;
    const s = await this.sellerContact(po.seller_id);
    if (!s) return;
    const amount = money(po.amount, po.currency_code);
    const copy = {
      MARK_PAID: ['Retiro pagado', `Transferimos ${amount} a tu cuenta de cobro.`],
      FAIL: ['Retiro no completado', `No pudimos completar la transferencia de ${amount}. El monto volvió a tu balance disponible.`],
      CANCEL: ['Retiro cancelado', `El retiro de ${amount} fue cancelado y el monto volvió a tu balance disponible.`],
    }[action];
    await this.send({
      template: `PAYOUT_${action}`,
      dedupeKey: `payout:${payoutId}:${action}`,
      to: s.email,
      userId: s.owner_user_id,
      entityType: 'PAYOUT',
      entityId: payoutId,
      message: layout({
        subject: `${copy[0]} (PO-${po.public_number})`,
        preheader: copy[1],
        title: copy[0],
        body: p(`Hola ${esc(s.name)}, ${esc(copy[1])}`) + (detail?.trim() ? p(`<b>${action === 'MARK_PAID' ? 'Referencia' : 'Motivo'}:</b> ${esc(detail.trim())}`) : ''),
        cta: { label: 'Ver mis finanzas', url: `${config.webUrl}/vendedor/finanzas` },
        text: `${copy[1]}${detail?.trim() ? `\n${action === 'MARK_PAID' ? 'Referencia' : 'Motivo'}: ${detail.trim()}` : ''}`,
      }),
    });
  }

  // ------------------------------------------------------------------ support

  async supportTicketCreated(ticketId: string) {
    const t = await this.db.one(`select requester_user_id, public_number, subject from public.support_tickets where id = $1`, [ticketId]);
    if (!t?.requester_user_id) return;
    const u = await this.userContact(t.requester_user_id);
    if (!u) return;
    const code = `RD-REP-${t.public_number}`;
    await this.send({
      template: 'SUPPORT_TICKET_CREATED',
      dedupeKey: `ticket-created:${ticketId}`,
      to: u.email,
      userId: t.requester_user_id,
      entityType: 'SUPPORT_TICKET',
      entityId: ticketId,
      message: layout({
        subject: `Recibimos tu reporte ${code}`,
        preheader: 'Nuestro equipo lo revisará pronto.',
        title: 'Reporte recibido',
        body: p(`Hola ${esc(u.name)}, recibimos tu reporte <b>«${esc(t.subject)}»</b>. Tu código de seguimiento es <b>${code}</b>. Te escribiremos cuando tengamos novedades.`),
        cta: { label: 'Ver mis reportes', url: `${config.webUrl}/cuenta/reportes` },
        text: `Recibimos tu reporte "${t.subject}". Código de seguimiento: ${code}.`,
      }),
    });
  }

  async supportReply(ticketId: string, body: string) {
    const t = await this.db.one(`select requester_user_id, public_number, subject from public.support_tickets where id = $1`, [ticketId]);
    if (!t?.requester_user_id) return;
    const u = await this.userContact(t.requester_user_id);
    if (!u) return;
    const code = `RD-REP-${t.public_number}`;
    await this.send({
      template: 'SUPPORT_REPLY',
      dedupeKey: `ticket-reply:${ticketId}:${randomUUID()}`,
      to: u.email,
      userId: t.requester_user_id,
      entityType: 'SUPPORT_TICKET',
      entityId: ticketId,
      message: layout({
        subject: `Respuesta a tu reporte ${code}`,
        preheader: body.slice(0, 120),
        title: 'Tienes una respuesta de soporte',
        body:
          p(`Hola ${esc(u.name)}, nuestro equipo respondió tu reporte <b>«${esc(t.subject)}»</b>:`) +
          `<div style="margin:0 0 16px;padding:14px 16px;background:#f6f4fd;border-left:4px solid #5b21e6;border-radius:8px;white-space:pre-wrap">${esc(body.trim())}</div>`,
        cta: { label: 'Responder', url: `${config.webUrl}/cuenta/reportes` },
        text: `Respuesta a tu reporte ${code}:\n\n${body.trim()}`,
      }),
    });
  }

  async supportStatusChanged(ticketId: string, status: string) {
    if (!['RESOLVED', 'CLOSED'].includes(status)) return;
    const t = await this.db.one(`select requester_user_id, public_number, subject from public.support_tickets where id = $1`, [ticketId]);
    if (!t?.requester_user_id) return;
    const u = await this.userContact(t.requester_user_id);
    if (!u) return;
    const code = `RD-REP-${t.public_number}`;
    await this.send({
      template: `SUPPORT_${status}`,
      dedupeKey: `ticket-status:${ticketId}:${status}`,
      to: u.email,
      userId: t.requester_user_id,
      entityType: 'SUPPORT_TICKET',
      entityId: ticketId,
      message: layout({
        subject: `Tu reporte ${code} fue ${status === 'RESOLVED' ? 'resuelto' : 'cerrado'}`,
        preheader: 'Gracias por ayudarnos a mejorar.',
        title: status === 'RESOLVED' ? 'Reporte resuelto' : 'Reporte cerrado',
        body: p(`Hola ${esc(u.name)}, marcamos tu reporte <b>«${esc(t.subject)}»</b> (${code}) como ${status === 'RESOLVED' ? 'resuelto' : 'cerrado'}. Si el problema continúa, puedes responder desde tus reportes.`),
        cta: { label: 'Ver mis reportes', url: `${config.webUrl}/cuenta/reportes` },
        text: `Tu reporte ${code} fue marcado como ${status === 'RESOLVED' ? 'resuelto' : 'cerrado'}.`,
      }),
    });
  }
}
