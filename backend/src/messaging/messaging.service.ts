import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { badRequest, forbidden, notFound } from '../common/errors';
import { RequestUser, isStaff } from '../auth/auth';
import { mediaUrl } from '../catalog/catalog.sql';
import { PoolClient } from 'pg';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { NotificationsService } from '../notifications/notifications.service';
import { config } from '../config';

export type UploadedFile = { buffer: Buffer; mimetype: string; originalname?: string; size: number };
export const MAX_MESSAGE_FILES = 4;
export interface AttachmentView { id: string; kind: string; name: string; size: number; mime: string; width?: number | null; height?: number | null }

export type Inbox = { as: 'customer' } | { as: 'seller'; sellerId: string } | { as: 'staff' };

@Injectable()
export class MessagingService {
  constructor(
    private readonly db: DbService,
    private readonly storage: SupabaseAdminService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ attachments
  /** Stores the files (outside the DB transaction) and returns their asset ids. */
  async uploadFiles(userId: string, files: UploadedFile[] = []) {
    if (files.length > MAX_MESSAGE_FILES) throw badRequest('TOO_MANY_FILES', `Puedes adjuntar hasta ${MAX_MESSAGE_FILES} archivos por mensaje.`);
    const out: { id: string; kind: string }[] = [];
    for (const f of files) out.push(await this.storage.uploadAttachment(userId, f));
    return out;
  }

  /** Links already-uploaded assets to a message (the DB checks the sender uploaded them). */
  async attach(c: PoolClient, conversationId: string, messageId: string, assets: { id: string; kind: string }[]) {
    let i = 0;
    for (const a of assets)
      await this.db.exec(
        `insert into public.conversation_message_attachments (message_id, conversation_id, asset_id, attachment_kind, sort_order)
         values ($1,$2,$3,$4,$5) on conflict (message_id, asset_id) do nothing`,
        [messageId, conversationId, a.id, a.kind, i++],
        c,
      );
  }

  async attachmentsByMessage(messageIds: string[]): Promise<Map<string, AttachmentView[]>> {
    const map = new Map<string, AttachmentView[]>();
    if (!messageIds.length) return map;
    const rows = await this.db.many(
      `select a.message_id, s.id, a.attachment_kind as kind, coalesce(s.original_filename, 'archivo') as name, s.size_bytes::int as size, s.mime_type as mime,
              s.width_pixels as width, s.height_pixels as height
         from public.conversation_message_attachments a join public.assets s on s.id = a.asset_id
        where a.message_id = any($1::uuid[]) and a.status = 'ACTIVE' and s.status = 'READY' order by a.sort_order`,
      [messageIds],
    );
    for (const r of rows) {
      const list = map.get(r.message_id) ?? [];
      list.push({ id: r.id, kind: r.kind, name: r.name, size: r.size, mime: r.mime, width: r.width, height: r.height });
      map.set(r.message_id, list);
    }
    return map;
  }

  /** Streams an attachment to someone with access to its conversation. */
  async attachmentFile(user: RequestUser, conversationId: string, assetId: string) {
    await this.access(user, conversationId);
    const a = await this.db.one(
      `select s.storage_bucket, s.storage_key, s.mime_type, coalesce(s.original_filename, 'archivo') as name
         from public.conversation_message_attachments a join public.assets s on s.id = a.asset_id
        where a.conversation_id = $1 and a.asset_id = $2 and a.status = 'ACTIVE' and s.status = 'READY' limit 1`,
      [conversationId, assetId],
    );
    if (!a) throw notFound('Archivo');
    return { buffer: await this.storage.download(a.storage_bucket, a.storage_key), mime: a.mime_type as string, name: a.name as string };
  }

  /** Bell notice for the other side of the conversation. */
  async notifyMessage(conversationId: string, senderId: string, body: string) {
    const c = await this.db.one(
      `select c.id, c.conversation_type, c.requester_user_id, c.seller_id, coalesce(ssp.display_name, s.slug) as store,
              coalesce(nullif(up.display_name,''), split_part(u.email::text,'@',1)) as sender
         from public.conversations c left join public.sellers s on s.id = c.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         join public.users u on u.id = $2 left join public.user_profiles up on up.user_id = u.id where c.id = $1`,
      [conversationId, senderId],
    );
    if (!c || !['PRODUCT_INQUIRY', 'ORDER'].includes(c.conversation_type)) return;
    const preview = body.length > 140 ? body.slice(0, 137) + '…' : body;
    if (senderId === c.requester_user_id) {
      const team = await this.db.many(
        `select owner_user_id as user_id from public.sellers where id = $1
         union select cp.user_id from public.conversation_participants cp where cp.conversation_id = $2 and cp.status = 'ACTIVE' and cp.participant_role = 'SELLER_MEMBER'`,
        [c.seller_id, conversationId],
      ).catch(() => this.db.many(`select owner_user_id as user_id from public.sellers where id = $1`, [c.seller_id]));
      for (const t of team)
        if (t.user_id !== senderId) await this.notifications.message(t.user_id, conversationId, `Nuevo mensaje de ${c.sender}`, preview, `${config.webUrl}/vendedor/mensajes?c=${conversationId}`);
    } else {
      await this.notifications.message(c.requester_user_id, conversationId, `${c.store ?? 'La tienda'} te respondió`, preview, `${config.webUrl}/cuenta/mensajes?c=${conversationId}`);
    }
  }

  async list(user: RequestUser, inbox: Inbox, q?: string) {
    const params: unknown[] = [user.id];
    let scope: string;
    if (inbox.as === 'customer') scope = `c.requester_user_id = $1`;
    else if (inbox.as === 'seller') {
      params.push(inbox.sellerId);
      scope = `c.seller_id = $2`;
    } else scope = `true`;
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      scope += ` and (coalesce(ssp.display_name, s.slug) ilike $${params.length} or coalesce(c.subject,'') ilike $${params.length}
                      or coalesce(up.display_name, u.email::text) ilike $${params.length})`;
    }
    const rows = await this.db.many(
      `select c.id, c.conversation_type, c.status, c.subject, c.last_message_at, c.created_at, c.product_id, c.order_id,
              s.id as seller_id, s.slug as seller_slug, coalesce(ssp.display_name, s.slug) as seller_name, ssp.logo_asset_id,
              (s.verification_status = 'VERIFIED') as seller_verified,
              coalesce(up.display_name, u.email::text) as customer_name,
              p.title as product_title, p.slug as product_slug,
              lm.body_text as last_body, lm.sender_user_id as last_sender,
              (select count(*) from public.conversation_messages m
                where m.conversation_id = c.id and m.status = 'SENT' and m.sender_user_id is distinct from $1
                  and m.sequence_number > coalesce((select lr.sequence_number from public.conversation_participants cp
                                                     join public.conversation_messages lr on lr.id = cp.last_read_message_id
                                                    where cp.conversation_id = c.id and cp.user_id = $1), 0))::int as unread
         from public.conversations c
         left join public.sellers s on s.id = c.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         join public.users u on u.id = c.requester_user_id
         left join public.user_profiles up on up.user_id = u.id
         left join public.products p on p.id = c.product_id
         left join lateral (select body_text, sender_user_id from public.conversation_messages m
                             where m.conversation_id = c.id and m.status = 'SENT' order by m.sequence_number desc limit 1) lm on true
        where ${scope} and c.conversation_type in ('PRODUCT_INQUIRY','ORDER') and c.status <> 'ARCHIVED'
        order by coalesce(c.last_message_at, c.created_at) desc limit 100`,
      params,
    );
    return rows.map((r: any) => ({
      id: r.id,
      type: r.conversation_type,
      status: r.status,
      subject: r.subject,
      lastMessageAt: r.last_message_at ?? r.created_at,
      lastMessage: r.last_body,
      lastFromMe: r.last_sender === user.id,
      unread: r.unread,
      seller: { id: r.seller_id, slug: r.seller_slug, name: r.seller_name, verified: r.seller_verified, logoUrl: r.logo_asset_id ? mediaUrl(r.logo_asset_id) : null },
      customer: { name: r.customer_name },
      product: r.product_id ? { id: r.product_id, title: r.product_title, slug: r.product_slug } : null,
      orderId: r.order_id,
    }));
  }

