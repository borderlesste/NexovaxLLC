import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { SettingsService, PlatformSettings } from '../settings/settings.service';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { SellerService } from '../seller/seller.service';
import { badRequest, conflict, notFound } from '../common/errors';
import { fromMinor, toMinor } from '../common/money';
import { slugify } from '../common/slug';
import { invalidateUserCache, RequestUser, RoleCode } from '../auth/auth';
import { mediaUrl } from '../catalog/catalog.sql';
import { postSaleAllocation } from '../checkout/sale-ledger';
import { MailService } from '../mail/mail.service';

const pct = (a: string | number, b: string | number) => (Number(b) > 0 ? Math.round(((Number(a) - Number(b)) / Number(b)) * 1000) / 10 : null);

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly supa: SupabaseAdminService,
    private readonly sellers: SellerService,
    private readonly mail: MailService,
  ) {}

  // ------------------------------------------------------------------ dashboard
  async dashboard(days = 30) {
    const period = `${days} days`;
    const [cur, prev, sellers, products, series, mix, attention] = await Promise.all([
      this.db.one(
        `select coalesce(sum(ofs.grand_total),0)::text as sales, count(*)::int as orders
           from public.orders o join public.order_financial_snapshots ofs on ofs.order_id = o.id
          where o.placed_at >= now() - $1::interval and o.lifecycle_status <> 'CANCELLED'`,
        [period],
      ),
      this.db.one(
        `select coalesce(sum(ofs.grand_total),0)::text as sales, count(*)::int as orders
           from public.orders o join public.order_financial_snapshots ofs on ofs.order_id = o.id
          where o.placed_at >= now() - ($1::interval * 2) and o.placed_at < now() - $1::interval and o.lifecycle_status <> 'CANCELLED'`,
        [period],
      ),
      this.db.one(`select count(*) filter (where status = 'ACTIVE')::int as active, count(*)::int as total from public.sellers`),
      this.db.one(`select count(*) filter (where status = 'ACTIVE')::int as active, count(*) filter (where status <> 'ARCHIVED')::int as total from public.products`),
      this.db.many(
        `select d::date as day, coalesce(sum(ofs.grand_total),0)::text as sales, count(o.id)::int as orders
           from generate_series(current_date - ($1::int - 1), current_date, interval '1 day') d
           left join public.orders o on o.placed_at::date = d::date and o.lifecycle_status <> 'CANCELLED'
           left join public.order_financial_snapshots ofs on ofs.order_id = o.id
          group by d order by d`,
        [days],
      ),
      this.db.many(`select public.order_display_status(id) as status, count(*)::int as count from public.orders group by 1`),
      this.db.one(
        `select (select count(*) from public.products where status = 'PENDING_REVIEW')::int as products_pending,
                (select count(*) from public.sellers where status = 'PENDING_VERIFICATION')::int as sellers_pending,
                (select count(*) from public.inventory_items where status = 'ACTIVE' and available_to_sell <= coalesce(low_stock_threshold, 5))::int as low_stock,
                (select count(*) from public.support_tickets where status in ('OPEN','IN_PROGRESS'))::int as open_tickets,
                (select count(*) from public.payouts where status = 'APPROVAL_REQUIRED')::int as payouts_pending,
                (select count(*) from public.payments where status = 'REQUIRES_ACTION')::int as transfers_pending,
                (select count(*) from public.seller_payout_accounts where verification_status = 'PENDING' and status <> 'DISABLED')::int as payout_accounts_pending`,
      ),
    ]);
    const recent = await this.db.many(
      `select o.id, 'RD-' || o.public_number as number, coalesce(up.display_name, u.email::text) as customer, o.placed_at,
              ofs.grand_total::text as total, public.order_display_status(o.id) as status
         from public.orders o join public.users u on u.id = o.customer_id left join public.user_profiles up on up.user_id = u.id
         left join public.order_financial_snapshots ofs on ofs.order_id = o.id order by o.placed_at desc limit 6`,
    );
    return {
      kpis: {
        sales: cur!.sales,
        salesChange: pct(cur!.sales, prev!.sales),
        orders: cur!.orders,
        ordersChange: pct(cur!.orders, prev!.orders),
        activeSellers: sellers!.active,
        totalSellers: sellers!.total,
        activeProducts: products!.active,
        totalProducts: products!.total,
      },
      series,
      statusMix: mix,
      recentOrders: recent,
      attention,
    };
  }

  // ------------------------------------------------------------------ products & moderation
  async products(q: { status?: string; search?: string; categoryId?: string; sellerId?: string; page?: number }) {
    const currency = await this.settings.currency();
    const params: unknown[] = [currency];
    const where = [`p.status <> 'ARCHIVED'`];
    const add = (v: unknown) => (params.push(v), `$${params.length}`);
    if (q.status) where.push(`p.status = ${add(q.status)}`);
    if (q.categoryId) where.push(`(p.category_id = ${add(q.categoryId)} or c.parent_id = $${params.length})`);
    if (q.sellerId) where.push(`p.seller_id = ${add(q.sellerId)}`);
    if (q.search?.trim()) {
      const t = add(`%${q.search.trim()}%`);
      where.push(`(p.title ilike ${t} or coalesce(ssp.display_name, s.slug) ilike ${t} or exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku ilike ${t}))`);
    }
    const page = Math.max(q.page ?? 1, 1);
    const rows = await this.db.many(
      `select p.id, p.slug, p.title, p.status, p.updated_at, c.name as category, pc.name as parent_category,
              s.id as seller_id, coalesce(ssp.display_name, s.slug) as seller,
              (select v.sku from public.product_variants v where v.product_id = p.id order by v.is_default desc limit 1) as sku,
              (select min(vpv.amount)::text from public.product_variants v join public.variant_price_versions vpv on vpv.variant_id = v.id
                where v.product_id = p.id and vpv.status = 'ACTIVE' and vpv.currency_code = $1) as price,
              coalesce((select sum(ii.on_hand) from public.inventory_items ii join public.product_variants v on v.id = ii.variant_id where v.product_id = p.id),0)::int as stock,
              (select pm.asset_id from public.product_media pm where pm.product_id = p.id order by pm.is_primary desc, pm.sort_order limit 1) as image_id,
              (select r.submitted_at from public.product_moderation_reviews r where r.product_id = p.id and r.status = 'PENDING' order by r.submitted_at desc limit 1) as submitted_at,
              count(*) over() as total
         from public.products p join public.categories c on c.id = p.category_id left join public.categories pc on pc.id = c.parent_id
         join public.sellers s on s.id = p.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where ${where.join(' and ')} order by p.updated_at desc limit 20 offset ${(page - 1) * 20}`,
      params,
    );
    const counts = await this.db.one(
      `select count(*) filter (where status <> 'ARCHIVED')::int as total, count(*) filter (where status = 'ACTIVE')::int as active,
              count(*) filter (where status = 'PENDING_REVIEW')::int as pending, count(*) filter (where status = 'DRAFT')::int as draft,
              count(*) filter (where status = 'REJECTED')::int as rejected,
              (select count(*) from public.product_moderation_reviews where status = 'APPROVED' and reviewed_at::date = current_date)::int as approved_today,
              (select count(*) from public.product_moderation_reviews where status in ('REJECTED','CHANGES_REQUESTED') and reviewed_at::date = current_date)::int as rejected_today
         from public.products`,
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id, slug: r.slug, title: r.title, status: r.status, category: r.parent_category ? `${r.parent_category} · ${r.category}` : r.category,
        seller: { id: r.seller_id, name: r.seller }, sku: r.sku, price: r.price, stock: r.stock, imageUrl: r.image_id ? mediaUrl(r.image_id) : null,
        submittedAt: r.submitted_at, updatedAt: r.updated_at,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
      counts,
      page,
    };
  }

  async productReview(productId: string) {
    const p = await this.db.one(`select seller_id from public.products where id = $1`, [productId]);
    if (!p) throw notFound('Producto');
    const detail = await this.sellers.getProduct(p.seller_id, productId);
    const seller = await this.db.one(
      `select s.id, s.slug, s.status, coalesce(ssp.display_name, s.slug) as name from public.sellers s
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id where s.id = $1`,
      [p.seller_id],
    );
    const category = await this.db.one(
      `select c.name, pc.name as parent from public.categories c left join public.categories pc on pc.id = c.parent_id where c.id = $1`,
      [detail.categoryId],
    );
    const checklist = {
      complete: !!(detail.title && detail.description?.length >= 30 && detail.categoryId),
      images: detail.media.length > 0,
      priceStock: detail.variants.every((v: any) => v.price && Number(v.price) > 0),
      policies: true,
    };
    return { ...detail, seller, category: category?.parent ? `${category.parent} · ${category.name}` : category?.name, checklist };
  }

  async moderate(admin: RequestUser, productId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES', note?: string) {
    if (decision !== 'APPROVE' && !note?.trim()) throw badRequest('REASON_REQUIRED', 'Indica el motivo para el vendedor.');
    await this.db.tx(async (c) => {
      const p = await this.db.one(
        `select p.status, s.status as seller_status from public.products p join public.sellers s on s.id = p.seller_id where p.id = $1 for update of p`,
        [productId],
        c,
      );
      if (!p) throw notFound('Producto');
      if (p.status !== 'PENDING_REVIEW') throw conflict('NOT_PENDING_REVIEW', 'El producto no está pendiente de revisión.');
      if (decision === 'APPROVE' && p.seller_status !== 'ACTIVE')
        throw conflict('SELLER_NOT_ACTIVE', 'Aprueba primero la tienda del vendedor.');
      const reviewStatus = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED';
      const updated = await this.db.exec(
        `update public.product_moderation_reviews set status = $2, reviewed_by = $3, reviewed_at = now(), decision_reason = $4, updated_at = now()
          where product_id = $1 and status = 'PENDING'`,
        [productId, reviewStatus, admin.id, note?.trim() || null],
        c,
      );
      if (!updated)
        await this.db.exec(
          `insert into public.product_moderation_reviews (product_id, submitted_product_version, status, submitted_by, reviewed_by, decision_reason, submitted_at, reviewed_at)
           select id, version, $2, $3, $3, $4, now(), now() from public.products where id = $1`,
          [productId, reviewStatus, admin.id, note?.trim() || null],
          c,
        );
      await this.sellers.transition(c, productId, 'PENDING_REVIEW', decision === 'APPROVE' ? 'ACTIVE' : decision === 'REJECT' ? 'REJECTED' : 'DRAFT', admin.id,
        note?.trim() || (decision === 'APPROVE' ? 'Aprobado por moderación' : 'Moderación'));
    });
    this.mail.fire(() => this.mail.productModerated(productId, decision, note));
    return { ok: true };
  }

  async suspendProduct(admin: RequestUser, productId: string, reason: string) {
    await this.db.tx(async (c) => {
      const p = await this.db.one(`select status from public.products where id = $1 for update`, [productId], c);
      if (!p) throw notFound('Producto');
      if (p.status === 'SUSPENDED') await this.sellers.transition(c, productId, 'SUSPENDED', 'ACTIVE', admin.id, reason || 'Reactivado por administración');
      else await this.sellers.transition(c, productId, p.status, 'SUSPENDED', admin.id, reason || 'Suspendido por administración');
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ sellers
  async sellersList(q: { status?: string; search?: string; page?: number }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`s.status = $${params.length}`);
    }
    if (q.search?.trim()) {
      params.push(`%${q.search.trim()}%`);
      where.push(`(coalesce(ssp.display_name, s.slug) ilike $${params.length} or u.email::text ilike $${params.length} or coalesce(up.display_name,'') ilike $${params.length})`);
    }
    const page = Math.max(q.page ?? 1, 1);
    const rows = await this.db.many(
      `select s.id, s.slug, s.status, s.verification_status, s.created_at, coalesce(ssp.display_name, s.slug) as name, ssp.logo_asset_id,
              coalesce(ssp.support_email::text, u.email::text) as email, coalesce(up.display_name, u.email::text) as owner,
              (select count(*) from public.products p where p.seller_id = s.id and p.status <> 'ARCHIVED')::int as products,
              (select coalesce(sum(sofs.customer_total),0)::text from public.seller_orders so
                 join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id where so.seller_id = s.id) as sales,
              count(*) over() as total
         from public.sellers s join public.users u on u.id = s.owner_user_id left join public.user_profiles up on up.user_id = u.id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        ${where.length ? 'where ' + where.join(' and ') : ''} order by s.created_at desc limit 20 offset ${(page - 1) * 20}`,
      params,
    );
    const counts = await this.db.one(
      `select count(*)::int as total, count(*) filter (where status = 'ACTIVE')::int as active,
              count(*) filter (where status = 'PENDING_VERIFICATION')::int as pending, count(*) filter (where status = 'SUSPENDED')::int as suspended
         from public.sellers`,
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id, slug: r.slug, name: r.name, email: r.email, owner: r.owner, status: r.status, verificationStatus: r.verification_status,
        createdAt: r.created_at, products: r.products, sales: r.sales, logoUrl: r.logo_asset_id ? mediaUrl(r.logo_asset_id) : null,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
      counts,
      page,
    };
  }

  async sellerDetail(sellerId: string) {
    const store = await this.sellers.store(sellerId);
    const [owner, stats, accounts] = await Promise.all([
      this.db.one(
        `select u.id, u.email::text as email, coalesce(up.display_name, u.email::text) as name, up.phone, u.created_at
           from public.sellers s join public.users u on u.id = s.owner_user_id left join public.user_profiles up on up.user_id = u.id where s.id = $1`,
        [sellerId],
      ),
      this.sellers.finance(sellerId, 365),
      this.sellers.payoutAccounts(sellerId),
    ]);
    const history = await this.db.many(
      `select h.from_status, h.to_status, h.reason, h.created_at from public.seller_status_history h where h.seller_id = $1 order by h.created_at desc limit 20`,
      [sellerId],
    );
    return { store, owner, finance: stats, payoutAccounts: accounts, history };
  }

  async sellerAction(admin: RequestUser, sellerId: string, action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REACTIVATE', reason?: string) {
    await this.db.tx(async (c) => {
      const s = await this.db.one(`select status, owner_user_id from public.sellers where id = $1 for update`, [sellerId], c);
      if (!s) throw notFound('Vendedor');
      let to: string;
      if (action === 'APPROVE' && ['PENDING_VERIFICATION', 'DRAFT', 'REJECTED'].includes(s.status)) to = 'ACTIVE';
      else if (action === 'REJECT' && ['PENDING_VERIFICATION', 'DRAFT'].includes(s.status)) to = 'REJECTED';
      else if (action === 'SUSPEND' && s.status === 'ACTIVE') to = 'SUSPENDED';
      else if (action === 'REACTIVATE' && s.status === 'SUSPENDED') to = 'ACTIVE';
      else throw conflict('INVALID_TRANSITION', 'Acción no válida para el estado actual de la tienda.');
      if ((action === 'REJECT' || action === 'SUSPEND') && !reason?.trim()) throw badRequest('REASON_REQUIRED', 'Indica el motivo.');
      await this.db.exec(
        `update public.sellers set status = $2,
                activated_at = case when $2 = 'ACTIVE' then coalesce(activated_at, now()) else activated_at end,
                suspended_at = case when $2 = 'SUSPENDED' then now() else null end,
                verification_status = case when $3 = 'APPROVE' then 'VERIFIED' when $3 = 'REJECT' then 'FAILED' else verification_status end,
                version = version + 1
          where id = $1`,
        [sellerId, to, action],
        c,
      );
      await this.db.exec(
        `insert into public.seller_status_history (seller_id, from_status, to_status, changed_by, reason) values ($1,$2,$3,$4,$5)`,
        [sellerId, s.status, to, admin.id, reason?.trim() || (action === 'APPROVE' ? 'Tienda verificada y aprobada' : 'Reactivada')],
        c,
      );
      if (action === 'APPROVE' || action === 'REJECT')
        await this.db.exec(
          `update public.seller_verifications set status = $2, reviewed_at = now(), reviewed_by = $3,
                  verified_at = case when $2 = 'VERIFIED' then now() end, rejected_at = case when $2 = 'REJECTED' then now() end,
                  failure_reason = $4
            where seller_id = $1 and status in ('PENDING','SUBMITTED','IN_REVIEW')`,
          [sellerId, action === 'APPROVE' ? 'VERIFIED' : 'REJECTED', admin.id, action === 'REJECT' ? reason : null],
          c,
        ).catch(() => undefined);
      if (to === 'SUSPENDED')
        await this.db.exec(
          `update public.products set status = 'PAUSED', paused_at = now() where seller_id = $1 and status = 'ACTIVE'`,
          [sellerId],
          c,
        );
      invalidateUserCache(s.owner_user_id);
    });
    this.mail.fire(() => this.mail.sellerStatusChanged(sellerId, action, reason));
    return this.sellerDetail(sellerId);
  }

  /** "Nuevo vendedor": creates the owner account (if needed) and the store, already approved. */
  async createSeller(admin: RequestUser, input: { ownerName: string; ownerEmail: string; password?: string; storeName: string; legalName: string; entityType: any; taxId: string; address: any }) {
    let ownerId = await this.supa.findUserIdByEmail(input.ownerEmail.trim().toLowerCase());
    let tempPassword: string | undefined;
    if (!ownerId) {
      tempPassword = input.password || `Rd${randomUUID().replace(/-/g, '').slice(0, 10)}9`;
      const u = await this.supa.createUser(input.ownerEmail.trim().toLowerCase(), tempPassword, input.ownerName);
      ownerId = u.id;
      await this.db.exec(`insert into public.user_profiles (user_id, display_name) values ($1,$2) on conflict (user_id) do nothing`, [ownerId, input.ownerName]);
    }
    const owner = { id: ownerId, email: input.ownerEmail, status: 'ACTIVE', roles: ['CUSTOMER'], sellers: await this.db.many(`select id, slug, status, true as "isOwner" from public.sellers where owner_user_id = $1`, [ownerId]) } as RequestUser;
    const r = await this.sellers.onboard(owner, input);
    await this.sellerAction(admin, r.sellerId, 'APPROVE');
    return { sellerId: r.sellerId, ownerEmail: input.ownerEmail, temporaryPassword: tempPassword ?? null };
  }

  async verifyPayoutAccount(admin: RequestUser, accountId: string, approve: boolean) {
    const n = await this.db.exec(
      `update public.seller_payout_accounts set status = $2, verification_status = $3, verified_at = case when $3 = 'VERIFIED' then now() end,
              disabled_at = case when $2 = 'DISABLED' then now() end
        where id = $1`,
      [accountId, approve ? 'ACTIVE' : 'DISABLED', approve ? 'VERIFIED' : 'FAILED'],
    );
    if (!n) throw notFound('Método de cobro');
    return { ok: true };
  }

  // ------------------------------------------------------------------ categories
  async categoriesAdmin(q: { search?: string; status?: string }) {
    const rows = await this.db.many(
      `select c.id, c.parent_id, c.name, c.slug, c.status, c.sort_order, c.updated_at,
              (select count(*) from public.categories k where k.parent_id = c.id and k.status <> 'ARCHIVED')::int as children,
              (with recursive t as (select id from public.categories where id = c.id union all select k.id from public.categories k join t on k.parent_id = t.id)
               select count(*) from public.products p where p.category_id in (select id from t) and p.status <> 'ARCHIVED')::int as products
         from public.categories c
        where c.status <> 'ARCHIVED' and ($1::text is null or c.name ilike '%' || $1 || '%' or c.slug ilike '%' || $1 || '%')
          and ($2::text is null or c.status = $2)
        order by c.sort_order, c.name`,
      [q.search?.trim() || null, q.status || null],
    );
    return rows.map((r: any) => ({ id: r.id, parentId: r.parent_id, name: r.name, slug: r.slug, status: r.status, sortOrder: r.sort_order, updatedAt: r.updated_at, children: r.children, products: r.products }));
  }

  async saveCategory(input: { id?: string; name: string; parentId?: string | null; status?: 'ACTIVE' | 'INACTIVE'; sortOrder?: number; description?: string }) {
    const slugBase = slugify(input.name, 60);
    return this.db.tx(async (c) => {
      if (input.parentId) {
        const parent = await this.db.one(`select id from public.categories where id = $1 and status <> 'ARCHIVED'`, [input.parentId], c);
        if (!parent) throw badRequest('PARENT_INVALID', 'Categoría padre inválida.');
      }
      if (input.id) {
        const r = await this.db.one(
          `update public.categories set name = $2, parent_id = $3, status = coalesce($4, status), sort_order = coalesce($5, sort_order),
                  description = coalesce($6, description), version = version + 1
            where id = $1 returning id`,
          [input.id, input.name.trim(), input.parentId ?? null, input.status ?? null, input.sortOrder ?? null, input.description ?? null],
          c,
        );
        if (!r) throw notFound('Categoría');
        return { id: r.id };
      }
      let slug = slugBase;
      for (let i = 2; await this.db.one(`select 1 from public.categories where slug = $1`, [slug], c); i++) slug = `${slugBase}-${i}`;
      const r = await this.db.one(
        `insert into public.categories (parent_id, name, slug, description, status, sort_order) values ($1,$2,$3,$4,$5,$6) returning id`,
        [input.parentId ?? null, input.name.trim(), slug, input.description ?? null, input.status ?? 'ACTIVE', input.sortOrder ?? 100],
        c,
      );
      return { id: r!.id };
    });
  }

  async archiveCategory(id: string) {
    const used = await this.db.one(
      `with recursive t as (select id from public.categories where id = $1 union all select k.id from public.categories k join t on k.parent_id = t.id)
       select (select count(*) from public.products where category_id in (select id from t) and status <> 'ARCHIVED')::int as products,
              (select count(*) from t)::int - 1 as children`,
      [id],
    );
    if (used!.products > 0) throw conflict('CATEGORY_IN_USE', 'La categoría tiene productos. Muévelos antes de archivarla.');
    if (used!.children > 0) throw conflict('CATEGORY_HAS_CHILDREN', 'Archiva primero las subcategorías.');
    await this.db.exec(`update public.categories set status = 'ARCHIVED', archived_at = now() where id = $1`, [id]);
    return { ok: true };
  }

  // ------------------------------------------------------------------ commissions & payouts
  async commissions(q: { from?: string; to?: string }) {
    const from = q.from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const to = q.to ?? new Date().toISOString();
    const [rows, kpis, monthly, rule] = await Promise.all([
      this.db.many(
        `select s.id, s.public_number, coalesce(ssp.display_name, s.slug) as name, coalesce(sum(sofs.product_net_amount),0)::text as sales,
                coalesce(sum(sofs.platform_commission_total),0)::text as commission, coalesce(sum(sofs.seller_entitlement_estimate),0)::text as net,
                coalesce(bp.available_amount,0)::text as available, coalesce(bp.pending_amount,0)::text as pending,
                (select max(p.paid_at) from public.payouts p where p.seller_id = s.id and p.status = 'PAID') as last_paid_at,
                (select p.status from public.payouts p where p.seller_id = s.id order by p.requested_at desc limit 1) as last_payout_status
           from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id
           left join public.seller_orders so on so.seller_id = s.id and so.lifecycle_status <> 'CANCELLED'
                 and exists (select 1 from public.orders o where o.id = so.order_id and o.placed_at >= $1 and o.placed_at < $2)
           left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
           left join public.seller_balance_projections bp on bp.seller_id = s.id and bp.currency_code = 'DOP'
          where s.status in ('ACTIVE','SUSPENDED')
          group by s.id, ssp.display_name, bp.available_amount, bp.pending_amount order by sum(sofs.product_net_amount) desc nulls last`,
        [from, to],
      ),
      this.db.one(
        `select (select coalesce(sum(ofs.platform_commission_total),0)::text from public.orders o join public.order_financial_snapshots ofs on ofs.order_id = o.id
                  where o.placed_at >= date_trunc('month', now()) and o.lifecycle_status <> 'CANCELLED') as month_commission,
                (select coalesce(sum(requested_amount),0)::text from public.payouts where status in ('REQUESTED','APPROVAL_REQUIRED','APPROVED','PROCESSING')) as payouts_pending,
                (select coalesce(sum(requested_amount),0)::text from public.payouts where status = 'PAID') as payouts_paid,
                (select count(*) from public.seller_balance_projections where available_amount > 0)::int as sellers_with_balance`,
      ),
      this.db.many(
        `select to_char(m, 'YYYY-MM') as month, coalesce(sum(ofs.platform_commission_total),0)::text as commission
           from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
           left join public.orders o on date_trunc('month', o.placed_at) = m and o.lifecycle_status <> 'CANCELLED'
           left join public.order_financial_snapshots ofs on ofs.order_id = o.id
          group by m order by m`,
      ),
      this.currentCommission(),
    ]);
    const payouts = await this.payouts({});
    return {
      period: { from, to },
      kpis,
      commissionRate: rule?.rate ?? null,
      sellers: rows.map((r: any) => ({
        id: r.id, code: `VND-${String(r.public_number).padStart(3, '0')}`, name: r.name, sales: r.sales, commission: r.commission, net: r.net,
        available: r.available, pending: r.pending, lastPaidAt: r.last_paid_at, lastPayoutStatus: r.last_payout_status,
      })),
      monthly,
      payouts,
    };
  }

  async currentCommission() {
    const r = await this.db.one(
      `select v.id, d.percentage_rate::text as rate, v.effective_from from public.business_rule_groups g
         join public.business_rule_versions v on v.rule_group_id = g.id and v.status = 'ACTIVE'
         join public.commission_rule_definitions d on d.rule_version_id = v.id
        where g.code = 'RD-GLOBAL-COMMISSION' order by v.effective_from desc limit 1`,
    );
    return r ? { versionId: r.id, rate: Number(r.rate), effectiveFrom: r.effective_from } : null;
  }

  async payouts(q: { status?: string }) {
    const rows = await this.db.many(
      `select p.id, 'PO-' || p.public_number as number, p.seller_id, coalesce(ssp.display_name, s.slug) as seller, p.requested_amount::text as amount,
              p.currency_code as currency, p.status, p.requested_at, p.approved_at, p.paid_at, p.failure_detail,
              a.display_label as account_label, a.display_last4 as account_last4, a.method_code
         from public.payouts p join public.sellers s on s.id = p.seller_id left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join public.seller_payout_accounts a on a.id = p.seller_payout_account_id
        where ($1::text is null or p.status = $1) order by p.requested_at desc limit 100`,
      [q.status ?? null],
    );
    return rows.map((r: any) => ({
      id: r.id, number: r.number, seller: { id: r.seller_id, name: r.seller }, amount: r.amount, currency: r.currency, status: r.status,
      requestedAt: r.requested_at, approvedAt: r.approved_at, paidAt: r.paid_at, failureDetail: r.failure_detail,
      account: { label: r.account_label, last4: r.account_last4, method: r.method_code },
    }));
  }

  async payoutAction(admin: RequestUser, payoutId: string, action: 'APPROVE' | 'MARK_PAID' | 'FAIL' | 'CANCEL', input: { reference?: string; reason?: string }) {
    await this.db.tx(async (c) => {
      const p = await this.db.one(`select status, requested_amount::text as amount from public.payouts where id = $1 for update`, [payoutId], c);
      if (!p) throw notFound('Retiro');
      const corr = randomUUID();
      if (action === 'APPROVE') {
        await this.db.exec(`select public.approve_payout($1,$2,$3,$4,now())`, [payoutId, admin.id, input.reason ?? 'Aprobado por finanzas', corr], c);
      } else if (action === 'MARK_PAID') {
        if (!input.reference?.trim()) throw badRequest('REFERENCE_REQUIRED', 'Indica la referencia de la transferencia bancaria.');
        if (p.status === 'APPROVAL_REQUIRED') await this.db.exec(`select public.approve_payout($1,$2,$3,$4,now())`, [payoutId, admin.id, 'Aprobado al liquidar', corr], c);
        let attempt = await this.db.one(`select id, status from public.payout_attempts where payout_id = $1 order by created_at desc limit 1`, [payoutId], c);
        if (!attempt || !['SUBMITTING', 'SUBMITTED', 'PENDING'].includes(attempt.status)) {
          const a = await this.db.one(`select public.begin_payout_processing($1,$2,$3,now()) as id`, [payoutId, `payout:${payoutId}:${Date.now()}`, corr], c);
          attempt = { id: a!.id, status: 'SUBMITTING' };
        }
        if (attempt.status === 'SUBMITTING')
          await this.db.exec(`select public.record_payout_provider_submission($1,$2,$3,$4::jsonb,now())`,
            [attempt.id, `manual-${payoutId}`, input.reference.trim(), JSON.stringify({ method: 'MANUAL_BANK_TRANSFER', recorded_by: admin.id })], c);
        await this.db.exec(`select public.confirm_payout_paid($1,$2,null,$3,0,$3,$4,$5,now())`, [payoutId, attempt.id, p.amount, admin.id, corr], c);
      } else if (action === 'FAIL') {
        const attempt = await this.db.one(`select id from public.payout_attempts where payout_id = $1 order by created_at desc limit 1`, [payoutId], c);
        if (!attempt) throw conflict('NO_ATTEMPT', 'El retiro no está en procesamiento.');
        await this.db.exec(`select public.fail_payout_processing($1,$2,'MANUAL_FAILURE',$3,now())`, [payoutId, attempt.id, input.reason ?? 'Transferencia rechazada'], c);
      } else {
        await this.db.exec(`select public.cancel_payout($1,$2,$3,$4,now())`, [payoutId, admin.id, input.reason ?? 'Cancelado por finanzas', corr], c);
      }
    });
    if (action !== 'APPROVE') this.mail.fire(() => this.mail.payoutUpdated(payoutId, action, action === 'MARK_PAID' ? input.reference : input.reason));
    return { ok: true };
  }

  // ------------------------------------------------------------------ pending bank transfers
  async pendingTransfers() {
    return this.db.many(
      `select p.id, 'RD-PAY-' || p.public_number as reference, p.expected_amount::text as amount, p.currency_code as currency, p.created_at as "createdAt",
              coalesce(up.display_name, u.email::text) as customer, u.email::text as email, cs.expires_at as "expiresAt"
         from public.payments p join public.checkout_sessions cs on cs.id = p.checkout_session_id
         join public.users u on u.id = p.customer_id left join public.user_profiles up on up.user_id = u.id
        where p.status = 'REQUIRES_ACTION' order by p.created_at`,
    );
  }

  async confirmTransfer(admin: RequestUser, paymentId: string, bankReference: string) {
    if (!bankReference?.trim()) throw badRequest('REFERENCE_REQUIRED', 'Indica la referencia bancaria recibida.');
    const orderId = await this.db.tx(async (c) => {
      const p = await this.db.one(
        `select p.id, p.status, p.expected_amount::text as amount, p.currency_code, i.id as intent_id from public.payments p
           join lateral (select id from public.payment_provider_intents where payment_id = p.id order by created_at desc limit 1) i on true
          where p.id = $1 for update of p`,
        [paymentId],
        c,
      );
      if (!p) throw notFound('Pago');
      if (p.status !== 'REQUIRES_ACTION') throw conflict('PAYMENT_NOT_PENDING', 'El pago ya fue procesado.');
      const corr = randomUUID();
      const r = await this.db.one(
        `select public.confirm_payment_capture($1,$2,$3,$4,$5,null,now(),$6,$7,$8) as order_id`,
        [paymentId, p.intent_id, `bt_${bankReference.trim()}`, p.amount, p.currency_code, `bt_txn_${randomUUID().replace(/-/g, '')}`, admin.id, corr],
        c,
      );
      await this.db.exec(`select public.post_payment_capture_to_ledger($1,$2,$3,$4)`, [paymentId, `capture:${paymentId}`, admin.id, corr], c);
      await postSaleAllocation(this.db, c, paymentId, admin.id, corr);
      return r!.order_id;
    });
    this.mail.fire(() => this.mail.orderConfirmed(orderId));
    return { orderId };
  }

  async rejectTransfer(admin: RequestUser, paymentId: string, reason: string) {
    await this.db.tx(async (c) => {
      const p = await this.db.one(`select checkout_session_id, customer_id, status from public.payments where id = $1 for update`, [paymentId], c);
      if (!p || p.status !== 'REQUIRES_ACTION') throw conflict('PAYMENT_NOT_PENDING', 'El pago ya fue procesado.');
      await this.db.exec(`select public.cancel_unpaid_payment($1,'TRANSFER_NOT_RECEIVED',$2,$3)`, [paymentId, admin.id, randomUUID()], c);
      const cs = await this.db.one(`select status from public.checkout_sessions where id = $1`, [p.checkout_session_id], c);
      if (cs && !['CANCELLED', 'COMPLETED', 'EXPIRED', 'FAILED'].includes(cs.status))
        await this.db.exec(`select public.cancel_checkout_session($1,$2,'TRANSFER_NOT_RECEIVED',null)`, [p.checkout_session_id, p.customer_id], c).catch(() => undefined);
    });
    this.mail.fire(() => this.mail.transferRejected(paymentId, reason));
    return { ok: true };
  }

  /** Posts the SALE allocation for paid payments that are missing it (idempotent). */
  async reconcileSales(admin: RequestUser) {
    const rows = await this.db.many(
      `select p.id from public.payments p where p.status = 'PAID' and p.order_id is not null
          and not exists (select 1 from public.financial_allocation_sets s where s.payment_id = p.id and s.purpose_code = 'SALE' and s.status = 'POSTED')`,
    );
    for (const r of rows) await this.db.tx((c) => postSaleAllocation(this.db, c, r.id, admin.id, randomUUID()));
    return { posted: rows.length };
  }

  // ------------------------------------------------------------------ finance overview
  async finance(days = 30) {
    const period = `${days} days`;
    const [k, series, sellers] = await Promise.all([
      this.db.one(
        `select coalesce(sum(ofs.grand_total),0)::text as gmv, coalesce(sum(ofs.platform_commission_total),0)::text as commission,
                coalesce(sum(ofs.seller_entitlement_estimate_total),0)::text as seller_payable, coalesce(sum(ofs.tax_total),0)::text as tax,
                coalesce(sum(ofs.shipping_total),0)::text as shipping, count(*)::int as orders
           from public.orders o join public.order_financial_snapshots ofs on ofs.order_id = o.id
          where o.placed_at >= now() - $1::interval and o.lifecycle_status <> 'CANCELLED'`,
        [period],
      ),
      this.db.many(
        `select d::date as day, coalesce(sum(ofs.platform_commission_total),0)::text as commission,
                coalesce(sum(ofs.seller_entitlement_estimate_total),0)::text as sellers
           from generate_series(current_date - ($1::int - 1), current_date, interval '1 day') d
           left join public.orders o on o.placed_at::date = d::date and o.lifecycle_status <> 'CANCELLED'
           left join public.order_financial_snapshots ofs on ofs.order_id = o.id group by d order by d`,
        [days],
      ),
      this.db.one(`select count(*) filter (where status = 'ACTIVE')::int as active from public.sellers`),
    ]);
    const paid = await this.db.one(`select coalesce(sum(requested_amount),0)::text as paid from public.payouts where status = 'PAID' and paid_at >= now() - $1::interval`, [period]);
    return {
      kpis: { ...k, payoutsPaid: paid!.paid, activeSellers: sellers!.active, avgCommissionRate: Number(k!.gmv) > 0 ? Number(k!.commission) / Number(fromMinor(toMinor(k!.gmv) - toMinor(k!.tax) - toMinor(k!.shipping))) : null },
      series,
      payouts: (await this.payouts({})).slice(0, 8),
      pendingTransfers: await this.pendingTransfers(),
    };
  }

  // ------------------------------------------------------------------ settings
  async getSettings() {
    const [settings, commission, system] = await Promise.all([this.settings.all(), this.currentCommission(), this.systemStatus()]);
    const payout = await this.db.one(
      `select ppd.minimum_payout_amount::text as minimum, ppd.approval_mode, ppd.hold_period_seconds::int as hold
         from public.business_rule_groups g join public.business_rule_versions v on v.rule_group_id = g.id and v.status = 'ACTIVE'
         join public.payout_policy_definitions ppd on ppd.rule_version_id = v.id where g.code = 'RD-GLOBAL-PAYOUT-DOP' limit 1`,
    );
    const roles = await this.db.many(
      `select r.code, r.name, r.description, (select count(*) from public.user_roles ur where ur.role_id = r.id and ur.revoked_at is null)::int as users,
              (select count(*) from public.role_permissions rp where rp.role_id = r.id and rp.revoked_at is null)::int as permissions
         from public.roles r where r.is_active order by r.code`,
    );
    return { settings, commission, payoutPolicy: payout, roles, system };
  }

  async updateSettings(admin: RequestUser, patch: Partial<PlatformSettings> & { commissionRate?: number }) {
    const { commissionRate, ...rest } = patch;
    if (rest['tax.itbis_rate'] != null && (rest['tax.itbis_rate'] < 0 || rest['tax.itbis_rate'] > 1)) throw badRequest('TAX_INVALID', 'Tasa de impuesto inválida.');
    if (Object.keys(rest).length) await this.settings.update(admin.id, rest);
    if (commissionRate != null) {
      if (commissionRate < 0 || commissionRate > 0.5) throw badRequest('COMMISSION_INVALID', 'La comisión debe estar entre 0 % y 50 %.');
      const cur = await this.currentCommission();
      if (!cur || Math.abs(cur.rate - commissionRate) > 1e-9) {
        await this.db.tx(async (c) => {
          const g = await this.db.one(`select id from public.business_rule_groups where code = 'RD-GLOBAL-COMMISSION'`, [], c);
          const v = await this.db.one(
            `select (public.create_business_rule_version($1,$2,'{}'::jsonb,$3,'APPLICATION','Cambio de comisión desde configuración',null)).id as id`,
            [g!.id, admin.id, `Comisión ${(commissionRate * 100).toFixed(2)} %`],
            c,
          );
          await this.db.exec(
            `insert into public.commission_rule_definitions (rule_version_id, calculation_type, calculation_base_code, percentage_rate, rounding_mode)
             values ($1,'PERCENTAGE','PRODUCT_AFTER_DISCOUNT',$2,'ROUND_HALF_UP')`,
            [v!.id, commissionRate.toFixed(4)],
            c,
          );
          await this.db.exec(`select public.publish_business_rule_version($1,$2,now(),'APPLICATION','Cambio de comisión desde configuración',null)`, [v!.id, admin.id], c);
        });
      }
    }
    return this.getSettings();
  }

  async systemStatus() {
    const started = Date.now();
    let db = 'Operativo';
    try {
      await this.db.one('select 1');
    } catch {
      db = 'Caído';
    }
    const pay = await this.db.one(`select count(*)::int as n from public.payment_provider_configurations where status = 'ACTIVE'`).catch(() => ({ n: 0 }));
    return [
      { code: 'API', name: 'API', description: 'Servicios de integración y acceso.', status: db === 'Operativo' ? 'Operativo' : 'Degradado', latencyMs: Date.now() - started },
      { code: 'PAYMENTS', name: 'Pagos', description: 'Procesamiento de transacciones.', status: pay!.n > 0 ? 'Operativo' : 'Sin configurar' },
      { code: 'STORAGE', name: 'Almacenamiento', description: 'Archivos, imágenes y recursos.', status: this.supa.enabled ? 'Operativo' : 'Sin configurar' },
      { code: 'MODERATION', name: 'Moderación', description: 'Cola de revisión y aprobaciones.', status: 'Operativo' },
    ];
  }

  // ------------------------------------------------------------------ users & roles
  async users(q: { search?: string; role?: string; page?: number }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.search?.trim()) {
      params.push(`%${q.search.trim()}%`);
      where.push(`(u.email::text ilike $${params.length} or coalesce(up.display_name,'') ilike $${params.length})`);
    }
    if (q.role) {
      params.push(q.role);
      where.push(`exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = u.id and ur.revoked_at is null and r.code = $${params.length})`);
    }
    const page = Math.max(q.page ?? 1, 1);
    const rows = await this.db.many(
      `select u.id, u.email::text as email, u.status, u.created_at, u.last_login_at, coalesce(up.display_name, u.email::text) as name,
              coalesce((select json_agg(r.code order by r.code) from public.user_roles ur join public.roles r on r.id = ur.role_id
                         where ur.user_id = u.id and ur.revoked_at is null), '[]') as roles,
              (select count(*) from public.orders o where o.customer_id = u.id)::int as orders,
              count(*) over() as total
         from public.users u left join public.user_profiles up on up.user_id = u.id
        ${where.length ? 'where ' + where.join(' and ') : ''} order by u.created_at desc limit 25 offset ${(page - 1) * 25}`,
      params,
    );
    return { items: rows.map((r: any) => ({ id: r.id, email: r.email, name: r.name, status: r.status, roles: r.roles, orders: r.orders, createdAt: r.created_at, lastLoginAt: r.last_login_at })), total: rows[0] ? Number(rows[0].total) : 0, page };
  }

  async setRole(admin: RequestUser, userId: string, role: RoleCode, grant: boolean) {
    if (['SUPER_ADMIN'].includes(role) && !admin.roles.includes('SUPER_ADMIN')) throw badRequest('FORBIDDEN_ROLE', 'Solo un super administrador puede asignar este rol.');
    if (userId === admin.id && !grant && ['ADMIN', 'SUPER_ADMIN'].includes(role)) throw badRequest('SELF_REVOKE', 'No puedes quitarte tu propio rol de administrador.');
    if (grant)
      await this.db.exec(
        `insert into public.user_roles (user_id, role_id, assigned_by, reason)
         select $1, r.id, $2, 'Asignado desde el panel' from public.roles r
          where r.code = $3 and not exists (select 1 from public.user_roles ur where ur.user_id = $1 and ur.role_id = r.id and ur.revoked_at is null)`,
        [userId, admin.id, role],
      );
    else
      await this.db.exec(
        `update public.user_roles ur set revoked_at = now(), revoked_by = $2 from public.roles r
          where r.id = ur.role_id and ur.user_id = $1 and r.code = $3 and ur.revoked_at is null`,
        [userId, admin.id, role],
      );
    invalidateUserCache(userId);
    return { ok: true };
  }

  async setUserStatus(admin: RequestUser, userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    if (userId === admin.id) throw badRequest('SELF_STATUS', 'No puedes cambiar el estado de tu propia cuenta.');
    await this.db.exec(`update public.users set status = $2 where id = $1 and status in ('ACTIVE','SUSPENDED')`, [userId, status]);
    invalidateUserCache(userId);
    return { ok: true };
  }
}
