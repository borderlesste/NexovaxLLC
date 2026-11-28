import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { trackingLink } from '../common/tracking-links';
import { DbService } from '../db/db.service';
import { categoryForTemplate, NotificationsService } from '../notifications/notifications.service';
import { orderRef, paymentRef, payoutRef, refundRef, returnRef, ticketRef } from '../common/refs';
import { esc, intlLocale, mailRuntime, webUrl, ItemLine, itemsTable, itemsText, layout, Locale, money, p, Rendered, rows } from './mail.templates';

interface SendInput {
  template: string;
  dedupeKey: string;
  to: string;
  userId?: string | null;
  entityType?: string;
  entityId?: string | null;
  message: Rendered;
  /** Reply-To other than the support address (guest support requests: the visitor's own e-mail). */
  replyTo?: string;
}

interface Contact {
  email: string;
  name: string;
  locale: Locale;
}

const RESEND_URL = 'https://api.resend.com/emails';
/** E-mails are written in Spanish, English, French and Haitian Creole. */
/** User language; users who never chose one get the marketplace default language. */
const loc = (v: unknown): Locale => (v === 'es' || v === 'en' || v === 'fr' || v === 'ht' ? v : mailRuntime.locale);
/** Picks the Spanish or English variant. */
/** Sent even with "Notificaciones por email" off: account access, bank details to pay, account deletion. */
const ESSENTIAL = /^(EMAIL_VERIFICATION|PASSWORD_RECOVERY|BANK_TRANSFER_PENDING|ACCOUNT_DELET|SELLER_TEAM_INVITATION|SUPPORT_GUEST_REQUEST)/;
/** Sender shows the marketplace name from Configuración, keeping the verified address. */
const senderFrom = () => {
  const addr = /<([^>]+)>/.exec(config.mailFrom)?.[1] ?? config.mailFrom;
  const name = mailRuntime.name.replace(/["<>\r\n]/g, '').trim() || 'NEXOVAX';
  return `${name} <${addr}>`;
};
/** Marketplace name from Configuración (raw for subjects/plain text, escaped for HTML bodies). */
const brand = () => mailRuntime.name.trim() || 'NEXOVAX';
const brandHtml = () => esc(brand());
const tr = (l: Locale) => (es: string, en: string, fr?: string, ht?: string) =>
  l === 'en' ? en : l === 'fr' ? fr ?? en : l === 'ht' ? ht ?? fr ?? en : es;

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
    // "Notificaciones por email" off: only e-mails people need to use or protect their account still go out.
    if (!mailRuntime.emailsOn && !ESSENTIAL.test(i.template)) return 'SKIPPED';
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
            from: senderFrom(),
            to: [to],
            subject: i.message.subject,
            html: i.message.html,
            text: i.message.text,
            reply_to: i.replyTo || mailRuntime.supportEmail || config.mailReplyTo,
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
        subject: t(`¡Bienvenido a ${brand()}!`, `Welcome to ${brand()}!`, `Bienvenue sur ${brand()} !`, `Byenvini sou ${brand()}!`),
        preheader: t('Tu cuenta está lista. Descubre tiendas de todo el mundo.', 'Your account is ready. Discover stores from around the world.', 'Votre compte est prêt. Découvrez des boutiques du monde entier.', 'Kont ou pare. Dekouvri boutik toupatou nan mond lan.'),
        title: t(`¡Hola, ${u.name}!`, `Hi ${u.name}!`, `Bonjour ${u.name} !`, `Bonjou ${u.name}!`),
        body:
          p(t(`Tu cuenta en <b>${brandHtml()}</b> fue creada con éxito. Ya puedes comprar en múltiples tiendas con un solo carrito, guardar favoritos y seguir tus pedidos.`,
              `Your <b>${brandHtml()}</b> account is ready. Shop from multiple stores with a single cart, save favorites and track your orders.`, `Votre compte <b>${brandHtml()}</b> est prêt. Achetez dans plusieurs boutiques avec un seul panier, enregistrez vos favoris et suivez vos commandes.`, `Kont <b>${brandHtml()}</b> ou pare. Achte nan plizyè boutik ak yon sèl panye, sere favori ou epi swiv kòmand ou yo.`)) +
          p(t('¿Tienes un negocio? También puedes abrir tu tienda y vender a clientes de todo el mundo.', 'Own a business? Open your store and sell to customers worldwide.', 'Vous avez une entreprise ? Ouvrez votre boutique et vendez à des clients du monde entier.', 'Ou gen yon biznis? Louvri boutik ou epi vann bay kliyan toupatou nan mond lan.')),
        cta: { label: t('Explorar productos', 'Browse products', 'Parcourir les produits', 'Gade pwodwi yo'), url: `${webUrl()}/catalogo` },
        text: t(`Tu cuenta en ${brand()} fue creada con éxito.`, `Your ${brand()} account is ready.`, `Votre compte ${brand()} est prêt.`, `Kont ${brand()} ou pare.`),
      }),
    });
  }

  async emailVerification(userId: string, email: string, link: string) {
    const u = await this.userContact(userId);
    const l = loc(u?.locale);
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
        subject: t(`Confirma tu correo en ${brand()}`, `Confirm your ${brand()} e-mail`, `Confirmez votre e-mail ${brand()}`, `Konfime imèl ${brand()} ou`),
        preheader: t('Un paso más para activar tu cuenta.', 'One more step to activate your account.', 'Plus qu’une étape pour activer votre compte.', 'Yon sèl etap ki rete pou aktive kont ou.'),
        title: t(`¡Hola${u?.name ? `, ${u.name}` : ''}!`, `Hi${u?.name ? ` ${u.name}` : ''}!`, `Bonjour${u?.name ? ` ${u.name}` : ''} !`, `Bonjou${u?.name ? ` ${u.name}` : ''}!`),
        body:
          p(t(`Gracias por registrarte en <b>${brandHtml()}</b>. Confirma que este correo te pertenece para activar tu cuenta.`,
              `Thanks for signing up to <b>${brandHtml()}</b>. Confirm this e-mail belongs to you to activate your account.`, `Merci de vous être inscrit sur <b>${brandHtml()}</b>. Confirmez que cet e-mail vous appartient pour activer votre compte.`, `Mèsi paske w enskri sou <b>${brandHtml()}</b>. Konfime imèl sa a se pou ou pou aktive kont ou.`)) +
          p(`<span style="color:#64748b;font-size:13px">${t('El enlace solo puede usarse una vez y vence pronto. Si no creaste esta cuenta, ignora este correo.', 'The link can be used once and expires soon. If you didn’t create this account, ignore this e-mail.', 'Le lien ne peut être utilisé qu’une fois et expire bientôt. Si vous n’avez pas créé ce compte, ignorez cet e-mail.', 'Ou ka itilize lyen an yon sèl fwa epi l ap ekspire talè. Si se pa ou ki kreye kont sa a, inyore imèl sa a.')}</span>`),
        cta: { label: t('Confirmar correo', 'Confirm e-mail', 'Confirmer l’e-mail', 'Konfime imèl'), url: link },
        text: t(`Confirma tu correo para activar tu cuenta de ${brand()}.`, `Confirm your e-mail to activate your ${brand()} account.`, `Confirmez votre e-mail pour activer votre compte ${brand()}.`, `Konfime imèl ou pou aktive kont ${brand()} ou.`),
      }),
    });
  }

  async passwordRecovery(userId: string | null, email: string, link: string) {
    const u = userId ? await this.userContact(userId) : null;
    const l = loc(u?.locale);
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
        subject: t(`Restablece tu contraseña de ${brand()}`, `Reset your ${brand()} password`, `Réinitialisez votre mot de passe ${brand()}`, `Chanje modpas ${brand()} ou`),
        preheader: t('Usa este enlace para crear una nueva contraseña.', 'Use this link to create a new password.', 'Utilisez ce lien pour créer un nouveau mot de passe.', 'Itilize lyen sa a pou kreye yon nouvo modpas.'),
        title: t('Restablecer contraseña', 'Reset your password', 'Réinitialisez votre mot de passe', 'Chanje modpas ou'),
        body:
          p(t('Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón para crear una nueva.', 'We received a request to reset your password. Click the button to create a new one.', 'Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton pour en créer un nouveau.', 'Nou resevwa yon demann pou chanje modpas ou. Klike sou bouton an pou kreye yon nouvo.')) +
          p(`<span style="color:#64748b;font-size:13px">${t('El enlace vence en 1 hora y solo puede usarse una vez. Si no fuiste tú, ignora este correo: tu contraseña no cambiará.', 'The link expires in 1 hour and can be used once. If this wasn’t you, ignore this e-mail: your password won’t change.', 'Le lien expire dans 1 heure et ne peut être utilisé qu’une fois. Si ce n’était pas vous, ignorez cet e-mail : votre mot de passe ne changera pas.', 'Lyen an ekspire nan 1 èdtan epi ou ka itilize l yon sèl fwa. Si se pa ou, inyore imèl sa a: modpas ou p ap chanje.')}</span>`),
        cta: { label: t('Crear nueva contraseña', 'Create a new password', 'Créer un nouveau mot de passe', 'Kreye yon nouvo modpas'), url: link },
        text: t('Recibimos una solicitud para restablecer tu contraseña. El enlace vence en 1 hora.', 'We received a request to reset your password. The link expires in 1 hour.', 'Nous avons reçu une demande de réinitialisation de votre mot de passe. Le lien expire dans 1 heure.', 'Nou resevwa yon demann pou chanje modpas ou. Lyen an ekspire nan 1 èdtan.'),
      }),
    });
  }

  /** Invitation to join a store's team; the link expires in 7 days. */
  async sellerTeamInvitation(invitationId: string, sellerId: string, inviterId: string, email: string, areas: string[], link: string) {
    const [store, inviter, invitee] = await Promise.all([
      this.sellerContact(sellerId),
      this.userContact(inviterId),
      this.db.one<{ id: string }>(`select id from public.users where lower(email::text) = $1`, [email.toLowerCase()]),
    ]);
    const l = invitee ? (await this.userContact(invitee.id))?.locale ?? inviter?.locale ?? 'es' : inviter?.locale ?? 'es';
    const t = tr(l);
    const label: Record<string, [string, string, string, string]> = {
      PRODUCTS: ['Productos e inventario', 'Products and inventory', 'Produits et stock', 'Pwodwi ak envantè'],
      ORDERS: ['Pedidos, envíos y devoluciones', 'Orders, shipping and returns', 'Commandes, expéditions et retours', 'Kòmand, livrezon ak retou'],
      MESSAGES: ['Mensajes con compradores', 'Messages with buyers', 'Messages avec les acheteurs', 'Mesaj ak achtè'],
      MARKETING: ['Cupones, ofertas y afiliados', 'Coupons, offers and affiliates', 'Coupons, offres et affiliés', 'Kupon, òf ak afilye'],
      FINANCE: ['Finanzas (solo consulta)', 'Finance (view only)', 'Finances (consultation)', 'Finans (gade sèlman)'],
      STATS: ['Estadísticas', 'Statistics', 'Statistiques', 'Estatistik'],
      SETTINGS: ['Configuración de la tienda', 'Store settings', 'Paramètres de la boutique', 'Paramèt boutik la'],
    };
    const list = areas.map((a) => `<li>${esc(t(...(label[a] ?? [a, a, a, a])))}</li>`).join('');
    const storeName = store?.store ?? mailRuntime.name;
    const who = inviter?.name ?? storeName;
    await this.send({
      template: 'SELLER_TEAM_INVITATION',
      dedupeKey: `team-invite:${invitationId}`,
      to: email,
      userId: invitee?.id ?? null,
      entityType: 'SELLER',
      entityId: sellerId,
      message: layout({
        locale: l,
        subject: t(`Te invitaron al equipo de ${storeName}`, `You're invited to the ${storeName} team`, `Invitation à rejoindre l’équipe de ${storeName}`, `Yo envite w nan ekip ${storeName}`),
        preheader: t(`${who} quiere que le ayudes a gestionar su tienda.`, `${who} wants you to help run their store.`, `${who} souhaite que vous l’aidiez à gérer sa boutique.`, `${who} vle ou ede l jere boutik li.`),
        title: t('Invitación al equipo', 'Team invitation', 'Invitation à l’équipe', 'Envitasyon nan ekip la'),
        body:
          p(t(`<b>${esc(who)}</b> te invitó a unirte al equipo de la tienda <b>${esc(storeName)}</b> en ${brandHtml()}. Podrás trabajar en:`,
              `<b>${esc(who)}</b> invited you to join the <b>${esc(storeName)}</b> store team on ${brandHtml()}. You'll be able to work on:`,
              `<b>${esc(who)}</b> vous a invité à rejoindre l’équipe de la boutique <b>${esc(storeName)}</b> sur ${brandHtml()}. Vous pourrez gérer :`,
              `<b>${esc(who)}</b> envite w antre nan ekip boutik <b>${esc(storeName)}</b> sou ${brandHtml()}. W ap ka travay sou:`)) +
          `<ul style="margin:0 0 14px;padding-left:20px">${list}</ul>` +
          p(`<span style="color:#64748b;font-size:13px">${t(`Inicia sesión o crea tu cuenta con este mismo correo (${esc(email)}) para aceptar. La invitación vence en 7 días.`, `Sign in or create your account with this same e-mail (${esc(email)}) to accept. The invitation expires in 7 days.`, `Connectez-vous ou créez votre compte avec cet e-mail (${esc(email)}) pour accepter. L’invitation expire dans 7 jours.`, `Konekte oswa kreye kont ou ak menm imèl sa a (${esc(email)}) pou aksepte. Envitasyon an ekspire nan 7 jou.`)}</span>`),
        cta: { label: t('Aceptar invitación', 'Accept invitation', 'Accepter l’invitation', 'Aksepte envitasyon an'), url: link },
        text: t(`${who} te invitó al equipo de ${storeName} en ${brand()}. Acepta aquí: ${link}`, `${who} invited you to the ${storeName} team on ${brand()}. Accept here: ${link}`, `${who} vous a invité dans l’équipe de ${storeName} sur ${brand()}. Acceptez ici : ${link}`, `${who} envite w nan ekip ${storeName} sou ${brand()}. Aksepte la a: ${link}`),
      }),
    });
  }

  // ------------------------------------------------------------------ orders

  /** Buyer confirmation + one "new sale" e-mail per seller. Call once the payment is captured. */
  async orderConfirmed(orderId: string) {
    const o = await this.db.one(
      `select o.id, o.public_number, o.customer_id, o.currency_code, ofs.product_net_amount::text as subtotal, ofs.product_gross_amount::text as gross_subtotal, ofs.discount_total::text as discount,
              ofs.shipping_total::text as shipping, ofs.tax_total::text as tax, ofs.grand_total::text as total,
              ofs.calculation_breakdown->'tax'->>'code' as tax_name, ofs.calculation_breakdown->'tax'->>'rate' as tax_rate,
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
      const receiptUrl = `${webUrl()}/cuenta/pedidos/${orderId}/recibo`;
      // Names the store(s) that sold the order: "La tienda X ya fue notificada" / "Las tiendas X y Y ya fueron notificadas".
      const storeRows = await this.db.many(
        `select coalesce(ssp.display_name, s.slug) as store from public.seller_orders so join public.sellers s on s.id = so.seller_id
           left join public.seller_store_profiles ssp on ssp.seller_id = s.id where so.order_id = $1 order by so.created_at`,
        [orderId],
      );
      const names = storeRows.map((r) => `<b>${esc(r.store)}</b>`);
      const join = (and: string) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`);
      const one = names.length === 1;
      const storesNotified = !names.length
        ? { es: 'Las tiendas ya fueron notificadas y te avisaremos cuando tus productos vayan en camino.', en: 'The stores have been notified and we’ll let you know when your items ship.',
            fr: 'Les boutiques ont été prévenues et nous vous avertirons quand vos articles seront expédiés.', ht: 'Boutik yo resevwa avi epi n ap fè w konnen lè atik ou yo pati.' }
        : {
            es: one ? `La tienda ${join('y')} ya fue notificada y te avisaremos cuando tus productos vayan en camino.` : `Las tiendas ${join('y')} ya fueron notificadas y te avisaremos cuando tus productos vayan en camino.`,
            en: one ? `The store ${join('and')} has been notified and we’ll let you know when your items ship.` : `The stores ${join('and')} have been notified and we’ll let you know when your items ship.`,
            fr: one ? `La boutique ${join('et')} a été prévenue et nous vous avertirons quand vos articles seront expédiés.` : `Les boutiques ${join('et')} ont été prévenues et nous vous avertirons quand vos articles seront expédiés.`,
            ht: one ? `Boutik ${join('ak')} resevwa avi epi n ap fè w konnen lè atik ou yo pati.` : `Boutik ${join('ak')} resevwa avi epi n ap fè w konnen lè atik ou yo pati.`,
          };
      const discount = Number(o.discount ?? 0);
      const taxRate = o.tax_rate != null && o.tax_rate !== '' && Number(o.tax_rate) > 0 ? +(Number(o.tax_rate) * 100).toFixed(2) : null;
      await this.send({
        template: 'ORDER_CONFIRMED',
        dedupeKey: `order-confirmed:${orderId}`,
        to: u.email,
        userId: o.customer_id,
        entityType: 'ORDER',
        entityId: orderId,
        message: layout({
          locale: l,
          subject: t(`Confirmamos tu pedido ${ref}`, `Your order ${ref} is confirmed`, `Votre commande ${ref} est confirmée`, `Kòmand ou ${ref} konfime`),
          preheader: t(`Total pagado ${money(o.total, cur, l)}. Te avisaremos cuando se envíe.`, `Total paid ${money(o.total, cur, l)}. We’ll let you know when it ships.`, `Total payé ${money(o.total, cur, l)}. Nous vous préviendrons de son expédition.`, `Total peye ${money(o.total, cur, l)}. N ap fè w konnen lè l pati.`),
          title: t('¡Gracias por tu compra!', 'Thanks for your order!', 'Merci pour votre commande !', 'Mèsi pou kòmand ou!'),
          body:
            p(t(`Hola ${esc(u.name)}, recibimos el pago de tu pedido <b>${ref}</b>. ${storesNotified.es}`,
                `Hi ${esc(u.name)}, we received the payment for order <b>${ref}</b>. ${storesNotified.en}`, `Bonjour ${esc(u.name)}, nous avons reçu le paiement de la commande <b>${ref}</b>. ${storesNotified.fr}`, `Bonjou ${esc(u.name)}, nou resevwa peman kòmand <b>${ref}</b>. ${storesNotified.ht}`)) +
            itemsTable(items, cur, l) +
            rows(
              [
                [t('Productos', 'Products', 'Produits', 'Pwodwi'), esc(money(discount > 0 ? o.gross_subtotal ?? o.subtotal : o.subtotal, cur, l))],
                ...(discount > 0 ? [[t('Descuento por cupón', 'Coupon discount', 'Remise du coupon', 'Rabè koupon'), esc(money(-discount, cur, l))] as [string, string]] : []),
                [t('Envío', 'Shipping', 'Livraison', 'Livrezon'), esc(money(o.shipping, cur, l))],
                [`${o.tax_name || t('Impuestos', 'Tax', 'Taxes', 'Taks')}${taxRate ? ` (${taxRate} %)` : ''}`, esc(money(o.tax, cur, l))],
                [t('Total pagado', 'Total paid', 'Total payé', 'Total peye'), esc(money(o.total, cur, l))],
              ],
              { boldLast: true },
            ) +
            (address.length ? p(`<b>${t('Dirección de entrega', 'Shipping address', 'Adresse de livraison', 'Adrès livrezon')}</b><br>${address.map(esc).join('<br>')}`) : '') +
            p(`<a href="${esc(receiptUrl)}" style="color:#0a6cf5">${t('Ver o descargar el recibo de compra', 'View or download your receipt', 'Voir ou télécharger le reçu', 'Wè oswa telechaje resi a')}</a>`),
          cta: { label: t('Ver mi pedido', 'View my order', 'Voir ma commande', 'Wè kòmand mwen'), url: `${webUrl()}/cuenta/pedidos/${orderId}` },
          text: `${t('Pedido', 'Order', 'Commande', 'Kòmand')} ${ref}\n\n${itemsText(items, cur, l)}\n\n${t('Total pagado', 'Total paid', 'Total payé', 'Total peye')}: ${money(o.total, cur, l)}\n\n${t('Recibo', 'Receipt', 'Reçu', 'Resi')}: ${receiptUrl}`,
        }),
      });
    }

    const sellerOrders = await this.db.many(
      `select so.id, so.seller_id, sofs.product_net_amount::text as subtotal, sofs.platform_commission_total::text as commission,
              sofs.seller_entitlement_estimate::text as net, sofs.discount_total::text as discount,
              (select string_agg(pc.code::text, ', ') from public.order_promotion_snapshots ops join public.promotion_codes pc on pc.id = ops.promotion_code_id
                where ops.order_id = so.order_id and ops.application_snapshot->>'sellerId' = so.seller_id::text) as coupon
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
      const couponUsed = so.coupon && Number(so.discount) > 0;
      if (couponUsed) {
        // In-app notice for the store: one of its coupons was redeemed in this order.
        const d = (lc: Locale) => money(so.discount, cur, lc);
        await this.notifications.notify(s.ownerUserId, {
          category: 'ORDERS', eventType: 'SELLER_COUPON_USED',
          title: `Se usó tu cupón ${so.coupon}`,
          body: `En el pedido ${ref} se aplicó un descuento de ${d('es')}.`,
          localized: {
            es: { title: `Se usó tu cupón ${so.coupon}`, body: `En el pedido ${ref} se aplicó un descuento de ${d('es')}.` },
            en: { title: `Your coupon ${so.coupon} was used`, body: `A discount of ${d('en')} was applied on order ${ref}.` },
            fr: { title: `Votre coupon ${so.coupon} a été utilisé`, body: `Une remise de ${d('fr')} a été appliquée à la commande ${ref}.` },
            ht: { title: `Yo itilize koupon ou ${so.coupon}`, body: `Yo aplike yon rabè ${d('ht')} sou kòmand ${ref}.` },
          },
          url: `/vendedor/pedidos/${orderId}`, entityType: 'SELLER_ORDER', entityId: so.id, dedupeKey: `seller-coupon-used:${so.id}`,
        });
      }
      await this.send({
        template: 'SELLER_NEW_ORDER',
        dedupeKey: `seller-new-order:${so.id}`,
        to: s.email,
        userId: s.ownerUserId,
        entityType: 'SELLER_ORDER',
        entityId: so.id,
        message: layout({
          locale: l,
          subject: t(`Nueva venta en ${s.store}: pedido ${ref}`, `New sale at ${s.store}: order ${ref}`, `Nouvelle vente chez ${s.store} : commande ${ref}`, `Nouvo vant nan ${s.store}: kòmand ${ref}`),
          preheader: t('Prepara el pedido para enviarlo lo antes posible.', 'Prepare the order so it ships as soon as possible.', 'Préparez la commande pour qu’elle parte au plus vite.', 'Prepare kòmand lan pou l pati pi vit posib.'),
          title: t('¡Tienes una nueva venta!', 'You have a new sale!', 'Vous avez une nouvelle vente !', 'Ou gen yon nouvo vant!'),
          body:
            p(t(`El pedido <b>${ref}</b> fue pagado y está listo para que lo prepares.`, `Order <b>${ref}</b> has been paid and is ready to be prepared.`, `La commande <b>${ref}</b> a été payée et est prête à être préparée.`, `Kòmand <b>${ref}</b> peye epi li pare pou prepare.`)) +
            itemsTable(soItems, cur, l) +
            rows(
              [
                [t('Venta de productos', 'Product sales', 'Ventes de produits', 'Vant pwodwi'), esc(money(so.subtotal, cur, l))],
                ...(couponUsed ? [[t(`Cupón ${so.coupon} (ya descontado de la venta)`, `Coupon ${so.coupon} (already deducted from sales)`, `Coupon ${so.coupon} (déjà déduit des ventes)`, `Koupon ${so.coupon} (deja retire nan vant lan)`), esc(`− ${money(so.discount, cur, l)}`)] as [string, string]] : []),
                [t('Comisión de la plataforma', 'Platform commission', 'Commission de la plateforme', 'Komisyon platfòm lan'), esc(`− ${money(so.commission, cur, l)}`)],
                [t('Ingreso estimado', 'Estimated earnings', 'Gains estimés', 'Benefis estime'), esc(money(so.net, cur, l))],
              ],
              { boldLast: true },
            ) +
            p(t('El dinero queda disponible para retiro cuando el pedido sea entregado.', 'Funds become available for payout once the order is delivered.', 'Les fonds deviennent disponibles pour versement une fois la commande livrée.', 'Lajan an vin disponib pou peman lè kòmand lan livre.')),
          cta: { label: t('Gestionar pedido', 'Manage order', 'Gérer la commande', 'Jere kòmand lan'), url: `${webUrl()}/vendedor/pedidos/${orderId}` },
          text: `${t('Pedido', 'Order', 'Commande', 'Kòmand')} ${ref}\n\n${itemsText(soItems, cur, l)}\n\n${t('Ingreso estimado', 'Estimated earnings', 'Gains estimés', 'Benefis estime')}: ${money(so.net, cur, l)}`,
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
      [t('Monto', 'Amount', 'Montant', 'Montan'), `<b>${esc(amount)}</b>`],
      [t('Referencia', 'Reference', 'Référence', 'Referans'), `<b>${esc(bt.reference)}</b>`],
      [t('Banco', 'Bank', 'Banque', 'Bank'), esc(bt.bank)],
      [t('Titular', 'Account holder', 'Titulaire', 'Titilè'), esc(bt.accountName)],
      [t('Cuenta', 'Account', 'Compte', 'Kont'), esc(bt.accountNumber)],
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
        subject: t(`Completa tu pago por transferencia (${bt.reference})`, `Complete your bank transfer (${bt.reference})`, `Effectuez votre virement bancaire (${bt.reference})`, `Fè transfè labank ou (${bt.reference})`),
        preheader: t(`Transfiere ${amount} con la referencia ${bt.reference}.`, `Transfer ${amount} using reference ${bt.reference}.`, `Virez ${amount} avec la référence ${bt.reference}.`, `Voye ${amount} ak referans ${bt.reference}.`),
        title: t('Tu pedido está reservado', 'Your order is reserved', 'Votre commande est réservée', 'Kòmand ou rezève'),
        body:
          p(t(`Hola ${esc(u.name)}, para confirmar tu compra realiza una transferencia por el monto exacto e incluye la referencia.`,
              `Hi ${esc(u.name)}, to confirm your purchase send a bank transfer for the exact amount and include the reference.`, `Bonjour ${esc(u.name)}, pour confirmer votre achat, effectuez un virement bancaire du montant exact en indiquant la référence.`, `Bonjou ${esc(u.name)}, pou konfime acha ou fè yon transfè labank pou montan egzak la epi mete referans lan.`)) +
          rows(details) +
          p(esc(bt.instructions)),
        cta: { label: t('Ver mis pedidos', 'View my orders', 'Voir mes commandes', 'Wè kòmand mwen yo'), url: `${webUrl()}/cuenta/pedidos` },
        text: `${t('Transfiere', 'Transfer', 'Virement', 'Transfè')} ${amount} → ${bt.bank}, ${bt.accountNumber} (${bt.accountName}). ${t('Referencia', 'Reference', 'Référence', 'Referans')}: ${bt.reference}. ${bt.instructions}`,
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
        subject: t(`No pudimos validar tu transferencia ${ref}`, `We couldn’t verify your transfer ${ref}`, `Nous n’avons pas pu vérifier votre virement ${ref}`, `Nou pa t ka verifye transfè ou ${ref}`),
        preheader: t('Tu compra fue cancelada.', 'Your purchase was cancelled.', 'Votre achat a été annulé.', 'Acha ou anile.'),
        title: t('Transferencia no validada', 'Transfer not verified', 'Virement non vérifié', 'Transfè pa verifye'),
        body:
          p(t(`Hola ${esc(u.name)}, no pudimos validar la transferencia de <b>${esc(money(pay.amount, pay.currency_code, l))}</b> (referencia ${ref}), por lo que la compra fue cancelada.`,
              `Hi ${esc(u.name)}, we couldn’t verify the transfer of <b>${esc(money(pay.amount, pay.currency_code, l))}</b> (reference ${ref}), so the purchase was cancelled.`, `Bonjour ${esc(u.name)}, nous n’avons pas pu vérifier le virement de <b>${esc(money(pay.amount, pay.currency_code, l))}</b> (référence ${ref}), l’achat a donc été annulé.`, `Bonjou ${esc(u.name)}, nou pa t ka verifye transfè <b>${esc(money(pay.amount, pay.currency_code, l))}</b> (referans ${ref}), kidonk acha a anile.`)) +
          p(`<b>${t('Motivo', 'Reason', 'Motif', 'Rezon')}:</b> ${esc(reason || t('No especificado', 'Not specified', 'Non précisé', 'Pa presize'))}`),
        cta: { label: t('Contactar soporte', 'Contact support', 'Contacter le support', 'Kontakte sipò'), url: `${webUrl()}/ayuda/reportar` },
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
        ? `<a href="${esc(link.url)}" style="color:#0a6cf5">${esc(r.tracking_number)}</a>${link.external ? ` <span style="color:#64748b;font-size:12px">(${esc(t('enlace externo', 'external link', 'lien externe', 'lyen deyò'))}: ${esc(link.host)})</span>` : ''}`
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
          subject: t(`Tu pedido ${ref} va en camino`, `Your order ${ref} is on its way`, `Votre commande ${ref} est en route`, `Kòmand ou ${ref} sou wout`),
          preheader: t(`${r.store} despachó tu paquete con ${r.carrier}.`, `${r.store} shipped your package with ${r.carrier}.`, `${r.store} a expédié votre colis avec ${r.carrier}.`, `${r.store} voye koli ou ak ${r.carrier}.`),
          title: t('¡Tu paquete va en camino!', 'Your package is on its way!', 'Votre colis est en route !', 'Koli ou sou wout!'),
          body:
            p(t(`Hola ${esc(u.name)}, <b>${esc(r.store)}</b> despachó tu paquete del pedido <b>${ref}</b>.`, `Hi ${esc(u.name)}, <b>${esc(r.store)}</b> shipped your package for order <b>${ref}</b>.`, `Bonjour ${esc(u.name)}, <b>${esc(r.store)}</b> a expédié votre colis de la commande <b>${ref}</b>.`, `Bonjou ${esc(u.name)}, <b>${esc(r.store)}</b> voye koli kòmand <b>${ref}</b> ou.`)) +
            rows([
              [t('Transportadora', 'Carrier', 'Transporteur', 'Transpòtè'), esc(r.service || r.carrier || '—')],
              [t('Número de rastreo', 'Tracking number', 'Numéro de suivi', 'Nimewo swivi'), tracking],
            ]) +
            itemsTable(items, r.currency_code, l),
          cta: { label: t('Seguir mi pedido', 'Track my order', 'Suivre ma commande', 'Swiv kòmand mwen'), url: `${webUrl()}/cuenta/pedidos/${r.order_id}` },
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
          subject: t(`Entregamos tu pedido ${ref}`, `Your order ${ref} was delivered`, `Votre commande ${ref} a été livrée`, `Kòmand ou ${ref} livre`),
          preheader: t('Cuéntanos qué te parecieron tus productos.', 'Tell us what you think of your products.', 'Dites-nous ce que vous pensez de vos produits.', 'Di nou sa w panse de pwodwi ou yo.'),
          title: t('¡Pedido entregado!', 'Order delivered!', 'Commande livrée !', 'Kòmand livre!'),
          body:
            p(t(`Hola ${esc(u.name)}, tu paquete de <b>${esc(r.store)}</b> (pedido ${ref}) fue entregado.`, `Hi ${esc(u.name)}, your package from <b>${esc(r.store)}</b> (order ${ref}) was delivered.`, `Bonjour ${esc(u.name)}, votre colis de <b>${esc(r.store)}</b> (commande ${ref}) a été livré.`, `Bonjou ${esc(u.name)}, koli ou soti nan <b>${esc(r.store)}</b> (kòmand ${ref}) livre.`)) +
            p(t('Tu opinión ayuda a otros compradores: deja una reseña de los productos que recibiste.', 'Your feedback helps other shoppers: leave a review of the products you received.', 'Votre avis aide les autres acheteurs : laissez un avis sur les produits reçus.', 'Avi ou ede lòt achtè: kite yon avi sou pwodwi ou resevwa yo.')),
          cta: { label: t('Calificar productos', 'Review products', 'Donner mon avis', 'Bay avi sou pwodwi yo'), url: `${webUrl()}/cuenta/pedidos/${r.order_id}` },
          text: `${ref}: ${t('entregado', 'delivered', 'livré', 'livre')}`,
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
          subject: t(`Pedido ${ref} entregado`, `Order ${ref} delivered`, `Commande ${ref} livrée`, `Kòmand ${ref} livre`),
          preheader: t('Los fondos de esta venta pasan a tu balance disponible.', 'Funds from this sale move to your available balance.', 'Les fonds de cette vente passent sur votre solde disponible.', 'Lajan vant sa a pase sou balans disponib ou.'),
          title: t('Pedido entregado', 'Order delivered', 'Commande livrée', 'Kòmand livre'),
          body: p(t(`El pedido <b>${ref}</b> fue entregado al cliente. Los fondos de esta venta pasan a tu balance disponible según la política de pagos.`,
                    `Order <b>${ref}</b> was delivered to the customer. Funds from this sale move to your available balance according to the payout policy.`, `La commande <b>${ref}</b> a été livrée au client. Les fonds de cette vente passent sur votre solde disponible selon la politique de versement.`, `Kòmand <b>${ref}</b> livre bay kliyan an. Lajan vant sa a pase sou balans disponib ou selon règ peman an.`)),
          cta: { label: t('Ver mis finanzas', 'View my finances', 'Voir mes finances', 'Wè finans mwen'), url: `${webUrl()}/vendedor/finanzas` },
          text: `${ref}: ${t('entregado', 'delivered', 'livré', 'livre')}`,
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
        subject: t(`¡${s.store} ya está activa en ${brand()}!`, `${s.store} is now live on ${brand()}!`, `${s.store} est maintenant en ligne sur ${brand()} !`, `${s.store} an liy sou ${brand()} kounye a!`),
        preheader: t('Ya puedes publicar tus productos.', 'You can start publishing your products.', 'Vous pouvez dès maintenant publier vos produits.', 'Ou ka kòmanse pibliye pwodwi ou yo.'),
        title: t('¡Tu tienda está activa!', 'Your store is live!', 'Votre boutique est en ligne !', 'Boutik ou an liy!'),
        body: p(t(`Hola ${esc(s.name)}, <b>${esc(s.store)}</b> ya está activa. Publica tus productos y aparecerán en el marketplace al instante. Para recibir tus ganancias, agrega una cuenta de cobro: la verificaremos antes de habilitar los retiros.`,
                  `Hi ${esc(s.name)}, <b>${esc(s.store)}</b> is now live. Publish your products and they will appear on the marketplace right away. To receive your earnings, add a payout account: we’ll verify it before enabling withdrawals.`, `Bonjour ${esc(s.name)}, <b>${esc(s.store)}</b> est maintenant en ligne. Publiez vos produits et ils apparaîtront aussitôt sur la marketplace. Pour recevoir vos gains, ajoutez un compte de versement : nous le vérifierons avant d’activer les retraits.`, `Bonjou ${esc(s.name)}, <b>${esc(s.store)}</b> an liy kounye a. Pibliye pwodwi ou yo epi y ap parèt sou maketplas la touswit. Pou resevwa lajan ou, ajoute yon kont peman: n ap verifye l anvan nou aktive retrè yo.`)),
        cta: { label: t('Ir a mi panel', 'Go to my dashboard', 'Aller à mon panneau', 'Ale nan panèl mwen'), url: `${webUrl()}/vendedor/dashboard` },
        text: t(`${s.store} ya está activa en ${brand()}.`, `${s.store} is now live on ${brand()}.`, `${s.store} est maintenant en ligne sur ${brand()}.`, `${s.store} an liy sou ${brand()} kounye a.`),
      }),
    });
  }

  async sellerStatusChanged(sellerId: string, action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE', reason?: string) {
    const s = await this.sellerContact(sellerId);
    if (!s) return;
    const t = tr(s.locale);
    const copy = {
      APPROVE: { subject: t(`¡${s.store} fue aprobada!`, `${s.store} has been approved!`, `${s.store} a été approuvée !`, `${s.store} apwouve!`), title: t('¡Tu tienda está activa!', 'Your store is live!', 'Votre boutique est en ligne !', 'Boutik ou an liy!'),
        body: t('Tu tienda fue aprobada. Tus productos aprobados ya pueden verse en el marketplace.', 'Your store was approved. Your approved products are now visible on the marketplace.', 'Votre boutique a été approuvée. Vos produits approuvés sont désormais visibles sur la marketplace.', 'Boutik ou apwouve. Pwodwi ou ki apwouve yo parèt sou maketplas la kounye a.'), cta: t('Ir a mi panel', 'Go to my dashboard', 'Aller à mon panneau', 'Ale nan panèl mwen') },
      REJECT: { subject: t(`Solicitud de ${s.store} no aprobada`, `${s.store}’s application was not approved`, `La demande de ${s.store} n’a pas été approuvée`, `Demann ${s.store} pa apwouve`), title: t('Solicitud no aprobada', 'Application not approved', 'Demande non approuvée', 'Demann pa apwouve'),
        body: t('Revisamos tu solicitud y no pudimos aprobarla en este momento.', 'We reviewed your application and couldn’t approve it at this time.', 'Nous avons examiné votre demande et ne pouvons pas l’approuver pour le moment.', 'Nou revize demann ou epi nou pa ka apwouve l kounye a.'), cta: t('Revisar mi información', 'Review my information', 'Vérifier mes informations', 'Revize enfòmasyon mwen') },
      SUSPEND: { subject: t(`${s.store} fue suspendida`, `${s.store} has been suspended`, `${s.store} a été suspendue`, `${s.store} sispann`), title: t('Tienda suspendida', 'Store suspended', 'Boutique suspendue', 'Boutik sispann'),
        body: t('Tu tienda fue suspendida y tus productos dejaron de mostrarse temporalmente.', 'Your store was suspended and your products are temporarily hidden.', 'Votre boutique a été suspendue et vos produits sont temporairement masqués.', 'Boutik ou sispann epi pwodwi ou yo kache pou kounye a.'), cta: t('Contactar soporte', 'Contact support', 'Contacter le support', 'Kontakte sipò') },
      REACTIVATE: { subject: t(`${s.store} fue reactivada`, `${s.store} has been reactivated`, `${s.store} a été réactivée`, `${s.store} reaktive`), title: t('Tienda reactivada', 'Store reactivated', 'Boutique réactivée', 'Boutik reaktive'),
        body: t('Tu tienda fue reactivada. Ya puedes volver a publicar tus productos.', 'Your store was reactivated. You can publish your products again.', 'Votre boutique a été réactivée. Vous pouvez de nouveau publier vos produits.', 'Boutik ou reaktive. Ou ka pibliye pwodwi ou yo ankò.'), cta: t('Ir a mi panel', 'Go to my dashboard', 'Aller à mon panneau', 'Ale nan panèl mwen') },
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
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(s.name)}, ${esc(copy.body.charAt(0).toLowerCase() + copy.body.slice(1))}`) + (reason?.trim() ? p(`<b>${t('Motivo', 'Reason', 'Motif', 'Rezon')}:</b> ${esc(reason.trim())}`) : ''),
        cta: { label: copy.cta, url: action === 'SUSPEND' ? `${webUrl()}/ayuda/reportar` : `${webUrl()}/vendedor/dashboard` },
        text: `${copy.body}${reason?.trim() ? `\n${t('Motivo', 'Reason', 'Motif', 'Rezon')}: ${reason.trim()}` : ''}`,
      }),
    });
  }

  /** «Identidad verificada» request decided by an administrator. */
  async identityVerificationDecided(sellerId: string, approved: boolean, reason?: string | null, note?: string | null) {
    const s = await this.sellerContact(sellerId);
    if (!s) return;
    const t = tr(s.locale);
    const reasons: Record<string, string> = {
      ILLEGIBLE: t('El documento no se puede leer bien.', 'The document can’t be read clearly.', 'Le document n’est pas lisible.', 'Dokiman an pa ka li byen.'),
      EXPIRED: t('El documento está vencido.', 'The document has expired.', 'Le document est expiré.', 'Dokiman an ekspire.'),
      MISMATCH: t('Los datos del documento no coinciden con los de la tienda.', 'The document’s details don’t match the store’s.', 'Les informations du document ne correspondent pas à celles de la boutique.', 'Enfòmasyon dokiman an pa koresponn ak pa boutik la.'),
      INCOMPLETE: t('Falta una parte del documento (por ejemplo, el reverso).', 'Part of the document is missing (for example, the back).', 'Une partie du document manque (par exemple, le verso).', 'Gen yon pati dokiman an ki manke (pa egzanp, do a).'),
      OTHER: t('Otro motivo.', 'Another reason.', 'Autre motif.', 'Lòt rezon.'),
    };
    const subject = approved
      ? t(`${s.store}: identidad verificada`, `${s.store}: identity verified`, `${s.store} : identité vérifiée`, `${s.store}: idantite verifye`)
      : t(`${s.store}: no pudimos verificar tu identidad`, `${s.store}: we couldn’t verify your identity`, `${s.store} : nous n’avons pas pu vérifier votre identité`, `${s.store}: nou pa t ka verifye idantite w`);
    const body = approved
      ? t('Revisamos tus documentos y tu tienda ya muestra la insignia «Identidad verificada».', 'We reviewed your documents and your store now shows the “Identity verified” badge.', 'Nous avons examiné vos documents et votre boutique affiche désormais le badge « Identité vérifiée ».', 'Nou revize dokiman w yo epi boutik ou montre badj «Idantite verifye» a kounye a.')
      : t('Revisamos tus documentos y no pudimos verificar tu identidad. Puedes enviar una nueva solicitud desde Configuración.', 'We reviewed your documents and couldn’t verify your identity. You can send a new request from Settings.', 'Nous avons examiné vos documents et n’avons pas pu vérifier votre identité. Vous pouvez envoyer une nouvelle demande depuis Paramètres.', 'Nou revize dokiman w yo epi nou pa t ka verifye idantite w. Ou ka voye yon nouvo demann nan Paramèt.');
    const why = !approved && reason ? `${reasons[reason] ?? ''}${note?.trim() ? ` ${note.trim()}` : ''}`.trim() : '';
    await this.send({
      template: approved ? 'SELLER_IDENTITY_VERIFIED' : 'SELLER_IDENTITY_REJECTED',
      dedupeKey: `seller-identity:${sellerId}:${randomUUID()}`,
      to: s.email,
      userId: s.ownerUserId,
      entityType: 'SELLER',
      entityId: sellerId,
      message: layout({
        locale: s.locale,
        subject,
        preheader: body,
        title: approved ? t('Identidad verificada', 'Identity verified', 'Identité vérifiée', 'Idantite verifye') : t('Identidad no verificada', 'Identity not verified', 'Identité non vérifiée', 'Idantite pa verifye'),
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(s.name)}, ${esc(body.charAt(0).toLowerCase() + body.slice(1))}`) + (why ? p(`<b>${t('Motivo', 'Reason', 'Motif', 'Rezon')}:</b> ${esc(why)}`) : ''),
        cta: { label: t('Ir a Configuración', 'Go to Settings', 'Aller aux Paramètres', 'Ale nan Paramèt'), url: `${webUrl()}/vendedor/configuracion` },
        text: `${body}${why ? `\n${t('Motivo', 'Reason', 'Motif', 'Rezon')}: ${why}` : ''}`,
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
      APPROVE: [t('Producto aprobado', 'Product approved', 'Produit approuvé', 'Pwodwi apwouve'), t(`«${pr.title}» fue aprobado y ya está publicado en el marketplace.`, `“${pr.title}” was approved and is now live on the marketplace.`, `« ${pr.title} » a été approuvé et est maintenant en ligne sur la marketplace.`, `«${pr.title}» apwouve epi li an liy sou maketplas la kounye a.`)],
      REJECT: [t('Producto rechazado', 'Product rejected', 'Produit refusé', 'Pwodwi refize'), t(`«${pr.title}» no cumple las políticas del marketplace y fue rechazado.`, `“${pr.title}” doesn’t meet the marketplace policies and was rejected.`, `« ${pr.title} » ne respecte pas les politiques de la marketplace et a été refusé.`, `«${pr.title}» pa respekte règ maketplas la epi li refize.`)],
      REQUEST_CHANGES: [t('Tu producto requiere cambios', 'Your product needs changes', 'Votre produit doit être modifié', 'Pwodwi ou bezwen chanjman'), t(`«${pr.title}» necesita algunos ajustes antes de publicarse.`, `“${pr.title}” needs a few changes before it can be published.`, `« ${pr.title} » nécessite quelques modifications avant d’être publié.`, `«${pr.title}» bezwen kèk chanjman anvan li ka pibliye.`)],
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
        body: p(esc(copy[1])) + (note?.trim() ? p(`<b>${t('Nota del moderador', 'Moderator note', 'Note du modérateur', 'Nòt moderatè a')}:</b> ${esc(note.trim())}`) : ''),
        cta: { label: t('Ver mis productos', 'View my products', 'Voir mes produits', 'Wè pwodwi mwen yo'), url: `${webUrl()}/vendedor/productos` },
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
      ? t(`Solicitamos tu retiro programado de ${amount}. Finanzas lo revisará y te avisaremos cuando se transfiera.`, `We requested your scheduled payout of ${amount}. Finance will review it and we will let you know when it is sent.`, `Nous avons demandé votre versement programmé de ${amount}. La finance va l’examiner et nous vous préviendrons de son envoi.`, `Nou mande peman pwograme ou ${amount}. Finans ap revize l epi n ap fè w konnen lè l voye.`)
      : t(`Solicitamos tu retiro programado de ${amount}. Te avisaremos cuando se transfiera.`, `We requested your scheduled payout of ${amount}. We will let you know when it is sent.`, `Nous avons demandé votre versement programmé de ${amount}. Nous vous préviendrons de son envoi.`, `Nou mande peman pwograme ou ${amount}. N ap fè w konnen lè l voye.`);
    await this.send({
      template: 'PAYOUT_SCHEDULED',
      dedupeKey: `payout:${payoutId}:SCHEDULED`,
      to: s.email,
      userId: s.ownerUserId,
      entityType: 'PAYOUT',
      entityId: payoutId,
      message: layout({
        locale: s.locale,
        subject: `${t('Retiro programado solicitado', 'Scheduled payout requested', 'Versement programmé demandé', 'Peman pwograme mande')} (${payoutRef(po.public_number)})`,
        preheader: line,
        title: t('Retiro programado solicitado', 'Scheduled payout requested', 'Versement programmé demandé', 'Peman pwograme mande'),
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(s.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`),
        cta: { label: t('Ver mis finanzas', 'View my finances', 'Voir mes finances', 'Wè finans mwen'), url: `${webUrl()}/vendedor/finanzas` },
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
      MARK_PAID: [t('Retiro pagado', 'Payout sent', 'Versement envoyé', 'Peman voye'), t(`Transferimos ${amount} a tu cuenta de cobro.`, `We transferred ${amount} to your payout account.`, `Nous avons viré ${amount} sur votre compte de versement.`, `Nou transfere ${amount} sou kont peman ou.`)],
      FAIL: [t('Retiro no completado', 'Payout failed', 'Échec du versement', 'Peman echwe'), t(`No pudimos completar la transferencia de ${amount}. El monto volvió a tu balance disponible.`, `We couldn’t complete the transfer of ${amount}. The amount is back in your available balance.`, `Nous n’avons pas pu effectuer le virement de ${amount}. Le montant est de retour sur votre solde disponible.`, `Nou pa t ka fini transfè ${amount} an. Montan an retounen sou balans disponib ou.`)],
      CANCEL: [t('Retiro cancelado', 'Payout cancelled', 'Versement annulé', 'Peman anile'), t(`El retiro de ${amount} fue cancelado y el monto volvió a tu balance disponible.`, `The payout of ${amount} was cancelled and the amount is back in your available balance.`, `Le versement de ${amount} a été annulé et le montant est de retour sur votre solde disponible.`, `Peman ${amount} an anile epi montan an retounen sou balans disponib ou.`)],
    }[action];
    const label = action === 'MARK_PAID' ? t('Referencia', 'Reference', 'Référence', 'Referans') : t('Motivo', 'Reason', 'Motif', 'Rezon');
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
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(s.name)}, ${esc(copy[1].charAt(0).toLowerCase() + copy[1].slice(1))}`) + (detail?.trim() ? p(`<b>${label}:</b> ${esc(detail.trim())}`) : ''),
        cta: { label: t('Ver mis finanzas', 'View my finances', 'Voir mes finances', 'Wè finans mwen'), url: `${webUrl()}/vendedor/finanzas` },
        text: `${copy[1]}${detail?.trim() ? `\n${label}: ${detail.trim()}` : ''}`,
      }),
    });
  }

  // ------------------------------------------------------------------ returns & refunds

  /** Return lifecycle e-mails: the store hears about requests and shipments, the buyer about every decision. */
  /** Buyer product alerts: back in stock (asked for) and price drops (favorites / cart). */
  async productAlert(userId: string, kind: 'STOCK' | 'PRICE', prod: { id: string; slug: string; title: string; price: string; previous?: string; currency: string; store: string }, dedupeKey: string) {
    const u = await this.userContact(userId);
    if (!u) return;
    const t = tr(u.locale);
    const now = money(prod.price, prod.currency, u.locale);
    const before = prod.previous ? money(prod.previous, prod.currency, u.locale) : '';
    const [title, line] = kind === 'STOCK'
      ? [t('Volvió a estar disponible', 'Back in stock', 'De retour en stock', 'Tounen an stòk'), t(`«${prod.title}» de ${prod.store} ya está disponible de nuevo a ${now}. Las unidades pueden agotarse pronto.`, `“${prod.title}” from ${prod.store} is available again at ${now}. Units may sell out soon.`, `« ${prod.title} » de ${prod.store} est de nouveau disponible à ${now}. Les unités pourraient vite s’épuiser.`, `«${prod.title}» nan ${prod.store} disponib ankò a ${now}. Inite yo ka fini vit.`)]
      : [t('Bajó de precio', 'Price drop', 'Baisse de prix', 'Pri a bese'), t(`«${prod.title}» de ${prod.store} bajó de ${before} a ${now}.`, `“${prod.title}” from ${prod.store} dropped from ${before} to ${now}.`, `« ${prod.title} » de ${prod.store} est passé de ${before} à ${now}.`, `«${prod.title}» nan ${prod.store} soti ${before} desann ${now}.`)];
    await this.send({
      template: kind === 'STOCK' ? 'PRODUCT_ALERT_STOCK' : 'PRODUCT_ALERT_PRICE',
      dedupeKey, to: u.email, userId, entityType: 'PRODUCT', entityId: prod.id,
      message: layout({ locale: u.locale, subject: `${title}: ${prod.title}`, preheader: line, title,
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(u.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`),
        cta: { label: t('Ver producto', 'View product', 'Voir le produit', 'Wè pwodwi a'), url: `${webUrl()}/producto/${prod.slug}` }, text: line }),
    });
  }

  /** The store hears about every free preorder reservation (the buyer's identity is not shared). */
  async preorderReserved(reservationId: string, dedupeKey: string) {
    const r = await this.db.one(
      `select r.quantity, r.product_title, r.variant_title, o.arrival_at, o.capacity, p.id as product_id, p.seller_id, ssp.timezone,
              (select coalesce(sum(x.quantity),0)::int from public.nx_preorder_reservations x
                where x.offer_id = o.id and x.cancelled_at is null) as reserved
         from public.nx_preorder_reservations r join public.nx_preorder_offers o on o.id = r.offer_id
         join public.product_variants v on v.id = o.variant_id join public.products p on p.id = v.product_id
         left join public.seller_store_profiles ssp on ssp.seller_id = p.seller_id
        where r.id = $1 and r.cancelled_at is null`,
      [reservationId],
    );
    if (!r) return;
    const s = await this.sellerContact(r.seller_id);
    if (!s) return;
    const l = s.locale;
    const t = tr(l);
    const product = r.variant_title ? `${r.product_title} (${r.variant_title})` : r.product_title;
    // The store's own time zone (Configuración de la tienda); UTC when it has none or it is invalid.
    const fmt = (timeZone: string) => new Date(r.arrival_at).toLocaleString(intlLocale(l), { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' });
    let arrival: string;
    try { arrival = fmt(r.timezone || 'UTC'); } catch { arrival = fmt('UTC'); }
    const title = t('Nueva reserva de preorden', 'New preorder reservation', 'Nouvelle réservation en précommande', 'Nouvo rezèvasyon prekòmand');
    const line = t(`Un cliente reservó ${r.quantity} u. de «${product}». Llevas ${r.reserved} de ${r.capacity} cupos reservados.`,
      `A customer reserved ${r.quantity} unit(s) of “${product}”. ${r.reserved} of ${r.capacity} slots are now reserved.`,
      `Un client a réservé ${r.quantity} unité(s) de « ${product} ». ${r.reserved} places sur ${r.capacity} sont réservées.`,
      `Yon kliyan rezève ${r.quantity} inite «${product}». ${r.reserved} sou ${r.capacity} plas rezève.`);
    await this.send({
      template: 'SELLER_PREORDER_RESERVED', dedupeKey, to: s.email, userId: s.ownerUserId, entityType: 'PRODUCT', entityId: r.product_id,
      message: layout({ locale: l, subject: `${title}: ${r.product_title}`, preheader: line, title,
        body: p(esc(line))
          + rows([[t('Producto', 'Product', 'Produit', 'Pwodwi'), esc(product)], [t('Cantidad reservada', 'Reserved quantity', 'Quantité réservée', 'Kantite rezève'), String(r.quantity)],
            [t('Cupos reservados', 'Reserved slots', 'Places réservées', 'Plas rezève'), `${r.reserved} / ${r.capacity}`], [t('Llegada estimada', 'Estimated arrival', 'Arrivée estimée', 'Arive estime'), esc(arrival)]])
          + p(t('La reserva es gratuita: cuando registres el inventario avisaremos al cliente para que compre mientras haya stock disponible.',
            'The reservation is free: once you add the inventory we will tell the customer so they can buy while stock lasts.',
            'La réservation est gratuite : dès que vous ajoutez le stock, nous prévenons le client pour qu’il achète tant qu’il y a du stock.',
            'Rezèvasyon an gratis: lè w ajoute envantè a n ap avèti kliyan an pou l achte pandan gen stòk.')),
        cta: { label: t('Ver el producto', 'View the product', 'Voir le produit', 'Wè pwodwi a'), url: `${webUrl()}/vendedor/productos/${r.product_id}/editar` }, text: line }),
    });
  }

  /** The buyer who reserved a preorder: the inventory arrived and there is stock to buy now. */
  async preorderAvailable(userId: string, prod: { id: string; slug: string; title: string; price: string; currency: string; store: string }, dedupeKey: string) {
    const u = await this.userContact(userId);
    if (!u) return;
    const t = tr(u.locale);
    const price = money(prod.price, prod.currency, u.locale);
    const title = t('Tu reserva ya está disponible', 'Your reservation is now available', 'Votre réservation est disponible', 'Rezèvasyon ou disponib kounye a');
    const line = t(`Llegó el inventario de «${prod.title}» de ${prod.store} y ya puedes comprarlo a ${price}. La reserva no aparta unidades: cómpralo mientras haya stock disponible.`,
      `The inventory for “${prod.title}” from ${prod.store} has arrived and you can buy it now at ${price}. The reservation does not hold units: buy it while stock lasts.`,
      `Le stock de « ${prod.title} » de ${prod.store} est arrivé ; vous pouvez l’acheter à ${price}. La réservation ne bloque pas d’unités : achetez-le tant qu’il y a du stock.`,
      `Envantè «${prod.title}» nan ${prod.store} rive, ou ka achte l kounye a a ${price}. Rezèvasyon an pa kenbe inite: achte l pandan gen stòk.`);
    await this.send({
      template: 'ORDER_PREORDER_AVAILABLE', dedupeKey, to: u.email, userId, entityType: 'PRODUCT', entityId: prod.id,
      message: layout({ locale: u.locale, subject: `${title}: ${prod.title}`, preheader: line, title,
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(u.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`),
        cta: { label: t('Comprar ahora', 'Buy now', 'Acheter maintenant', 'Achte kounye a'), url: `${webUrl()}/producto/${prod.slug}` }, text: line }),
    });
  }

  /** A store's coupon offer to someone who has the product in favorites / cart (store never sees who). */
  async productOffer(userId: string, o: { productId: string; slug: string; title: string; store: string; code: string; type: string; value: number; currency: string; endsAt?: string | null; message?: string | null }, dedupeKey: string) {
    const u = await this.userContact(userId);
    if (!u) return;
    const t = tr(u.locale);
    const discount = o.type === 'PERCENT' ? `${o.value} %` : money(String(o.value), o.currency, u.locale);
    const until = o.endsAt ? new Date(o.endsAt).toLocaleDateString(intlLocale(u.locale), { day: 'numeric', month: 'long' }) : null;
    const title = t(`${discount} de descuento en algo que te gustó`, `${discount} off something you liked`, `${discount} de remise sur un article qui vous plaît`, `${discount} rabè sou yon bagay ou renmen`);
    const line = t(`${o.store} te ofrece ${discount} de descuento en «${o.title}» con el cupón ${o.code}${until ? ` hasta el ${until}` : ''}.`,
      `${o.store} offers you ${discount} off “${o.title}” with coupon ${o.code}${until ? ` until ${until}` : ''}.`, `${o.store} vous offre ${discount} de remise sur « ${o.title} » avec le coupon ${o.code}${until ? ` jusqu’au ${until}` : ''}.`, `${o.store} ofri w ${discount} rabè sou «${o.title}» ak koupon ${o.code}${until ? ` jiska ${until}` : ''}.`);
    await this.send({
      template: 'PRODUCT_ALERT_OFFER', dedupeKey, to: u.email, userId, entityType: 'PRODUCT', entityId: o.productId,
      message: layout({ locale: u.locale, subject: `${title}: ${o.title}`, preheader: line, title,
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(u.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`)
          + (o.message ? p(`<b>${t('Mensaje de la tienda', 'Message from the store', 'Message de la boutique', 'Mesaj boutik la')}:</b> ${esc(o.message)}`) : '')
          + rows([[t('Cupón', 'Coupon', 'Coupon', 'Koupon'), `<b>${esc(o.code)}</b>`], [t('Descuento', 'Discount', 'Remise', 'Rabè'), esc(discount)]])
          + p(t('Escribe el código al pagar. Recibes esta oferta porque tienes el producto en tus favoritos o en tu carrito; puedes desactivar estos avisos en tus preferencias de notificación.',
                'Enter the code at checkout. You get this offer because the product is in your favorites or cart; you can turn these alerts off in your notification preferences.', 'Saisissez le code au paiement. Vous recevez cette offre car le produit est dans vos favoris ou votre panier ; vous pouvez désactiver ces alertes dans vos préférences de notification.', 'Antre kòd la lè w ap peye. Ou resevwa òf sa a paske pwodwi a nan favori oswa panye ou; ou ka dezaktive alèt sa yo nan preferans notifikasyon ou.')),
        cta: { label: t('Ver producto', 'View product', 'Voir le produit', 'Wè pwodwi a'), url: `${webUrl()}/producto/${o.slug}` }, text: line }),
    });
  }

  /** Order cancellation (before shipping): request, approval, rejection and refund notices. */
  /** Admin: a dispute or a refund made outside NEXOVAX needs attention (admins see Spanish/English per their locale). */
  async paymentIncidentAdmin(userId: string, n: { title: string; body: string; dedupeKey: string }) {
    const u = await this.userContact(userId);
    if (!u) return;
    const t = tr(u.locale);
    await this.send({
      template: 'PAYMENT_INCIDENT_ADMIN', dedupeKey: n.dedupeKey, to: u.email, userId, entityType: 'PAYMENT_INCIDENT', entityId: null,
      message: layout({ locale: u.locale, subject: n.title, preheader: n.body, title: n.title, body: p(esc(n.body)),
        cta: { label: t('Ver incidencias de pago', 'View payment incidents', 'Voir les incidents de paiement', 'Wè ensidan peman yo'), url: `${webUrl()}/admin/incidencias-pago` }, text: n.body }),
    });
  }

  async orderCancellationEvent(cancellationId: string, event: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDED') {
    const c = await this.db.one(
      `select c.id, c.public_number, c.customer_id, c.seller_id, c.order_id, c.requested_by_role, c.decision_note, c.note,
              o.public_number as order_number, o.currency_code, coalesce(ssp.display_name, s.slug) as store,
              f.refund_amount::text as refunded, f.public_number as refund_number
         from public.nx_order_cancellations c join public.orders o on o.id = c.order_id
         join public.sellers s on s.id = c.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join public.refunds f on f.id = c.refund_id and f.status = 'COMPLETED'
        where c.id = $1`,
      [cancellationId],
    );
    if (!c) return;
    const oref = orderRef(c.order_number);
    const sellerUrl = `${webUrl()}/vendedor/pedidos/${c.order_id}`;
    const customerUrl = `${webUrl()}/cuenta/pedidos/${c.order_id}`;
    const toSeller = async (title: [string, string, string, string], line: [string, string, string, string], key: string) => {
      const s = await this.sellerContact(c.seller_id);
      if (!s) return;
      const t = tr(s.locale);
      const l = t(...line);
      await this.send({
        template: `ORDER_CANCEL_${key}_SELLER`, dedupeKey: `cancel:${cancellationId}:${key}:seller`, to: s.email, userId: s.ownerUserId,
        entityType: 'ORDER', entityId: c.order_id,
        message: layout({ locale: s.locale, subject: `${t(...title)} (${oref})`, preheader: l, title: t(...title),
          body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(s.name)}, ${esc(l.charAt(0).toLowerCase() + l.slice(1))}`),
          cta: { label: t('Ver pedido', 'View order', 'Voir la commande', 'Wè kòmand lan'), url: sellerUrl }, text: l }),
      });
    };
    const toCustomer = async (title: [string, string, string, string], line: [string, string, string, string], key: string, extra?: (t: (es: string, en: string, fr?: string, ht?: string) => string, l: Locale) => string) => {
      const u = await this.userContact(c.customer_id);
      if (!u) return;
      const t = tr(u.locale);
      const l = t(...line);
      await this.send({
        template: key === 'REFUNDED' ? 'REFUND_COMPLETED' : `ORDER_CANCEL_${key}`, dedupeKey: `cancel:${cancellationId}:${key}`, to: u.email, userId: c.customer_id,
        entityType: 'ORDER', entityId: c.order_id,
        message: layout({ locale: u.locale, subject: `${t(...title)} (${oref})`, preheader: l, title: t(...title),
          body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(u.name)}, ${esc(l.charAt(0).toLowerCase() + l.slice(1))}`) + (extra ? extra(t, u.locale) : ''),
          cta: { label: t('Ver mi pedido', 'View my order', 'Voir ma commande', 'Wè kòmand mwen'), url: customerUrl }, text: l }),
      });
    };
    if (event === 'REQUESTED') {
      await toSeller(['Solicitud de cancelación', 'Cancellation request', 'Demande d’annulation', 'Demann anilasyon'],
        [`El cliente pidió cancelar su compra del pedido ${oref} antes del envío. No lo prepares ni lo envíes: acéptala o recházala desde el pedido.`,
         `The customer asked to cancel their purchase in order ${oref} before shipping. Don’t prepare or ship it: accept or reject the request from the order.`, `Le client a demandé l’annulation de son achat de la commande ${oref} avant l’expédition. Ne le préparez pas et ne l’expédiez pas : acceptez ou refusez la demande depuis la commande.`, `Kliyan an mande anile acha li nan kòmand ${oref} anvan li pati. Pa prepare l ni voye l: aksepte oswa refize demann lan nan kòmand lan.`], 'REQUESTED');
      return;
    }
    if (event === 'REJECTED') {
      await toCustomer(['Cancelación rechazada', 'Cancellation rejected', 'Annulation refusée', 'Anilasyon refize'],
        [`${c.store} no pudo cancelar tu compra del pedido ${oref}${c.decision_note ? `. Motivo: ${c.decision_note}` : ''}. Si ya lo recibes y no lo quieres, puedes pedir una devolución.`,
         `${c.store} couldn’t cancel your purchase in order ${oref}${c.decision_note ? `. Reason: ${c.decision_note}` : ''}. If you receive it and don’t want it, you can request a return.`, `${c.store} n’a pas pu annuler votre achat de la commande ${oref}${c.decision_note ? `. Motif : ${c.decision_note}` : ''}. Si vous le recevez et n’en voulez pas, vous pouvez demander un retour.`, `${c.store} pa t ka anile acha ou nan kòmand ${oref}${c.decision_note ? `. Rezon: ${c.decision_note}` : ''}. Si w resevwa l epi ou pa vle l, ou ka mande yon retou.`], 'REJECTED');
      return;
    }
    if (event === 'APPROVED') {
      await toCustomer(['Pedido cancelado', 'Order cancelled', 'Commande annulée', 'Kòmand anile'],
        [`Cancelamos tu compra de ${c.store} en el pedido ${oref}. Estamos procesando el reembolso completo al mismo medio de pago; te avisaremos cuando se emita.`,
         `We cancelled your purchase from ${c.store} in order ${oref}. We’re processing the full refund to your original payment method and will let you know when it’s issued.`, `Nous avons annulé votre achat chez ${c.store} dans la commande ${oref}. Nous traitons le remboursement complet sur votre moyen de paiement d’origine et vous préviendrons quand il sera effectué.`, `Nou anile acha ou nan ${c.store} nan kòmand ${oref}. N ap trete ranbousman konplè a sou metòd peman orijinal ou epi n ap fè w konnen lè l fèt.`], 'APPROVED');
      if (c.requested_by_role !== 'SELLER')
        await toSeller(['Pedido cancelado', 'Order cancelled', 'Commande annulée', 'Kòmand anile'],
          [`La compra del pedido ${oref} fue cancelada antes del envío. No la prepares ni la envíes; el stock volvió a tu inventario.`,
           `The purchase in order ${oref} was cancelled before shipping. Don’t prepare or ship it; the stock is back in your inventory.`, `L’achat de la commande ${oref} a été annulé avant l’expédition. Ne le préparez pas et ne l’expédiez pas ; le stock est de retour dans votre inventaire.`, `Acha nan kòmand ${oref} anile anvan li pati. Pa prepare l ni voye l; stòk la retounen nan envantè ou.`], 'APPROVED');
      return;
    }
    const s = await this.sellerContact(c.seller_id);
    await toCustomer(['Reembolso realizado', 'Refund issued', 'Remboursement effectué', 'Ranbousman fèt'],
      [`Te devolvimos ${money(c.refunded ?? '0', c.currency_code, 'es')} por la cancelación de tu compra del pedido ${oref}, al mismo medio de pago. Según tu banco puede tardar de 5 a 10 días hábiles en verse.`,
       `We refunded ${money(c.refunded ?? '0', c.currency_code, 'en')} for the cancelled purchase in order ${oref} to your original payment method. Depending on your bank it can take 5–10 business days to show.`, `Nous vous avons remboursé ${money(c.refunded ?? '0', c.currency_code, 'fr')} pour l’achat annulé de la commande ${oref}, sur votre moyen de paiement d’origine. Selon votre banque, cela peut prendre 5 à 10 jours ouvrés pour apparaître.`, `Nou ranbouse w ${money(c.refunded ?? '0', c.currency_code, 'ht')} pou acha anile nan kòmand ${oref}, sou metòd peman orijinal ou. Selon bank ou, li ka pran 5 a 10 jou travay pou parèt.`], 'REFUNDED',
      (t, l) => (c.refund_number ? rows([[t('Reembolso', 'Refund', 'Remboursement', 'Ranbousman'), esc(refundRef(c.refund_number))], [t('Monto', 'Amount', 'Montant', 'Montan'), esc(money(c.refunded ?? '0', c.currency_code, l))], [t('Pedido', 'Order', 'Commande', 'Kòmand'), esc(oref)]]) : ''));
    if (s) await toSeller(['Cancelación reembolsada', 'Cancellation refunded', 'Annulation remboursée', 'Anilasyon ranbouse'],
      [`Se reembolsó al cliente la compra cancelada del pedido ${oref}; tu ingreso pendiente de ese pedido se anuló.`,
       `The cancelled purchase in order ${oref} was refunded to the customer; your pending earnings from that order were voided.`, `L’achat annulé de la commande ${oref} a été remboursé au client ; vos gains en attente de cette commande ont été annulés.`, `Acha anile nan kòmand ${oref} ranbouse bay kliyan an; benefis an atant ou pou kòmand sa a anile.`], 'REFUNDED');
  }

  async returnEvent(returnId: string, event: 'REQUESTED' | 'IN_TRANSIT' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'INSPECTED' | 'REFUNDED' | 'CLOSED_NO_REFUND' | 'LABEL_READY') {
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
          ? [t('Nueva solicitud de devolución', 'New return request', 'Nouvelle demande de retour', 'Nouvo demann retou'), t(`Un cliente pidió devolver productos del pedido ${oref}: ${r.products}. Revísala y apruébala o recházala.`, `A customer asked to return items from order ${oref}: ${r.products}. Review it and approve or reject it.`, `Un client a demandé à retourner des articles de la commande ${oref} : ${r.products}. Examinez-la puis approuvez-la ou refusez-la.`, `Yon kliyan mande retounen atik nan kòmand ${oref}: ${r.products}. Revize l epi apwouve oswa refize l.`)]
          : [t('El cliente envió la devolución', 'The customer shipped the return', 'Le client a expédié le retour', 'Kliyan an voye retou a'), t(`El cliente despachó la devolución ${ref} con ${r.carrier}${r.tracking_number ? ` (guía ${r.tracking_number})` : ''}. Márcala como recibida cuando llegue.`, `The customer shipped return ${ref} with ${r.carrier}${r.tracking_number ? ` (tracking ${r.tracking_number})` : ''}. Mark it as received when it arrives.`, `Le client a expédié le retour ${ref} avec ${r.carrier}${r.tracking_number ? ` (suivi ${r.tracking_number})` : ''}. Marquez-le comme reçu à son arrivée.`, `Kliyan an voye retou ${ref} ak ${r.carrier}${r.tracking_number ? ` (swivi ${r.tracking_number})` : ''}. Make l resevwa lè l rive.`)];
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
          body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(s.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`),
          cta: { label: t('Ver devolución', 'View return', 'Voir le retour', 'Wè retou a'), url: `${webUrl()}/vendedor/devoluciones/${returnId}` },
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
      APPROVED: [t('Devolución aprobada', 'Return approved', 'Retour approuvé', 'Retou apwouve'), t(`${r.store} aprobó tu devolución ${ref}. Envía el paquete a la dirección que verás en la solicitud y registra la guía.`, `${r.store} approved your return ${ref}. Ship the package to the address shown in the request and add the tracking number.`, `${r.store} a approuvé votre retour ${ref}. Expédiez le colis à l’adresse indiquée dans la demande et ajoutez le numéro de suivi.`, `${r.store} apwouve retou ${ref} ou. Voye koli a nan adrès ki nan demann lan epi ajoute nimewo swivi a.`)],
      REJECTED: [t('Devolución rechazada', 'Return rejected', 'Retour refusé', 'Retou refize'), t(`${r.store} rechazó tu devolución ${ref}.${r.rejection_detail ? ` Motivo: ${r.rejection_detail}` : ''} Si no estás de acuerdo, abre un reporte en el centro de ayuda.`, `${r.store} rejected your return ${ref}.${r.rejection_detail ? ` Reason: ${r.rejection_detail}` : ''} If you disagree, open a report in the help center.`, `${r.store} a refusé votre retour ${ref}.${r.rejection_detail ? ` Motif : ${r.rejection_detail}` : ''} Si vous n’êtes pas d’accord, ouvrez un signalement dans le centre d’aide.`, `${r.store} refize retou ${ref} ou.${r.rejection_detail ? ` Rezon: ${r.rejection_detail}` : ''} Si w pa dakò, louvri yon rapò nan sant èd la.`)],
      RECEIVED: [t('La tienda recibió tu devolución', 'The store received your return', 'La boutique a reçu votre retour', 'Boutik la resevwa retou ou'), t(`${r.store} recibió el paquete de la devolución ${ref} y lo está revisando.`, `${r.store} received the package for return ${ref} and is checking it.`, `${r.store} a reçu le colis du retour ${ref} et le vérifie.`, `${r.store} resevwa koli retou ${ref} a epi l ap verifye l.`)],
      INSPECTED: [t('Devolución revisada', 'Return checked', 'Retour vérifié', 'Retou verifye'), t(`${r.store} revisó los productos de la devolución ${ref}. Procesaremos tu reembolso en breve.`, `${r.store} checked the items of return ${ref}. We will process your refund shortly.`, `${r.store} a vérifié les articles du retour ${ref}. Nous allons traiter votre remboursement sous peu.`, `${r.store} verifye atik retou ${ref} yo. N ap trete ranbousman ou talè.`)],
      REFUNDED: [t('Reembolso realizado', 'Refund issued', 'Remboursement effectué', 'Ranbousman fèt'), t(`Te devolvimos ${amount} por la devolución ${ref} al mismo medio de pago. Según tu banco puede tardar de 5 a 10 días hábiles en verse.`, `We refunded ${amount} for return ${ref} to your original payment method. Depending on your bank it can take 5–10 business days to show.`, `Nous vous avons remboursé ${amount} pour le retour ${ref}, sur votre moyen de paiement d’origine. Selon votre banque, cela peut prendre 5 à 10 jours ouvrés pour apparaître.`, `Nou ranbouse w ${amount} pou retou ${ref}, sou metòd peman orijinal ou. Selon bank ou, li ka pran 5 a 10 jou travay pou parèt.`)],
      LABEL_READY: [t('Tu etiqueta de devolución está lista', 'Your return label is ready', 'Votre étiquette de retour est prête', 'Etikèt retou ou pare'), t(`Descarga la etiqueta prepagada de la devolución ${ref}, pégala en el paquete y entrégalo a la transportadora. No tienes que pagar el envío.`, `Download the prepaid label for return ${ref}, stick it on the package and hand it to the carrier. You don’t pay for shipping.`, `Téléchargez l’étiquette prépayée du retour ${ref}, collez-la sur le colis et remettez-le au transporteur. Vous ne payez pas l’envoi.`, `Telechaje etikèt prepeye retou ${ref} a, kole l sou koli a epi remèt li bay transpòtè a. Ou pa peye livrezon an.`)],
      CLOSED_NO_REFUND: [t('Devolución cerrada', 'Return closed', 'Retour clôturé', 'Retou fèmen'), t(`La revisión de la devolución ${ref} no aceptó unidades para reembolso. Si tienes dudas, abre un reporte en el centro de ayuda.`, `The inspection of return ${ref} accepted no units for a refund. If you have questions, open a report in the help center.`, `L’inspection du retour ${ref} n’a accepté aucune unité pour remboursement. Pour toute question, ouvrez un signalement dans le centre d’aide.`, `Enspeksyon retou ${ref} a pa aksepte okenn inite pou ranbouse. Si w gen kesyon, louvri yon rapò nan sant èd la.`)],
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
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(u.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`) +
          (event === 'REFUNDED' && r.refund_number ? rows([[t('Reembolso', 'Refund', 'Remboursement', 'Ranbousman'), esc(refundRef(r.refund_number))], [t('Monto', 'Amount', 'Montant', 'Montan'), esc(amount)], [t('Pedido', 'Order', 'Commande', 'Kòmand'), esc(oref)]]) : ''),
        cta: { label: event === 'LABEL_READY' ? t('Descargar etiqueta', 'Download label', 'Télécharger l’étiquette', 'Telechaje etikèt') : t('Ver mi devolución', 'View my return', 'Voir mon retour', 'Wè retou mwen'), url: `${webUrl()}/cuenta/devoluciones/${returnId}` },
        text: line,
      }),
    });
    if (event === 'REFUNDED') {
      const s = await this.sellerContact(r.seller_id);
      if (s) {
        const ts = tr(s.locale);
        const line2 = ts(`Se reembolsaron ${money(r.refunded, r.currency_code, s.locale)} al cliente por la devolución ${ref}; el monto correspondiente se descontó de tu balance.`, `${money(r.refunded, r.currency_code, s.locale)} was refunded to the customer for return ${ref}; your share was deducted from your balance.`, `${money(r.refunded, r.currency_code, s.locale)} ont été remboursés au client pour le retour ${ref} ; votre part a été déduite de votre solde.`, `${money(r.refunded, r.currency_code, s.locale)} ranbouse bay kliyan an pou retou ${ref}; pati pa w la retire sou balans ou.`);
        await this.send({
          template: 'REFUND_COMPLETED_SELLER',
          dedupeKey: `return:${returnId}:REFUNDED:seller`,
          to: s.email,
          userId: s.ownerUserId,
          entityType: 'RETURN_REQUEST',
          entityId: returnId,
          message: layout({
            locale: s.locale,
            subject: `${ts('Reembolso de devolución', 'Return refund', 'Remboursement de retour', 'Ranbousman retou')} (${ref})`,
            preheader: line2,
            title: ts('Reembolso de devolución', 'Return refund', 'Remboursement de retour', 'Ranbousman retou'),
            body: p(`${ts('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(s.name)}, ${esc(line2.charAt(0).toLowerCase() + line2.slice(1))}`),
            cta: { label: ts('Ver devolución', 'View return', 'Voir le retour', 'Wè retou a'), url: `${webUrl()}/vendedor/devoluciones/${returnId}` },
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
        ? [t('Recibimos tu solicitud para eliminar la cuenta', 'We received your account deletion request', 'Nous avons reçu votre demande de suppression de compte', 'Nou resevwa demann ou pou efase kont ou'),
           t('Nuestro equipo la revisará en un máximo de 3 días hábiles. Mientras tanto puedes cancelarla desde Seguridad.', 'Our team will review it within 3 business days. Meanwhile you can cancel it from Security.', 'Notre équipe l’examinera sous 3 jours ouvrés. En attendant, vous pouvez l’annuler depuis Sécurité.', 'Ekip nou an ap revize l nan 3 jou travay. Pandan tan sa a ou ka anile l nan Sekirite.')]
        : [t('No pudimos eliminar tu cuenta', 'We could not delete your account', 'Nous n’avons pas pu supprimer votre compte', 'Nou pa t ka efase kont ou'),
           t(`Tu solicitud de eliminación fue rechazada.${r.decision_note ? ` Motivo: ${r.decision_note}` : ''}`, `Your deletion request was rejected.${r.decision_note ? ` Reason: ${r.decision_note}` : ''}`, `Votre demande de suppression a été refusée.${r.decision_note ? ` Motif : ${r.decision_note}` : ''}`, `Demann efasman ou refize.${r.decision_note ? ` Rezon: ${r.decision_note}` : ''}`)];
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
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')} ${esc(u.name)}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`),
        cta: { label: t('Ir a Seguridad', 'Go to Security', 'Aller à Sécurité', 'Ale nan Sekirite'), url: `${webUrl()}/cuenta/seguridad` },
        text: line,
      }),
    });
  }

  /** Last e-mail to the address the account had (the account itself no longer exists). */
  async accountDeleted(email: string, name: string | null, locale: Locale, requestId: string) {
    const t = tr(locale);
    const line = t(`Eliminamos tu cuenta de ${brand()} y tus datos personales. Los registros de compras que la ley nos obliga a conservar quedaron anónimos.`,
                   `We deleted your ${brand()} account and your personal data. Purchase records we are legally required to keep are now anonymous.`, `Nous avons supprimé votre compte ${brand()} et vos données personnelles. Les traces d’achat que la loi nous oblige à conserver sont désormais anonymes.`, `Nou efase kont ${brand()} ou ak done pèsonèl ou. Dosye acha lalwa oblije nou kenbe yo vin san non kounye a.`);
    await this.send({
      template: 'ACCOUNT_DELETED',
      dedupeKey: `account-deletion:${requestId}:DELETED`,
      to: email,
      userId: null,
      entityType: 'ACCOUNT_DELETION',
      entityId: requestId,
      message: layout({
        locale,
        subject: t('Tu cuenta fue eliminada', 'Your account was deleted', 'Votre compte a été supprimé', 'Kont ou efase'),
        preheader: line,
        title: t('Cuenta eliminada', 'Account deleted', 'Compte supprimé', 'Kont efase'),
        body: p(`${t('Hola', 'Hi', 'Bonjour', 'Bonjou')}${name ? ` ${esc(name)}` : ''}, ${esc(line.charAt(0).toLowerCase() + line.slice(1))}`) +
          p(t(`Gracias por haber sido parte de ${brandHtml()}. Si cambias de opinión, puedes crear una cuenta nueva cuando quieras.`, `Thank you for being part of ${brandHtml()}. If you change your mind, you can create a new account at any time.`, `Merci d’avoir fait partie de ${brandHtml()}. Si vous changez d’avis, vous pouvez créer un nouveau compte à tout moment.`, `Mèsi paske w te fè pati ${brandHtml()}. Si w chanje lide, ou ka kreye yon nouvo kont nenpòt lè.`)),
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

  /**
   * Support request from a visitor without an account (or who can't sign in): it goes to the
   * support inbox with Reply-To set to the visitor, so the team answers by e-mail. Nothing is sent
   * to the visitor's address, so the public form can't be used to e-mail third parties.
   */
  async guestSupportRequest(i: { id: string; name: string; email: string; category: string; priority: string; subject: string; description: string; url?: string; orderNumber?: string; storeName?: string; platform?: string; locale: string }) {
    const to = mailRuntime.supportEmail || config.mailReplyTo;
    if (!to) return 'SKIPPED';
    const html = [
      p(`<b>${esc(i.subject)}</b>`),
      rows([
        ['Nombre', esc(i.name)], ['Correo', esc(i.email)], ['Tipo', esc(i.category)], ['Prioridad', esc(i.priority)], ['Idioma', esc(i.locale)],
        ...(i.orderNumber ? [['Pedido', esc(i.orderNumber)] as [string, string]] : []),
        ...(i.storeName ? [['Tienda', esc(i.storeName)] as [string, string]] : []),
        ...(i.url ? [['URL', esc(i.url)] as [string, string]] : []),
        ...(i.platform ? [['Plataforma', esc(i.platform)] as [string, string]] : []),
      ]),
      p(esc(i.description).replace(/\n/g, '<br>')),
      p('Responde a este correo para contestar directamente a la persona (sin cuenta en el marketplace).'),
    ].join('');
    return this.send({
      template: 'SUPPORT_GUEST_REQUEST',
      dedupeKey: `guest-support:${i.id}`,
      to,
      replyTo: i.email,
      entityType: 'SUPPORT_GUEST_REQUEST',
      message: layout({
        locale: 'es',
        subject: `[Soporte · sin cuenta] ${i.subject}`.slice(0, 180),
        preheader: `${i.name} <${i.email}>`,
        title: 'Consulta de soporte sin cuenta',
        body: html,
        text: `${i.name} <${i.email}>\n${i.category} · ${i.priority}\n${i.subject}\n\n${i.description}${i.orderNumber ? `\nPedido: ${i.orderNumber}` : ''}${i.storeName ? `\nTienda: ${i.storeName}` : ''}${i.url ? `\nURL: ${i.url}` : ''}`,
      }),
    });
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
        subject: t(`Recibimos tu reporte ${x.code}`, `We received your report ${x.code}`, `Nous avons reçu votre signalement ${x.code}`, `Nou resevwa rapò ou ${x.code}`),
        preheader: t('Nuestro equipo lo revisará pronto.', 'Our team will review it shortly.', 'Notre équipe l’examinera sous peu.', 'Ekip nou an ap revize l talè.'),
        title: t('Reporte recibido', 'Report received', 'Signalement reçu', 'Rapò resevwa'),
        body: p(t(`Hola ${esc(x.u.name)}, recibimos tu reporte <b>«${esc(x.tk.subject)}»</b>. Tu código de seguimiento es <b>${x.code}</b>. Te escribiremos cuando tengamos novedades.`,
                  `Hi ${esc(x.u.name)}, we received your report <b>“${esc(x.tk.subject)}”</b>. Your tracking code is <b>${x.code}</b>. We’ll write back when we have news.`, `Bonjour ${esc(x.u.name)}, nous avons reçu votre signalement <b>« ${esc(x.tk.subject)} »</b>. Votre code de suivi est <b>${x.code}</b>. Nous vous écrirons dès que nous aurons du nouveau.`, `Bonjou ${esc(x.u.name)}, nou resevwa rapò ou <b>«${esc(x.tk.subject)}»</b>. Kòd swivi ou se <b>${x.code}</b>. N ap ekri w lè nou gen nouvèl.`)),
        cta: { label: t('Ver mis reportes', 'View my reports', 'Voir mes signalements', 'Wè rapò mwen yo'), url: `${webUrl()}/cuenta/reportes` },
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
        subject: t(`Respuesta a tu reporte ${x.code}`, `Reply to your report ${x.code}`, `Réponse à votre signalement ${x.code}`, `Repons pou rapò ou ${x.code}`),
        preheader: body.slice(0, 120),
        title: t('Tienes una respuesta de soporte', 'You have a reply from support', 'Vous avez une réponse du support', 'Ou gen yon repons sipò'),
        body:
          p(t(`Hola ${esc(x.u.name)}, nuestro equipo respondió tu reporte <b>«${esc(x.tk.subject)}»</b>:`, `Hi ${esc(x.u.name)}, our team replied to your report <b>“${esc(x.tk.subject)}”</b>:`, `Bonjour ${esc(x.u.name)}, notre équipe a répondu à votre signalement <b>« ${esc(x.tk.subject)} »</b> :`, `Bonjou ${esc(x.u.name)}, ekip nou an reponn rapò ou <b>«${esc(x.tk.subject)}»</b>:`)) +
          `<div style="margin:0 0 16px;padding:14px 16px;background:#f1f6ff;border-left:4px solid #0a6cf5;border-radius:8px;white-space:pre-wrap">${esc(body.trim())}</div>`,
        cta: { label: t('Responder', 'Reply', 'Réponse', 'Repons'), url: `${webUrl()}/cuenta/reportes` },
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
    const word = resolved ? t('resuelto', 'resolved', 'résolu', 'rezoud') : t('cerrado', 'closed', 'clôturé', 'fèmen');
    await this.send({
      template: `SUPPORT_${status}`,
      dedupeKey: `ticket-status:${ticketId}:${status}`,
      to: x.u.email,
      userId: x.tk.requester_user_id,
      entityType: 'SUPPORT_TICKET',
      entityId: ticketId,
      message: layout({
        locale: x.u.locale,
        subject: t(`Tu reporte ${x.code} fue ${word}`, `Your report ${x.code} was ${word}`, `Votre signalement ${x.code} a été ${word}`, `Rapò ou ${x.code} ${word}`),
        preheader: t('Gracias por ayudarnos a mejorar.', 'Thanks for helping us improve.', 'Merci de nous aider à nous améliorer.', 'Mèsi paske w ede nou amelyore.'),
        title: resolved ? t('Reporte resuelto', 'Report resolved', 'Signalement résolu', 'Rapò rezoud') : t('Reporte cerrado', 'Report closed', 'Signalement clôturé', 'Rapò fèmen'),
        body: p(t(`Hola ${esc(x.u.name)}, marcamos tu reporte <b>«${esc(x.tk.subject)}»</b> (${x.code}) como ${word}. Si el problema continúa, puedes responder desde tus reportes.${resolved ? ' Cuéntanos cómo te atendimos: puedes calificar la atención en el reporte.' : ''}`,
                  `Hi ${esc(x.u.name)}, we marked your report <b>“${esc(x.tk.subject)}”</b> (${x.code}) as ${word}. If the problem continues, you can reply from your reports.${resolved ? ' Tell us how we did: you can rate the help on the report.' : ''}`, `Bonjour ${esc(x.u.name)}, nous avons marqué votre signalement <b>« ${esc(x.tk.subject)} »</b> (${x.code}) comme ${word}. Si le problème persiste, vous pouvez répondre depuis vos signalements.${resolved ? ' Dites-nous comment nous vous avons aidé : vous pouvez noter l’assistance dans le signalement.' : ''}`, `Bonjou ${esc(x.u.name)}, nou make rapò ou <b>«${esc(x.tk.subject)}»</b> (${x.code}) kòm ${word}. Si pwoblèm nan kontinye, ou ka reponn nan rapò ou yo.${resolved ? ' Di nou kijan nou te ede w: ou ka bay nòt sèvis la nan rapò a.' : ''}`)),
        cta: resolved
          ? { label: t('Calificar la atención', 'Rate the help', 'Noter l’assistance', 'Bay nòt sèvis la'), url: `${webUrl()}/cuenta/reportes?r=${ticketId}` }
          : { label: t('Ver mis reportes', 'View my reports', 'Voir mes signalements', 'Wè rapò mwen yo'), url: `${webUrl()}/cuenta/reportes` },
        text: `${x.code}: ${word}`,
      }),
    });
  }
}

function countryName(code: string | null | undefined, l: Locale) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([intlLocale(l)], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