  async access(user: RequestUser, conversationId: string) {
    const c = await this.db.one(`select * from public.conversations where id = $1`, [conversationId]);
    if (!c) throw notFound('Conversación');
    const isRequester = c.requester_user_id === user.id;
    const isSeller = !!c.seller_id && user.sellers.some((s) => s.id === c.seller_id);
    if (!isRequester && !isSeller && !isStaff(user, 'MODERATOR', 'SUPPORT')) throw forbidden();
    if (isSeller && !isRequester) {
      const part = await this.db.one(`select 1 from public.conversation_participants where conversation_id = $1 and user_id = $2 and status = 'ACTIVE'`, [c.id, user.id]);
      if (!part) await this.db.tx((tx) => this.db.exec(`select public.join_seller_conversation($1, $2)`, [c.id, user.id], tx));
    }
    return c;
  }

  async get(user: RequestUser, conversationId: string) {
    const c = await this.access(user, conversationId);
    const [messages, seller, product] = await Promise.all([
      this.db.many(
        `select m.id, m.sequence_number::int as seq, m.sender_user_id, m.message_type, m.status,
                case when m.status = 'SENT' then m.body_text else 'Mensaje eliminado por moderación' end as body,
                m.sent_at, cp.participant_role as role
           from public.conversation_messages m
           left join public.conversation_participants cp on cp.conversation_id = m.conversation_id and cp.user_id = m.sender_user_id
          where m.conversation_id = $1 order by m.sequence_number desc limit 200`,
        [c.id],
      ),
      c.seller_id
        ? this.db.one(
            `select s.id, s.slug, coalesce(ssp.display_name, s.slug) as name, ssp.logo_asset_id, (s.verification_status='VERIFIED') as verified,
                    (select count(*) from public.seller_followers f where f.seller_id = s.id)::int as followers,
                    (select coalesce(avg(rating),0)::numeric(3,2)::text from public.product_reviews r where r.seller_id = s.id and r.status='PUBLISHED') as rating,
                    (select count(*) from public.product_reviews r where r.seller_id = s.id and r.status='PUBLISHED')::int as reviews
               from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id where s.id = $1`,
            [c.seller_id],
          )
        : null,
      c.product_id
        ? this.db.one(
            `select p.id, p.slug, p.title, p.short_description,
                    (select min(vpv.amount)::text from public.product_variants v join public.variant_price_versions vpv on vpv.variant_id = v.id
                      where v.product_id = p.id and vpv.status = 'ACTIVE') as price,
                    (select pm.asset_id from public.product_media pm where pm.product_id = p.id order by pm.is_primary desc, pm.sort_order limit 1) as image_id,
                    (select coalesce(avg(rating),0)::numeric(3,2)::text from public.product_reviews r where r.product_id = p.id and r.status='PUBLISHED') as rating,
                    (select count(*) from public.product_reviews r where r.product_id = p.id and r.status='PUBLISHED')::int as reviews
               from public.products p where p.id = $1`,
            [c.product_id],
          )
        : null,
    ]);
    const ordered = messages.reverse();
    const files = await this.attachmentsByMessage(ordered.filter((m: any) => m.status === 'SENT').map((m: any) => m.id));
    const last = ordered[ordered.length - 1];
    if (last) {
      const part = await this.db.one(`select 1 from public.conversation_participants where conversation_id = $1 and user_id = $2 and status='ACTIVE'`, [c.id, user.id]);
      if (part) await this.db.tx((tx) => this.db.exec(`select public.mark_conversation_read($1, $2, $3)`, [c.id, user.id, last.id], tx)).catch(() => undefined);
    }
    return {
      id: c.id,
      type: c.conversation_type,
      status: c.status,
      subject: c.subject,
      orderId: c.order_id,
      viewerRole: c.requester_user_id === user.id ? 'CUSTOMER' : user.sellers.some((s) => s.id === c.seller_id) ? 'SELLER' : 'STAFF',
      seller: seller
        ? { id: seller.id, slug: seller.slug, name: seller.name, verified: seller.verified, logoUrl: seller.logo_asset_id ? mediaUrl(seller.logo_asset_id) : null, followers: seller.followers, rating: Number(seller.rating), reviews: seller.reviews }
        : null,
      product: product
        ? { id: product.id, slug: product.slug, title: product.title, shortDescription: product.short_description, price: product.price, imageUrl: product.image_id ? mediaUrl(product.image_id) : null, rating: Number(product.rating), reviews: product.reviews }
        : null,
      messages: ordered.map((m: any) => ({
        id: m.id,
        seq: m.seq,
        mine: m.sender_user_id === user.id,
        role: m.role,
        type: m.message_type,
        body: m.body,
        sentAt: m.sent_at,
        attachments: files.get(m.id) ?? [],
      })),
    };
  }

  async start(user: RequestUser, input: { sellerId?: string; productId?: string; orderId?: string; message: string }, files: UploadedFile[] = []) {
    if (!input.message?.trim()) throw badRequest('MESSAGE_REQUIRED', 'Escribe un mensaje.');
    let sellerId = input.sellerId;
    let type = 'PRODUCT_INQUIRY';
    let sellerOrderId: string | null = null;
    let subject: string;
    if (input.orderId) {
      const so = await this.db.one(
        `select so.id, so.seller_id, o.public_number from public.seller_orders so join public.orders o on o.id = so.order_id
          where o.id = $1 and o.customer_id = $2 and ($3::uuid is null or so.seller_id = $3) order by so.created_at limit 1`,
        [input.orderId, user.id, sellerId ?? null],
      );
      if (!so) throw notFound('Pedido');
      type = 'ORDER';
      sellerId = so.seller_id;
      sellerOrderId = so.id;
      subject = `Pedido #RD-${so.public_number}`;
    } else {
      const p = input.productId
        ? await this.db.one(`select id, seller_id, title from public.products where id = $1`, [input.productId])
        : null;
      if (input.productId && !p) throw notFound('Producto');
      sellerId = p?.seller_id ?? sellerId;
      if (!sellerId) throw badRequest('SELLER_REQUIRED', 'Indica la tienda.');
      if (!p) {
        // store-level inquiry: attach to the store's most relevant active product context
        const any = await this.db.one(
          `select id, title from public.products where seller_id = $1 and status = 'ACTIVE' order by published_at desc limit 1`,
          [sellerId],
        );
        if (!any) throw badRequest('STORE_HAS_NO_PRODUCTS', 'Esta tienda aún no tiene productos publicados.');
        input.productId = any.id;
        subject = `Consulta a la tienda`;
      } else subject = p.title;
    }
    if (user.sellers.some((s) => s.id === sellerId)) throw badRequest('SELF_CONVERSATION', 'No puedes escribirte a tu propia tienda.');
    // Reuse an open conversation with the same context.
    const existing = await this.db.one(
      `select id from public.conversations where requester_user_id = $1 and seller_id = $2 and conversation_type = $3
          and coalesce(product_id::text,'') = coalesce($4::text,'') and coalesce(seller_order_id::text,'') = coalesce($5::text,'')
          and status = 'OPEN' order by created_at desc limit 1`,
      [user.id, sellerId, type, type === 'ORDER' ? null : input.productId, sellerOrderId],
    );
    const assets = await this.uploadFiles(user.id, files);
    const id = await this.db.tx(async (c) => {
      const convId =
        existing?.id ??
        (await this.db.one(
          `select public.create_marketplace_conversation($1,$2,$3,$4,$5,$6,$7,$8) as id`,
          [user.id, sellerId, type, type === 'ORDER' ? null : input.productId, type === 'ORDER' ? input.orderId : null, sellerOrderId, subject, randomUUID()],
          c,
        ))!.id;
      const msg = await this.db.one(`select public.send_conversation_message($1,$2,$3,null,$4,'{}'::jsonb) as id`, [convId, user.id, input.message.trim(), randomUUID()], c);
      await this.attach(c, convId, msg!.id, assets);
      return convId;
    });
    void this.notifyMessage(id, user.id, input.message.trim());
    return { id };
  }

  async send(user: RequestUser, conversationId: string, body: string, clientKey?: string, files: UploadedFile[] = []) {
    const text = body?.trim() || (files.length ? `📎 ${files.map((f) => f.originalname ?? 'archivo').join(', ')}`.slice(0, 4000) : '');
    if (!text) throw badRequest('MESSAGE_REQUIRED', 'Escribe un mensaje o adjunta un archivo.');
    if (text.length > 4000) throw badRequest('MESSAGE_TOO_LONG', 'El mensaje es demasiado largo.');
    await this.access(user, conversationId);
    const assets = await this.uploadFiles(user.id, files);
    await this.db.tx(async (c) => {
      const msg = await this.db.one(`select public.send_conversation_message($1,$2,$3,null,$4,'{}'::jsonb) as id`, [conversationId, user.id, text, clientKey || randomUUID()], c);
      await this.attach(c, conversationId, msg!.id, assets);
    });
    void this.notifyMessage(conversationId, user.id, text);
    return this.get(user, conversationId);
  }
}
