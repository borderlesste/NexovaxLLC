import { HttpStatus, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { MailService } from '../mail/mail.service';
import { normalizeAddress, normalizeCountry, resolveCityId } from '../common/geo';
import { SettingsService } from '../settings/settings.service';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { AppError, badRequest, conflict, notFound } from '../common/errors';
import { encrypt, KEY_VERSION, last4 } from '../common/crypto';
import { slugify } from '../common/slug';
import { fromMinor, toMinor } from '../common/money';
import { invalidateUserCache, RequestUser } from '../auth/auth';
import { mediaUrl } from '../catalog/catalog.sql';

export interface OnboardingInput {
  storeName: string;
  shortDescription?: string;
  supportEmail?: string;
  supportPhone?: string;
  legalName: string;
  entityType: 'INDIVIDUAL' | 'SOLE_PROPRIETOR' | 'COMPANY' | 'PARTNERSHIP' | 'NONPROFIT' | 'OTHER';
  countryCode: string; // registration country (ISO 3166-1 alpha-2)
  taxId: string; // national tax identifier (EIN, RFC, NIF, RNC, CUIT…)
  timezone?: string;
  address: ShipFromInput;
}

export interface ShipFromInput {
  contactName: string;
  line1: string;
  line2?: string;
  countryCode: string;
  city: string;
  region?: string;
  postalCode?: string;
  phone: string;
}

export interface VariantInput {
  id?: string;
  sku: string;
  optionValues?: Record<string, string>;
  price: number | string;
  compareAtPrice?: number | string | null;
  stock: number;
  weightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

export interface ProductInput {
  title: string;
  categoryId: string;
  brandName?: string | null;
  shortDescription?: string | null;
  description: string;
  options?: { name: string; values: { label: string; swatch?: string | null }[] }[];
  variants: VariantInput[];
  attributes?: { definitionId: string; value: string }[];
  seo?: { slug?: string; metaTitle?: string; metaDescription?: string };
  action?: 'SAVE_DRAFT' | 'SUBMIT';
}

const ENTITY_TYPES = ['INDIVIDUAL', 'SOLE_PROPRIETOR', 'COMPANY', 'PARTNERSHIP', 'NONPROFIT', 'OTHER'];
const validTimezone = (tz?: string) => {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
};

@Injectable()
export class SellerService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly supa: SupabaseAdminService,
    private readonly mail: MailService,
  ) {}

  // ------------------------------------------------------------------ onboarding
  async onboard(user: RequestUser, input: OnboardingInput) {
    if (user.sellers.some((s) => s.isOwner)) throw conflict('SELLER_EXISTS', 'Ya tienes una tienda registrada.');
    if (!(await this.settings.get('features.seller_registration')))
      throw new AppError('SELLER_REGISTRATION_CLOSED', 'El registro de vendedores está cerrado temporalmente.', HttpStatus.FORBIDDEN);
    if (!ENTITY_TYPES.includes(input.entityType)) throw badRequest('ENTITY_TYPE_INVALID', 'Tipo de entidad inválido.');
    const taxDigits = input.taxId.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (taxDigits.length < 4 || taxDigits.length > 20)
      throw badRequest('TAX_ID_INVALID', 'Ingresa un número de identificación fiscal válido.');
    const registration = { countryCode: await normalizeCountry(this.db, input.countryCode) };
    const geo = await normalizeAddress(this.db, input.address);
    const me = await this.db.one(`select locale from public.users where id = $1`, [user.id]);
    const currency = await this.settings.currency();
    const sellerId = await this.db.tx(async (c) => {
      let slug = slugify(input.storeName, 60);
      for (let i = 2; await this.db.one(`select 1 from public.sellers where slug = $1`, [slug], c); i++) slug = `${slugify(input.storeName, 55)}-${i}`;
      const s = await this.db.one(
        `insert into public.sellers (owner_user_id, slug, status, verification_status, default_currency_code)
         values ($1,$2,'DRAFT','NOT_STARTED',$3) returning id`,
        [user.id, slug, currency],
        c,
      );
      const id = s!.id;
      await this.db.exec(
        `insert into public.seller_store_profiles (seller_id, display_name, short_description, support_email, support_phone, locale, timezone)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, input.storeName.trim(), input.shortDescription?.trim() || null, input.supportEmail?.trim() || null, input.supportPhone?.trim() || null,
         me?.locale === 'en' ? 'en' : 'es', validTimezone(input.timezone)],
        c,
      );
      await this.db.exec(
        `insert into public.seller_legal_profiles (seller_id, legal_name, entity_type_code, registration_country_code, tax_identifier_ciphertext, encryption_key_version)
         values ($1,$2,$3,$4,$5,$6)`,
        [id, input.legalName.trim(), input.entityType, registration.countryCode, encrypt(taxDigits), KEY_VERSION],
        c,
      );
      const cityId = await resolveCityId(this.db, geo.countryCode, geo.city, geo.region, c);
      const addr = await this.db.one(
        `insert into public.seller_ship_from_addresses (seller_id, label, warehouse_code, contact_name, company_name, line1, line2, city, city_id,
                 region, postal_code, country_code, phone, is_default)
         values ($1,'Almacén principal','MAIN',$2,$3,$4,$5,$6,$11,$7,$8,$9,$10,true) returning id`,
        [id, input.address.contactName.trim(), input.storeName.trim(), input.address.line1.trim(), input.address.line2?.trim() || null,
         geo.city, geo.region, geo.postalCode, geo.countryCode, input.address.phone.trim(), cityId],
        c,
      );
      await this.db.exec(
        `insert into public.inventory_locations (seller_id, ship_from_address_id, code, name, location_type, fulfillment_priority)
         values ($1,$2,'MAIN','Almacén principal','WAREHOUSE',10)`,
        [id, addr!.id],
        c,
      );
      await this.db.exec(
        `insert into public.user_roles (user_id, role_id, assigned_by, reason)
         select $1, r.id, $1, 'Seller onboarding' from public.roles r
          where r.code = 'SELLER' and not exists (select 1 from public.user_roles ur where ur.user_id = $1 and ur.role_id = r.id and ur.revoked_at is null)`,
        [user.id],
        c,
      );
      await this.db.exec(
        `insert into public.seller_verifications (seller_id, verification_type, provider_code, status, requested_at, submitted_at, metadata)
         values ($1,'KYB','RD_MANUAL','PENDING',now(),now(), jsonb_build_object('tax_id_last4', $2::text, 'entity_type', $3::text, 'country', $4::text))`,
        [id, last4(taxDigits), input.entityType, registration.countryCode],
        c,
      ).catch(() => undefined);
      await this.db.exec(`update public.sellers set status = 'PENDING_VERIFICATION', verification_status = 'PENDING' where id = $1`, [id], c);
      await this.db.exec(
        `insert into public.seller_status_history (seller_id, from_status, to_status, changed_by, reason) values ($1,'DRAFT','PENDING_VERIFICATION',$2,'Solicitud de alta enviada')`,
        [id, user.id],
        c,
      );
      return id;
    });
    invalidateUserCache(user.id);
    this.mail.fire(() => this.mail.sellerApplicationReceived(sellerId));
    return { sellerId, status: 'PENDING_VERIFICATION' };
  }

  async store(sellerId: string) {
    const s = await this.db.one(
      `select s.id, s.slug, s.status, s.verification_status, s.created_at, s.activated_at, ssp.*, slp.legal_name, slp.entity_type_code,
              slp.registration_country_code,
              a.id as address_id, a.contact_name, a.line1, a.line2, a.city, a.region, a.postal_code, a.country_code, a.phone as address_phone
         from public.sellers s left join public.seller_store_profiles ssp on ssp.seller_id = s.id
         left join public.seller_legal_profiles slp on slp.seller_id = s.id
         left join lateral (select * from public.seller_ship_from_addresses x where x.seller_id = s.id and x.status = 'ACTIVE' order by x.is_default desc limit 1) a on true
        where s.id = $1`,
      [sellerId],
    );
    if (!s) throw notFound('Tienda');
    return {
      id: s.id,
      slug: s.slug,
      status: s.status,
      verificationStatus: s.verification_status,
      createdAt: s.created_at,
      activatedAt: s.activated_at,
      displayName: s.display_name,
      shortDescription: s.short_description,
      description: s.description,
      supportEmail: s.support_email,
      supportPhone: s.support_phone,
      logoUrl: s.logo_asset_id ? mediaUrl(s.logo_asset_id) : null,
      bannerUrl: s.banner_asset_id ? mediaUrl(s.banner_asset_id) : null,
      legalName: s.legal_name,
      entityType: s.entity_type_code,
      countryCode: s.registration_country_code,
      locale: s.locale,
      timezone: s.timezone,
      shipFrom: s.address_id
        ? { id: s.address_id, contactName: s.contact_name, line1: s.line1, line2: s.line2, city: s.city, region: s.region, postalCode: s.postal_code,
            countryCode: s.country_code, phone: s.address_phone }
        : null,
    };
  }

  /** Updates the default ship-from address (used for carrier rates and labels). */
  async updateShipFrom(sellerId: string, input: ShipFromInput) {
    const geo = await normalizeAddress(this.db, input);
    const cityId = await resolveCityId(this.db, geo.countryCode, geo.city, geo.region);
    const n = await this.db.exec(
      `update public.seller_ship_from_addresses set contact_name = $2, line1 = $3, line2 = $4, city = $5, city_id = $10, region = $6,
              postal_code = $7, country_code = $8, phone = $9, validation_status = 'NOT_VALIDATED', validated_at = null, updated_at = now()
        where id = (select id from public.seller_ship_from_addresses where seller_id = $1 and status = 'ACTIVE' order by is_default desc limit 1)`,
      [sellerId, input.contactName.trim(), input.line1.trim(), input.line2?.trim() || null, geo.city, geo.region, geo.postalCode, geo.countryCode, input.phone.trim(), cityId],
    );
    if (!n) throw notFound('Dirección de despacho');
    return this.store(sellerId);
  }

  async updateStore(sellerId: string, input: { displayName?: string; shortDescription?: string; description?: string; supportEmail?: string; supportPhone?: string }) {
    await this.db.exec(
      `update public.seller_store_profiles set display_name = coalesce(nullif(btrim($2),''), display_name), short_description = $3,
              description = $4, support_email = nullif(btrim($5),''), support_phone = nullif(btrim($6),'')
        where seller_id = $1`,
      [sellerId, input.displayName ?? '', input.shortDescription?.trim() || null, input.description?.trim() || null, input.supportEmail ?? '', input.supportPhone ?? ''],
    );
    return this.store(sellerId);
  }

  async uploadStoreImage(user: RequestUser, sellerId: string, kind: 'logo' | 'banner', file: Express.Multer.File) {
    const assetId = await this.supa.uploadSellerImage(sellerId, user.id, file, 'store', 'PUBLIC');
    await this.db.exec(`update public.seller_store_profiles set ${kind === 'logo' ? 'logo_asset_id' : 'banner_asset_id'} = $2 where seller_id = $1`, [sellerId, assetId]);
    return { url: mediaUrl(assetId) };
  }

  // ------------------------------------------------------------------ products
  async listProducts(sellerId: string, q: { status?: string; search?: string; page?: number; pageSize?: number }) {
    const currency = await this.settings.currency();
    const params: unknown[] = [sellerId, currency];
    const where = ['p.seller_id = $1', `p.status <> 'ARCHIVED'`];
    if (q.status) {
      params.push(q.status);
      where.push(`p.status = $${params.length}`);
    }
    if (q.search?.trim()) {
      params.push(`%${q.search.trim()}%`);
      where.push(`(p.title ilike $${params.length} or exists (select 1 from public.product_variants v where v.product_id = p.id and v.sku ilike $${params.length}))`);
    }
    const pageSize = Math.min(q.pageSize ?? 20, 100);
    const page = Math.max(q.page ?? 1, 1);
    const rows = await this.db.many(
      `select p.id, p.slug, p.title, p.status, p.updated_at, p.published_at, c.name as category,
              (select min(vpv.amount)::text from public.product_variants v join public.variant_price_versions vpv on vpv.variant_id = v.id
                 where v.product_id = p.id and v.status = 'ACTIVE' and vpv.status = 'ACTIVE' and vpv.currency_code = $2) as price,
              (select v.sku from public.product_variants v where v.product_id = p.id order by v.is_default desc, v.created_at limit 1) as sku,
              (select count(*) from public.product_variants v where v.product_id = p.id and v.status = 'ACTIVE')::int as variants,
              coalesce((select sum(ii.on_hand) from public.inventory_items ii join public.product_variants v on v.id = ii.variant_id
                         where v.product_id = p.id and v.status = 'ACTIVE' and ii.status = 'ACTIVE'),0)::int as stock,
              (select pm.asset_id from public.product_media pm where pm.product_id = p.id order by pm.is_primary desc, pm.sort_order limit 1) as image_id,
              (select r.decision_reason from public.product_moderation_reviews r where r.product_id = p.id order by r.created_at desc limit 1) as last_review_note,
              count(*) over() as total
         from public.products p join public.categories c on c.id = p.category_id
        where ${where.join(' and ')}
        order by p.updated_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
      params,
    );
    const counts = await this.db.one(
      `select count(*) filter (where status <> 'ARCHIVED')::int as total, count(*) filter (where status = 'ACTIVE')::int as active,
              count(*) filter (where status = 'PENDING_REVIEW')::int as pending, count(*) filter (where status = 'DRAFT')::int as draft,
              count(*) filter (where status = 'REJECTED')::int as rejected
         from public.products where seller_id = $1`,
      [sellerId],
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        status: r.status,
        category: r.category,
        price: r.price,
        sku: r.sku,
        variants: r.variants,
        stock: r.stock,
        imageUrl: r.image_id ? mediaUrl(r.image_id) : null,
        updatedAt: r.updated_at,
        publishedAt: r.published_at,
        reviewNote: r.last_review_note,
      })),
      total: rows[0] ? Number(rows[0].total) : 0,
      counts,
      page,
      pageSize,
    };
  }

  async getProduct(sellerId: string, productId: string) {
    const currency = await this.settings.currency();
    const p = await this.db.one(
      `select p.*, b.name as brand_name, seo.meta_title, seo.meta_description
         from public.products p left join public.brands b on b.id = p.brand_id
         left join public.product_seo seo on seo.product_id = p.id
        where p.id = $1 and p.seller_id = $2`,
      [productId, sellerId],
    );
    if (!p) throw notFound('Producto');
    const [options, variants, media, attributes, review] = await Promise.all([
      this.db.many(
        `select o.id, o.name, coalesce(json_agg(json_build_object('id', v.id, 'label', v.label, 'swatch', v.swatch_value) order by v.sort_order)
                  filter (where v.id is not null), '[]') as values
           from public.product_options o left join public.product_option_values v on v.option_id = o.id
          where o.product_id = $1 group by o.id order by o.sort_order`,
        [productId],
      ),
      this.db.many(
        `select v.id, v.sku, v.status, v.weight_value::text as weight, v.length_value::text as length, v.width_value::text as width,
                v.height_value::text as height,
                (select vpv.amount::text from public.variant_price_versions vpv where vpv.variant_id = v.id and vpv.currency_code = $2
                   and vpv.status = 'ACTIVE' order by vpv.effective_from desc limit 1) as price,
                (select vpv.compare_at_amount::text from public.variant_price_versions vpv where vpv.variant_id = v.id and vpv.currency_code = $2
                   and vpv.status = 'ACTIVE' order by vpv.effective_from desc limit 1) as compare_at,
                coalesce((select sum(on_hand) from public.inventory_items ii where ii.variant_id = v.id and ii.status = 'ACTIVE'),0)::int as stock,
                coalesce((select sum(reserved) from public.inventory_items ii where ii.variant_id = v.id and ii.status = 'ACTIVE'),0)::int as reserved,
                coalesce((select json_object_agg(o.name, ov.label) from public.variant_option_assignments a
                           join public.product_options o on o.id = a.option_id join public.product_option_values ov on ov.id = a.option_value_id
                          where a.variant_id = v.id), '{}') as option_values
           from public.product_variants v where v.product_id = $1 and v.status <> 'ARCHIVED' order by v.is_default desc, v.created_at`,
        [productId, currency],
      ),
      this.db.many(`select id, asset_id, is_primary, sort_order from public.product_media where product_id = $1 order by is_primary desc, sort_order`, [productId]),
      this.db.many(
        `select pav.attribute_definition_id as definition_id, coalesce(pav.value_text, pav.value_number::text, pav.value_boolean::text) as value
           from public.product_attribute_values pav where pav.product_id = $1`,
        [productId],
      ),
      this.db.one(`select status, decision_reason, reviewed_at from public.product_moderation_reviews where product_id = $1 order by created_at desc limit 1`, [productId]),
    ]);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      status: p.status,
      categoryId: p.category_id,
      brandName: p.brand_name,
      shortDescription: p.short_description,
      description: p.description,
      seo: { slug: p.slug, metaTitle: p.meta_title, metaDescription: p.meta_description },
      options: options.map((o: any) => ({ id: o.id, name: o.name, values: o.values })),
      variants: variants.map((v: any) => ({
        id: v.id, sku: v.sku, status: v.status, price: v.price, compareAtPrice: v.compare_at, stock: v.stock, reserved: v.reserved,
        weightKg: v.weight, lengthCm: v.length, widthCm: v.width, heightCm: v.height, optionValues: v.option_values,
      })),
      media: media.map((m: any) => ({ id: m.id, url: mediaUrl(m.asset_id), isPrimary: m.is_primary, sortOrder: m.sort_order })),
      attributes,
      lastReview: review,
    };
  }

  async saveProduct(user: RequestUser, sellerId: string, input: ProductInput, productId?: string) {
    this.validateProduct(input);
    const currency = await this.settings.currency();
    const moderation = await this.settings.get('features.mandatory_moderation');
    const id = await this.db.tx(async (c) => {
      const seller = await this.db.one(`select status from public.sellers where id = $1`, [sellerId], c);
      if (!seller || ['SUSPENDED', 'CLOSED', 'REJECTED'].includes(seller.status))
        throw new AppError('SELLER_NOT_ALLOWED', 'Tu tienda no puede publicar productos en este momento.', HttpStatus.FORBIDDEN);
      const cat = await this.db.one(`select id from public.categories where id = $1 and status = 'ACTIVE'`, [input.categoryId], c);
      if (!cat) throw badRequest('CATEGORY_INVALID', 'Selecciona una categoría válida.');
      const brandId = input.brandName?.trim() ? await this.ensureBrand(c, input.brandName.trim()) : null;

      let product: any;
      let contentChanged = true;
      let contentBefore: string | null = null;
      if (productId) {
        product = await this.db.one(`select * from public.products where id = $1 and seller_id = $2 for update`, [productId, sellerId], c);
        if (!product) throw notFound('Producto');
        if (product.status === 'ARCHIVED') throw conflict('PRODUCT_ARCHIVED', 'El producto está archivado.');
        contentBefore = await this.contentFingerprint(c, product.id);
        contentChanged =
          product.title !== input.title.trim() || (product.description ?? '') !== input.description.trim() || product.category_id !== input.categoryId;
        const slug = await this.uniqueSlug(c, input.seo?.slug || input.title, product.id);
        await this.db.exec(
          `update public.products set title = $2, slug = $3, category_id = $4, brand_id = $5, short_description = $6, description = $7, version = version + 1
            where id = $1`,
          [product.id, input.title.trim(), slug, input.categoryId, brandId, input.shortDescription?.trim() || null, input.description.trim()],
          c,
        );
      } else {
        const slug = await this.uniqueSlug(c, input.seo?.slug || input.title);
        product = await this.db.one(
          `insert into public.products (seller_id, category_id, brand_id, product_type_code, title, slug, short_description, description, status, requires_shipping)
           values ($1,$2,$3,'PHYSICAL',$4,$5,$6,$7,'DRAFT',true) returning *`,
          [sellerId, input.categoryId, brandId, input.title.trim(), slug, input.shortDescription?.trim() || null, input.description.trim()],
          c,
        );
        await this.db.exec(`insert into public.product_status_history (product_id, from_status, to_status, changed_by, reason) values ($1,null,'DRAFT',$2,'Producto creado')`, [product.id, user.id], c);
      }
      await this.db.exec(
        `insert into public.product_seo (product_id, meta_title, meta_description) values ($1,$2,$3)
         on conflict (product_id) do update set meta_title = excluded.meta_title, meta_description = excluded.meta_description`,
        [product.id, input.seo?.metaTitle?.trim() || null, input.seo?.metaDescription?.trim() || null],
        c,
      );

      // ---- options
      const optionMap = new Map<string, { id: string; values: Map<string, string> }>();
      for (const [i, o] of (input.options ?? []).entries()) {
        const code = slugify(o.name, 40);
        const opt = await this.db.one(
          `insert into public.product_options (product_id, code, name, display_type, sort_order) values ($1,$2,$3,$4,$5)
           on conflict (product_id, code) do update set name = excluded.name, sort_order = excluded.sort_order returning id`,
          [product.id, code, o.name.trim(), o.values.some((v) => v.swatch) ? 'SWATCH' : 'BUTTON', i],
          c,
        );
        const values = new Map<string, string>();
        for (const [j, v] of o.values.entries()) {
          const vr = await this.db.one(
            `insert into public.product_option_values (option_id, code, label, swatch_value, sort_order) values ($1,$2,$3,$4,$5)
             on conflict (option_id, code) do update set label = excluded.label, swatch_value = excluded.swatch_value, sort_order = excluded.sort_order returning id`,
            [opt!.id, slugify(v.label, 40), v.label.trim(), v.swatch?.trim() || null, j],
            c,
          );
          values.set(v.label.trim().toLowerCase(), vr!.id);
        }
        optionMap.set(o.name.trim().toLowerCase(), { id: opt!.id, values });
      }

      // ---- variants
      const location = await this.db.one(
        `select id from public.inventory_locations where seller_id = $1 and status = 'ACTIVE' order by fulfillment_priority limit 1`,
        [sellerId],
        c,
      );
      if (!location) throw conflict('NO_INVENTORY_LOCATION', 'Configura tu almacén antes de crear productos.');
      const keptVariantIds: string[] = [];
      for (const [idx, v] of input.variants.entries()) {
        const entries = Object.entries(v.optionValues ?? {}).filter(([, val]) => val);
        const combinationKey = entries.length
          ? entries.map(([k, val]) => `${slugify(k, 40)}=${slugify(val, 40)}`).sort().join('|')
          : 'default';
        const title = entries.length ? entries.map(([, val]) => val).join(' / ') : null;
        let variant = v.id
          ? await this.db.one(`select * from public.product_variants where id = $1 and product_id = $2`, [v.id, product.id], c)
          : await this.db.one(`select * from public.product_variants where product_id = $1 and combination_key = $2`, [product.id, combinationKey], c);
        const dims = v.lengthCm && v.widthCm && v.heightCm ? [v.lengthCm, v.widthCm, v.heightCm, 'cm'] : [null, null, null, null];
        const weight = v.weightKg ? [v.weightKg, 'kg'] : [null, null];
        const skuTaken = await this.db.one(
          `select 1 from public.product_variants where seller_id = $1 and lower(sku) = lower($2) and ($3::uuid is null or id <> $3)`,
          [sellerId, v.sku.trim(), variant?.id ?? null],
          c,
        );
        if (skuTaken) throw conflict('SKU_TAKEN', `El SKU ${v.sku} ya existe en tu tienda.`);
        if (variant) {
          await this.db.exec(
            `update public.product_variants set sku = $2, title = $3, combination_key = $4, status = 'ACTIVE', archived_at = null, is_default = $5,
                    weight_value = $6, weight_unit = $7, length_value = $8, width_value = $9, height_value = $10, dimension_unit = $11, version = version + 1
              where id = $1`,
            [variant.id, v.sku.trim(), title, combinationKey, idx === 0, ...weight, ...dims],
            c,
          );
        } else {
          variant = await this.db.one(
            `insert into public.product_variants (product_id, seller_id, sku, title, status, is_default, combination_key,
                     weight_value, weight_unit, length_value, width_value, height_value, dimension_unit)
             values ($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
            [product.id, sellerId, v.sku.trim(), title, idx === 0, combinationKey, ...weight, ...dims],
            c,
          );
        }
        keptVariantIds.push(variant.id);
        await this.db.exec(`delete from public.variant_option_assignments where variant_id = $1`, [variant.id], c).catch(() => undefined);
        for (const [k, val] of entries) {
          const opt = optionMap.get(k.trim().toLowerCase());
          const valId = opt?.values.get(val.trim().toLowerCase());
          if (!opt || !valId) throw badRequest('VARIANT_OPTION_INVALID', `La opción "${k}: ${val}" no está definida.`);
          await this.db.exec(
            `insert into public.variant_option_assignments (variant_id, product_id, option_id, option_value_id) values ($1,$2,$3,$4)`,
            [variant.id, product.id, opt.id, valId],
            c,
          );
        }
        await this.setPrice(c, user.id, sellerId, variant.id, currency, v.price, v.compareAtPrice ?? null);
        await this.setStock(c, user.id, sellerId, variant.id, location.id, v.stock, 'STOCK_CORRECTION', 'PRODUCT_EDITOR');
      }
      // archive removed variants
      const removed = await this.db.many(
        `select id from public.product_variants where product_id = $1 and status <> 'ARCHIVED' and not (id = any($2::uuid[]))`,
        [product.id, keptVariantIds],
        c,
      );
      for (const r of removed)
        await this.db.exec(`update public.product_variants set status = 'ARCHIVED', archived_at = now(), is_default = false where id = $1`, [r.id], c);

      // ---- attributes
      if (input.attributes) {
        await this.db.exec(`delete from public.product_attribute_values where product_id = $1`, [product.id], c);
        for (const a of input.attributes.filter((x) => x.value?.toString().trim())) {
          const def = await this.db.one(`select data_type from public.attribute_definitions where id = $1 and status = 'ACTIVE'`, [a.definitionId], c);
          if (!def) continue;
          const val = a.value.toString().trim();
          const cols =
            def.data_type === 'NUMBER' && !isNaN(Number(val))
              ? [null, Number(val), null]
              : def.data_type === 'BOOLEAN'
                ? [null, null, ['true', 'sí', 'si', '1'].includes(val.toLowerCase())]
                : [val, null, null];
          await this.db.exec(
            `insert into public.product_attribute_values (product_id, attribute_definition_id, position, value_text, value_number, value_boolean)
             values ($1,$2,0,$3,$4,$5)`,
            [product.id, a.definitionId, ...cols],
            c,
          );
        }
      }

      // ---- status transitions
      // Any customer-visible content (brand, texts, attributes, options, variants) counts; price/stock don't.
      if (contentBefore !== null && !contentChanged) contentChanged = contentBefore !== (await this.contentFingerprint(c, product.id));
      const current = (await this.db.one(`select status from public.products where id = $1`, [product.id], c))!.status;
      if (input.action === 'SUBMIT') {
        if (!['DRAFT', 'REJECTED', 'PAUSED'].includes(current) && !(current === 'ACTIVE' && contentChanged && moderation))
          return product.id;
        const hasMedia = await this.db.one(`select 1 from public.product_media where product_id = $1 limit 1`, [product.id], c);
        if (!hasMedia && moderation) throw badRequest('PRODUCT_IMAGE_REQUIRED', 'Agrega al menos una imagen antes de enviar a revisión.');
        const sellerActive = seller.status === 'ACTIVE';
        if (moderation) {
          await this.transition(c, product.id, current, 'PENDING_REVIEW', user.id, 'Enviado a revisión');
          await this.db.exec(`update public.product_moderation_reviews set status = 'CANCELLED', updated_at = now() where product_id = $1 and status = 'PENDING'`, [product.id], c);
          await this.db.exec(
            `insert into public.product_moderation_reviews (product_id, submitted_product_version, status, submitted_by, submitted_at)
             select id, version, 'PENDING', $2, now() from public.products where id = $1`,
            [product.id, user.id],
            c,
          );
        } else if (sellerActive) {
          await this.transition(c, product.id, current, 'ACTIVE', user.id, 'Publicado sin moderación');
        } else {
          await this.transition(c, product.id, current, 'PENDING_REVIEW', user.id, 'Pendiente de aprobación de la tienda');
        }
      } else if (current === 'ACTIVE' && contentChanged && moderation) {
        await this.transition(c, product.id, current, 'PENDING_REVIEW', user.id, 'Cambios de contenido requieren revisión');
        await this.db.exec(
          `insert into public.product_moderation_reviews (product_id, submitted_product_version, status, submitted_by, submitted_at)
           select id, version, 'PENDING', $2, now() from public.products where id = $1`,
          [product.id, user.id],
          c,
        );
      }
      return product.id;
    });
    return this.getProduct(sellerId, id);
  }

  /** Hash of the moderated, customer-visible content of a product (excludes price and stock). */
  private async contentFingerprint(c: PoolClient, productId: string): Promise<string> {
    const r = await this.db.one<{ h: string }>(
      `select md5(concat_ws('|', p.title, p.description, p.category_id, p.brand_id, p.short_description,
                (select string_agg(concat_ws(':', a.attribute_definition_id, a.position, a.value_text, a.value_number, a.value_boolean, a.value_json), ',' order by a.attribute_definition_id, a.position)
                   from public.product_attribute_values a where a.product_id = p.id),
                (select string_agg(concat_ws(':', o.code, o.name, ov.code, ov.label, ov.swatch_value), ',' order by o.sort_order, o.code, ov.sort_order, ov.code)
                   from public.product_options o left join public.product_option_values ov on ov.option_id = o.id where o.product_id = p.id),
                (select string_agg(concat_ws(':', v.sku, v.title, v.combination_key, v.status), ',' order by v.combination_key, v.sku)
                   from public.product_variants v where v.product_id = p.id and v.archived_at is null))) as h
         from public.products p where p.id = $1`,
      [productId],
      c,
    );
    return r?.h ?? '';
  }

  /**
   * Media changes on a live product: with mandatory moderation the product goes
   * back to review (images are content customers see).
   */
  private async mediaChanged(c: PoolClient, productId: string, actor: string | null) {
    const moderation = await this.settings.get('features.mandatory_moderation');
    if (!moderation) return;
    const p = await this.db.one(`select status from public.products where id = $1 for update`, [productId], c);
    if (p?.status !== 'ACTIVE') return;
    await this.transition(c, productId, 'ACTIVE', 'PENDING_REVIEW', actor, 'Cambios de imágenes requieren revisión');
    await this.db.exec(`update public.product_moderation_reviews set status = 'CANCELLED', updated_at = now() where product_id = $1 and status = 'PENDING'`, [productId], c);
    await this.db.exec(
      `insert into public.product_moderation_reviews (product_id, submitted_product_version, status, submitted_by, submitted_at)
       select id, version, 'PENDING', $2, now() from public.products where id = $1`,
      [productId, actor],
      c,
    );
  }

  async transition(c: PoolClient, productId: string, from: string, to: string, actor: string | null, reason: string) {
    if (from === to) return;
    await this.db.exec(
      `update public.products set status = $2,
              published_at = case when $2 = 'ACTIVE' then coalesce(published_at, now()) else published_at end,
              paused_at = case when $2 = 'PAUSED' then now() else null end,
              suspended_at = case when $2 = 'SUSPENDED' then now() else null end,
              archived_at = case when $2 = 'ARCHIVED' then now() else null end
        where id = $1`,
      [productId, to],
      c,
    );
    await this.db.exec(
      `insert into public.product_status_history (product_id, from_status, to_status, changed_by, reason) values ($1,$2,$3,$4,$5)`,
      [productId, from, to, actor, reason],
      c,
    );
  }

  async setProductStatus(user: RequestUser, sellerId: string, productId: string, action: 'PAUSE' | 'RESUME' | 'ARCHIVE') {
    await this.db.tx(async (c) => {
      const p = await this.db.one(`select status from public.products where id = $1 and seller_id = $2 for update`, [productId, sellerId], c);
      if (!p) throw notFound('Producto');
      if (action === 'PAUSE' && p.status === 'ACTIVE') await this.transition(c, productId, p.status, 'PAUSED', user.id, 'Pausado por el vendedor');
      else if (action === 'RESUME' && p.status === 'PAUSED') await this.transition(c, productId, p.status, 'ACTIVE', user.id, 'Reanudado por el vendedor');
      else if (action === 'ARCHIVE' && p.status !== 'ARCHIVED') await this.transition(c, productId, p.status, 'ARCHIVED', user.id, 'Archivado por el vendedor');
      else throw conflict('INVALID_TRANSITION', 'No se puede aplicar esta acción al producto en su estado actual.');
    });
    return { ok: true };
  }

  async addMedia(user: RequestUser, sellerId: string, productId: string, files: Express.Multer.File[]) {
    const p = await this.db.one(`select id from public.products where id = $1 and seller_id = $2`, [productId, sellerId]);
    if (!p) throw notFound('Producto');
    const count = await this.db.one(`select count(*)::int as n from public.product_media where product_id = $1`, [productId]);
    if (count!.n + files.length > 8) throw badRequest('TOO_MANY_IMAGES', 'Máximo 8 imágenes por producto.');
    const assetIds: string[] = [];
    for (const f of files) assetIds.push(await this.supa.uploadSellerImage(sellerId, user.id, f, `products/${productId}`, 'PUBLIC'));
    await this.db.tx(async (c) => {
      for (const [i, assetId] of assetIds.entries())
        await this.db.exec(
          `insert into public.product_media (product_id, seller_id, asset_id, media_role, sort_order, is_primary, alt_text)
           values ($1,$2,$3,'GALLERY',$4,$5,null)`,
          [productId, sellerId, assetId, count!.n + i, count!.n + i === 0],
          c,
        );
      await this.mediaChanged(c, productId, user.id);
    });
    return this.getProduct(sellerId, productId);
  }

  async removeMedia(sellerId: string, productId: string, mediaId: string, actor: string | null = null) {
    await this.db.tx(async (c) => {
      const m = await this.db.one(`select is_primary from public.product_media where id = $1 and product_id = $2 and seller_id = $3`, [mediaId, productId, sellerId], c);
      if (!m) throw notFound('Imagen');
      await this.db.exec(`delete from public.product_media where id = $1`, [mediaId], c);
      if (m.is_primary)
        await this.db.exec(
          `update public.product_media set is_primary = true where id = (select id from public.product_media where product_id = $1 order by sort_order limit 1)`,
          [productId],
          c,
        );
      await this.mediaChanged(c, productId, actor);
    });
    return this.getProduct(sellerId, productId);
  }

  async setPrimaryMedia(sellerId: string, productId: string, mediaId: string, actor: string | null = null) {
    await this.db.tx(async (c) => {
      const m = await this.db.one(`select id from public.product_media where id = $1 and product_id = $2 and seller_id = $3`, [mediaId, productId, sellerId], c);
      if (!m) throw notFound('Imagen');
      await this.db.exec(`update public.product_media set is_primary = (id = $2) where product_id = $1`, [productId, mediaId], c);
      await this.mediaChanged(c, productId, actor);
    });
    return this.getProduct(sellerId, productId);
  }

  // ------------------------------------------------------------------ pricing & stock
  async setPrice(c: PoolClient, actor: string, sellerId: string, variantId: string, currency: string, price: number | string, compareAt: number | string | null) {
    const amount = fromMinor(toMinor(price));
    const compare = compareAt != null && compareAt !== '' && toMinor(compareAt) > toMinor(price) ? fromMinor(toMinor(compareAt)) : null;
    const active = await this.db.one(
      `select amount::text as amount, compare_at_amount::text as compare_at from public.variant_price_versions
        where variant_id = $1 and currency_code = $2 and status = 'ACTIVE' order by effective_from desc limit 1`,
      [variantId, currency],
      c,
    );
    if (active && toMinor(active.amount) === toMinor(amount) && (active.compare_at ? toMinor(active.compare_at) : null) === (compare ? toMinor(compare) : null)) return;
    const pv = await this.db.one(
      `insert into public.variant_price_versions (variant_id, seller_id, currency_code, version_number, amount, compare_at_amount, status, created_by, updated_by)
       values ($1,$2,$3::varchar,(select coalesce(max(version_number),0)+1 from public.variant_price_versions where variant_id = $1 and currency_code = $3::varchar),$4,$5,'DRAFT',$6,$6)
       returning id`,
      [variantId, sellerId, currency, amount, compare, actor],
      c,
    );
    const hash = await this.db.one(`select public.compute_variant_minimum_price_rule_set_hash($1, now()) as h`, [pv!.id], c);
    await this.db.exec(
      `insert into public.variant_price_validations (variant_price_version_id, status, proposed_amount, currency_code, calculator_version,
               rule_set_hash, context_snapshot, result_snapshot, calculated_by)
       values ($1,'VALID',$2,$3,'rd-pricing-1.0',$4,$5::jsonb,$6::jsonb,$7)`,
      [pv!.id, amount, currency, hash!.h, JSON.stringify({ source: 'seller_product_editor' }), JSON.stringify({ minimum_price_rules: 0, result: 'VALID' }), actor],
      c,
    );
    await this.db.exec(`select public.publish_variant_price_version($1, $2, now())`, [pv!.id, actor], c);
  }

  /** Sets on-hand stock to `target` through an audited, applied inventory adjustment. */
  async setStock(c: PoolClient, actor: string, sellerId: string, variantId: string, locationId: string, target: number, type: string, reason: string, note?: string) {
    if (!Number.isInteger(target) || target < 0) throw badRequest('STOCK_INVALID', 'El stock debe ser un número entero positivo.');
    let item = await this.db.one(
      `select id, on_hand::int as on_hand, reserved::int as reserved from public.inventory_items where variant_id = $1 and location_id = $2 for update`,
      [variantId, locationId],
      c,
    );
    if (!item)
      item = await this.db.one(
        `insert into public.inventory_items (seller_id, variant_id, location_id, on_hand, reserved, low_stock_threshold)
         values ($1,$2,$3,0,0,5) returning id, on_hand::int as on_hand, reserved::int as reserved`,
        [sellerId, variantId, locationId],
        c,
      );
    const delta = target - item!.on_hand;
    if (delta === 0) return;
    if (target < item!.reserved) throw conflict('STOCK_BELOW_RESERVED', `Hay ${item!.reserved} unidades reservadas en pedidos en curso.`);
    const adjType = type === 'STOCK_CORRECTION' ? (delta > 0 ? 'STOCK_IN' : 'STOCK_CORRECTION') : type;
    const adj = await this.db.one(
      `insert into public.inventory_adjustments (seller_id, adjustment_type, status, reason_code, reason_text, requested_by_user_id,
               approved_by_user_id, requested_at, approved_at, correlation_id)
       values ($1,$2,'APPROVED',$3,$4,$5,$5,now(),now(),$6) returning id`,
      [sellerId, adjType, reason, note ?? null, actor, randomUUID()],
      c,
    );
    await this.db.exec(
      `insert into public.inventory_adjustment_items (adjustment_id, inventory_item_id, seller_id, quantity_delta, expected_on_hand)
       values ($1,$2,$3,$4,$5)`,
      [adj!.id, item!.id, sellerId, delta, item!.on_hand],
      c,
    );
    await this.db.exec(`select public.apply_inventory_adjustment($1,$2,$3)`, [adj!.id, actor, randomUUID()], c);
  }

  // ------------------------------------------------------------------ inventory
  async inventory(sellerId: string, q: { search?: string; stock?: string; categoryId?: string }) {
    const params: unknown[] = [sellerId];
    const where = [`v.seller_id = $1`, `v.status = 'ACTIVE'`, `p.status <> 'ARCHIVED'`];
    if (q.search?.trim()) {
      params.push(`%${q.search.trim()}%`);
      where.push(`(p.title ilike $${params.length} or v.sku ilike $${params.length} or coalesce(v.title,'') ilike $${params.length})`);
    }
    if (q.categoryId) {
      params.push(q.categoryId);
      where.push(`p.category_id = $${params.length}`);
    }
    const rows = await this.db.many(
      `select v.id as variant_id, v.sku, v.title as variant_title, p.id as product_id, p.title, p.status as product_status,
              ii.id as item_id, coalesce(ii.on_hand,0)::int as on_hand, coalesce(ii.reserved,0)::int as reserved,
              coalesce(ii.available_to_sell,0)::int as available, coalesce(ii.low_stock_threshold,5)::int as min_stock,
              il.name as location, il.id as location_id,
              (select vpv.amount::text from public.variant_price_versions vpv where vpv.variant_id = v.id and vpv.status = 'ACTIVE' order by vpv.effective_from desc limit 1) as price,
              (select pm.asset_id from public.product_media pm where pm.product_id = p.id order by pm.is_primary desc, pm.sort_order limit 1) as image_id
         from public.product_variants v join public.products p on p.id = v.product_id
         left join public.inventory_items ii on ii.variant_id = v.id and ii.status = 'ACTIVE'
         left join public.inventory_locations il on il.id = ii.location_id
        where ${where.join(' and ')}
        order by p.title, v.sku`,
      params,
    );
    let items = rows.map((r: any) => ({
      variantId: r.variant_id,
      itemId: r.item_id,
      sku: r.sku,
      title: r.title,
      variantTitle: r.variant_title,
      productId: r.product_id,
      productStatus: r.product_status,
      onHand: r.on_hand,
      reserved: r.reserved,
      available: r.available,
      minStock: r.min_stock,
      location: r.location ?? 'Almacén principal',
      locationId: r.location_id,
      price: r.price,
      value: r.price ? fromMinor(toMinor(r.price) * BigInt(r.on_hand)) : '0.00',
      state: r.available <= 0 ? 'OUT' : r.available <= r.min_stock ? 'LOW' : 'OK',
      imageUrl: r.image_id ? mediaUrl(r.image_id) : null,
    }));
    if (q.stock === 'LOW') items = items.filter((i) => i.state === 'LOW');
    if (q.stock === 'OUT') items = items.filter((i) => i.state === 'OUT');
    if (q.stock === 'OK') items = items.filter((i) => i.state === 'OK');
    const all = rows.length;
    const summary = {
      activeSkus: all,
      low: items.filter((i) => i.state === 'LOW').length,
      out: items.filter((i) => i.state === 'OUT').length,
      value: fromMinor(items.reduce((a, i) => a + toMinor(i.value), 0n)),
    };
    const movements = await this.db.many(
      `select m.id, m.movement_type, m.quantity_delta_on_hand::int as delta, m.occurred_at as created_at, v.sku, p.title, v.title as variant_title
         from public.inventory_movements m join public.inventory_items ii on ii.id = m.inventory_item_id
         join public.product_variants v on v.id = ii.variant_id join public.products p on p.id = v.product_id
        where m.seller_id = $1 and m.quantity_delta_on_hand <> 0 order by m.occurred_at desc limit 12`,
      [sellerId],
    ).catch(() => []);
    const trend = await this.db.many(
      `select d::date as day, coalesce((select sum(m.quantity_delta_on_hand) from public.inventory_movements m
                where m.seller_id = $1 and m.occurred_at::date <= d::date), 0)::int as stock
         from generate_series(current_date - 29, current_date, interval '1 day') d order by d`,
      [sellerId],
    ).catch(() => []);
    return { summary, items, movements, trend };
  }

  async adjustStock(user: RequestUser, sellerId: string, input: { variantId: string; mode: 'SET' | 'ADD' | 'REMOVE'; quantity: number; reason?: string; minStock?: number }) {
    await this.db.tx(async (c) => {
      const v = await this.db.one(`select id from public.product_variants where id = $1 and seller_id = $2`, [input.variantId, sellerId], c);
      if (!v) throw notFound('Variante');
      const loc = await this.db.one(`select id from public.inventory_locations where seller_id = $1 and status = 'ACTIVE' order by fulfillment_priority limit 1`, [sellerId], c);
      const cur = await this.db.one(`select on_hand::int as on_hand from public.inventory_items where variant_id = $1 and location_id = $2`, [v.id, loc!.id], c);
      const onHand = cur?.on_hand ?? 0;
      const target = input.mode === 'SET' ? input.quantity : input.mode === 'ADD' ? onHand + input.quantity : onHand - input.quantity;
      const type = input.mode === 'ADD' ? 'STOCK_IN' : input.mode === 'REMOVE' ? (input.reason === 'DAMAGE' ? 'DAMAGE' : input.reason === 'LOSS' ? 'LOSS' : 'STOCK_CORRECTION') : 'STOCK_CORRECTION';
      await this.setStock(c, user.id, sellerId, v.id, loc!.id, target, type, input.reason && /^[A-Z_]+$/.test(input.reason) ? input.reason : 'MANUAL_ADJUSTMENT');
      if (input.minStock != null)
        await this.db.exec(`update public.inventory_items set low_stock_threshold = $3 where variant_id = $1 and location_id = $2`, [v.id, loc!.id, input.minStock], c);
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ dashboard
  async dashboard(sellerId: string, days = 30) {
    const [kpi, prev, series, statusMix, lowStock, activity] = await Promise.all([
      this.db.one(
        `select coalesce(sum(sofs.customer_total),0)::text as sales, count(distinct so.id)::int as orders
           from public.seller_orders so join public.orders o on o.id = so.order_id
           left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
          where so.seller_id = $1 and o.placed_at >= now() - ($2 || ' days')::interval and so.lifecycle_status <> 'CANCELLED'`,
        [sellerId, days],
      ),
      this.db.one(
        `select coalesce(sum(sofs.customer_total),0)::text as sales, count(distinct so.id)::int as orders
           from public.seller_orders so join public.orders o on o.id = so.order_id
           left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
          where so.seller_id = $1 and o.placed_at >= now() - ($2*2 || ' days')::interval and o.placed_at < now() - ($2 || ' days')::interval
            and so.lifecycle_status <> 'CANCELLED'`,
        [sellerId, days],
      ),
      this.db.many(
        `select d::date as day, coalesce(sum(sofs.customer_total),0)::text as sales, count(so.id)::int as orders
           from generate_series(current_date - ($2::int - 1), current_date, interval '1 day') d
           left join public.orders o on o.placed_at::date = d::date
           left join public.seller_orders so on so.order_id = o.id and so.seller_id = $1 and so.lifecycle_status <> 'CANCELLED'
           left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
          group by d order by d`,
        [sellerId, days],
      ),
      this.db.many(
        `select fulfillment_status as status, count(*)::int as count from public.seller_orders where seller_id = $1 group by 1`,
        [sellerId],
      ),
      this.inventory(sellerId, {}).then((r) => r.items.sort((a, b) => a.available - b.available).slice(0, 4)),
      this.db.many(
        `(select 'ORDER' as kind, 'Nuevo pedido #RD-' || o.public_number as title,
                 'Compra por ' || coalesce(sofs.customer_total,0)::numeric(20,2)::text as detail, o.placed_at as at
            from public.seller_orders so join public.orders o on o.id = so.order_id
            left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
           where so.seller_id = $1 order by o.placed_at desc limit 5)
         union all
         (select 'PRODUCT', case h.to_status when 'ACTIVE' then 'Producto aprobado' when 'REJECTED' then 'Producto rechazado' else 'Producto en revisión' end,
                 p.title, h.created_at
            from public.product_status_history h join public.products p on p.id = h.product_id
           where p.seller_id = $1 and h.to_status in ('ACTIVE','REJECTED','PENDING_REVIEW') order by h.created_at desc limit 5)
         order by at desc limit 6`,
        [sellerId],
      ),
    ]);
    const products = await this.db.one(`select count(*) filter (where status='ACTIVE')::int as active from public.products where seller_id = $1`, [sellerId]);
    const pending = await this.db.one(
      `select count(*)::int as n from public.seller_orders where seller_id = $1 and fulfillment_status in ('UNFULFILLED','FULFILLED','PARTIALLY_FULFILLED') and lifecycle_status not in ('CANCELLED','CLOSED')`,
      [sellerId],
    );
    const pct = (a: string | number, b: string | number) => (Number(b) > 0 ? Math.round(((Number(a) - Number(b)) / Number(b)) * 1000) / 10 : null);
    return {
      kpis: {
        sales: kpi!.sales,
        salesChange: pct(kpi!.sales, prev!.sales),
        orders: kpi!.orders,
        ordersChange: pct(kpi!.orders, prev!.orders),
        activeProducts: products!.active,
        pendingOrders: pending!.n,
      },
      series,
      statusMix,
      lowStock,
      activity,
    };
  }

  // ------------------------------------------------------------------ finance
  async finance(sellerId: string, days = 30) {
    const currency = await this.settings.currency();
    const bal = await this.db.one(
      `select coalesce(pending_amount,0)::text as pending, coalesce(available_amount,0)::text as available, coalesce(reserve_amount,0)::text as reserve
         from public.seller_balance_projections where seller_id = $1 and currency_code = $2`,
      [sellerId, currency],
    );
    const agg = await this.db.one(
      `select coalesce(sum(sofs.customer_total),0)::text as gross, coalesce(sum(sofs.platform_commission_total),0)::text as commission,
              coalesce(sum(sofs.seller_entitlement_estimate),0)::text as net, coalesce(sum(sofs.product_net_amount),0)::text as products
         from public.seller_orders so join public.orders o on o.id = so.order_id
         join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
        where so.seller_id = $1 and o.placed_at >= now() - ($2 || ' days')::interval and so.lifecycle_status <> 'CANCELLED' and so.currency_code = $3`,
      [sellerId, days, currency],
    );
    const series = await this.db.many(
      `select d::date as day, coalesce(sum(sofs.customer_total),0)::text as sales, coalesce(sum(sofs.seller_entitlement_estimate),0)::text as profit
         from generate_series(current_date - ($2::int - 1), current_date, interval '1 day') d
         left join public.orders o on o.placed_at::date = d::date
         left join public.seller_orders so on so.order_id = o.id and so.seller_id = $1 and so.lifecycle_status <> 'CANCELLED' and so.currency_code = $3
         left join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id
        group by d order by d`,
      [sellerId, days, currency],
    );
    const movements = await this.db.many(
      `select * from (
         select o.placed_at as at, 'SALE' as kind, 'Venta #V-' || so.public_number as concept, sofs.seller_entitlement_estimate::text as amount, so.currency_code as currency
           from public.seller_orders so join public.orders o on o.id = so.order_id
           join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id where so.seller_id = $1
         union all
         select o.placed_at, 'COMMISSION', 'Comisión de plataforma #V-' || so.public_number, (-sofs.platform_commission_total)::text, so.currency_code
           from public.seller_orders so join public.orders o on o.id = so.order_id
           join public.seller_order_financial_snapshots sofs on sofs.seller_order_id = so.id where so.seller_id = $1 and sofs.platform_commission_total > 0
         union all
         select coalesce(p.paid_at, p.requested_at), 'PAYOUT', 'Retiro #PO-' || p.public_number || ' (' || lower(p.status) || ')', (-p.requested_amount)::text, p.currency_code
           from public.payouts p where p.seller_id = $1 and p.status not in ('CANCELLED','FAILED')
       ) m order by at desc limit 15`,
      [sellerId],
    );
    const policy = await this.db.one(
      `select ppd.minimum_payout_amount::text as minimum, ppd.approval_mode, ppd.hold_period_seconds
         from public.resolve_payout_policy($1, $2, now()) r join public.payout_policy_definitions ppd on ppd.rule_version_id = r.rule_version_id`,
      [sellerId, currency],
    ).catch(() => null);
    const commissionRate = await this.db.one(
      `select d.percentage_rate::text as rate from public.get_business_rule_candidates('PLATFORM_COMMISSION', $1, null, null, null, now()) cand
         join public.commission_rule_definitions d on d.rule_version_id = cand.rule_version_id
        order by cand.specificity_rank desc, cand.priority desc limit 1`,
      [sellerId],
    );
    const otherBalances = await this.db.many(
      `select currency_code as currency, pending_amount::text as pending, available_amount::text as available
         from public.seller_balance_projections where seller_id = $1 and currency_code <> $2 and (pending_amount <> 0 or available_amount <> 0)
        order by currency_code`,
      [sellerId, currency],
    );
    return {
      currency,
      otherBalances,
      balances: { pending: bal?.pending ?? '0.00', available: bal?.available ?? '0.00', reserve: bal?.reserve ?? '0.00' },
      period: { gross: agg!.gross, commission: agg!.commission, net: agg!.net, products: agg!.products },
      commissionRate: commissionRate ? Number(commissionRate.rate) : null,
      series,
      movements,
      payoutPolicy: policy ? { minimum: policy.minimum, approvalMode: policy.approval_mode } : null,
    };
  }

  async payoutAccounts(sellerId: string) {
    return this.db.many(
      `select id, method_code as "methodCode", display_label as "label", display_last4 as "last4", country_code as "countryCode",
              status, verification_status as "verificationStatus", metadata, created_at as "createdAt"
         from public.seller_payout_accounts where seller_id = $1 and status <> 'DISABLED' order by (metadata->>'is_primary')::boolean desc nulls last, created_at`,
      [sellerId],
    );
  }

  async addPayoutAccount(user: RequestUser, sellerId: string, input: { methodCode: 'BANK_ACCOUNT' | 'PAYPAL' | 'DIGITAL_WALLET'; holderName: string; bankName?: string; accountNumber?: string; accountType?: string; routingOrSwift?: string; countryCode?: string; email?: string; currency?: string; alias?: string; isPrimary?: boolean; documentId?: string }) {
    const currency = (input.currency ?? (await this.settings.currency())).toUpperCase();
    const cur = await this.db.one(`select 1 from public.currencies where code = $1 and is_active`, [currency]);
    if (!cur) throw badRequest('CURRENCY_INVALID', 'Moneda no soportada.');
    const store = await this.db.one(`select registration_country_code from public.seller_legal_profiles where seller_id = $1`, [sellerId]);
    const country = (input.countryCode ?? store?.registration_country_code ?? 'US').toUpperCase();
    if (!(await this.db.one(`select 1 from public.countries where alpha2 = $1`, [country]))) throw badRequest('COUNTRY_INVALID', 'Selecciona un país válido.');
    const details: Record<string, string | undefined> = { holder_name: input.holderName.trim() };
    let label: string;
    let tail: string | null = null;
    if (input.methodCode === 'BANK_ACCOUNT') {
      const acct = (input.accountNumber ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!input.bankName || !/^[A-Z0-9]{4,34}$/.test(acct))
        throw badRequest('BANK_ACCOUNT_INVALID', 'Indica el banco y un número de cuenta o IBAN válido.');
      input.accountNumber = acct;
      Object.assign(details, { bank_name: input.bankName, account_number: acct, account_type: input.accountType ?? 'CHECKING',
        routing_or_swift: input.routingOrSwift?.trim().toUpperCase() || undefined, document_id: input.documentId });
      label = input.alias?.trim() || input.bankName;
      tail = last4(input.accountNumber);
    } else {
      if (!input.email || !/^\S+@\S+\.\S+$/.test(input.email)) throw badRequest('EMAIL_INVALID', 'Correo de la cuenta inválido.');
      details.email = input.email.trim().toLowerCase();
      label = input.alias?.trim() || (input.methodCode === 'PAYPAL' ? 'PayPal' : 'Billetera digital');
      tail = last4(input.email.split('@')[0]).padStart(2, 'x');
    }
    const id = await this.db.tx(async (c) => {
      if (input.isPrimary)
        await this.db.exec(`update public.seller_payout_accounts set metadata = metadata || '{"is_primary": false}' where seller_id = $1`, [sellerId], c);
      const hasAny = await this.db.one(`select 1 from public.seller_payout_accounts where seller_id = $1 and status <> 'DISABLED' limit 1`, [sellerId], c);
      const r = await this.db.one(
        `insert into public.seller_payout_accounts (seller_id, provider_code, environment, method_code, destination_details_ciphertext,
                 encryption_key_version, display_label, display_last4, country_code, status, verification_status, metadata, created_by)
         values ($1,'RD_MANUAL','TEST',$2,$3,$4,$5,$6,$9,'PENDING','PENDING',$7::jsonb,$8) returning id`,
        [sellerId, input.methodCode, encrypt(JSON.stringify(details)), String(KEY_VERSION), label, tail, JSON.stringify({
          is_primary: !!input.isPrimary || !hasAny,
          currency,
          country,
          holder_name: input.holderName.trim(),
          bank_name: input.bankName ?? null,
          account_type: input.accountType ?? null,
          email_hint: input.email ? input.email.replace(/^(.{3}).*(@.*)$/, '$1***$2') : null,
        }), user.id, country],
        c,
      );
      await this.db.exec(
        `insert into public.seller_payout_account_currencies (payout_account_id, seller_id, currency_code, is_enabled, is_default)
         values ($1,$2,$3,true,true)`,
        [r!.id, sellerId, currency],
        c,
      );
      return r!.id;
    });
    return { id };
  }

  async updatePayoutAccount(sellerId: string, accountId: string, action: 'PRIMARY' | 'DISABLE') {
    await this.db.tx(async (c) => {
      const a = await this.db.one(`select id from public.seller_payout_accounts where id = $1 and seller_id = $2`, [accountId, sellerId], c);
      if (!a) throw notFound('Método de cobro');
      if (action === 'PRIMARY') {
        await this.db.exec(`update public.seller_payout_accounts set metadata = metadata || jsonb_build_object('is_primary', id = $2) where seller_id = $1`, [sellerId, accountId], c);
      } else {
        const open = await this.db.one(`select 1 from public.payouts where seller_payout_account_id = $1 and status in ('REQUESTED','APPROVAL_REQUIRED','APPROVED','PROCESSING')`, [accountId], c);
        if (open) throw conflict('PAYOUT_ACCOUNT_IN_USE', 'Este método tiene retiros en curso.');
        await this.db.exec(`update public.seller_payout_accounts set status = 'DISABLED', disabled_at = now() where id = $1`, [accountId], c);
      }
    });
    return this.payoutAccounts(sellerId);
  }

  async payouts(sellerId: string) {
    return this.db.many(
      `select p.id, 'PO-' || p.public_number as number, p.requested_amount::text as amount, p.currency_code as currency, p.status,
              p.requested_at as "requestedAt", p.approved_at as "approvedAt", p.paid_at as "paidAt", p.failure_detail as "failureDetail",
              a.display_label as "accountLabel", a.display_last4 as "accountLast4"
         from public.payouts p left join public.seller_payout_accounts a on a.id = p.seller_payout_account_id
        where p.seller_id = $1 order by p.requested_at desc limit 50`,
      [sellerId],
    );
  }

  async requestPayout(user: RequestUser, sellerId: string, input: { accountId: string; amount: number | string; idempotencyKey: string; currency?: string }) {
    const currency = (input.currency ?? (await this.settings.currency())).toUpperCase();
    const acc = await this.db.one(`select status, verification_status from public.seller_payout_accounts where id = $1 and seller_id = $2`, [input.accountId, sellerId]);
    if (!acc) throw notFound('Método de cobro');
    if (acc.status !== 'ACTIVE' || acc.verification_status !== 'VERIFIED')
      throw conflict('PAYOUT_ACCOUNT_NOT_VERIFIED', 'El método de cobro debe estar verificado por el equipo del marketplace antes de retirar.');
    const r = await this.db.tx((c) =>
      this.db.one(
        `select public.request_seller_payout($1,$2,$3,$4,$5,$6,$7,$8,now()) as id`,
        [sellerId, currency, input.accountId, fromMinor(toMinor(input.amount)), input.idempotencyKey, user.id, 'Solicitud desde el panel del vendedor', randomUUID()],
        c,
      ),
    );
    return { id: r!.id };
  }

  async cancelPayout(user: RequestUser, sellerId: string, payoutId: string) {
    const p = await this.db.one(`select id from public.payouts where id = $1 and seller_id = $2`, [payoutId, sellerId]);
    if (!p) throw notFound('Retiro');
    await this.db.tx((c) => this.db.exec(`select public.cancel_payout($1,$2,'Cancelado por el vendedor',$3,now())`, [payoutId, user.id, randomUUID()], c));
    return { ok: true };
  }

  // ------------------------------------------------------------------ helpers
  private validateProduct(input: ProductInput) {
    if (!input.title?.trim() || input.title.trim().length < 3) throw badRequest('TITLE_REQUIRED', 'El nombre del producto es obligatorio.');
    if (!input.description?.trim() || input.description.trim().length < 10) throw badRequest('DESCRIPTION_REQUIRED', 'La descripción debe tener al menos 10 caracteres.');
    if (input.description.length > 5000) throw badRequest('DESCRIPTION_TOO_LONG', 'La descripción admite máximo 5,000 caracteres.');
    if (!input.variants?.length) throw badRequest('VARIANTS_REQUIRED', 'Agrega al menos una variante con precio y stock.');
    if (input.variants.length > 100) throw badRequest('TOO_MANY_VARIANTS', 'Máximo 100 variantes por producto.');
    const skus = new Set<string>();
    const combos = new Set<string>();
    for (const v of input.variants) {
      if (!v.sku?.trim()) throw badRequest('SKU_REQUIRED', 'Cada variante necesita un SKU.');
      if (skus.has(v.sku.trim().toLowerCase())) throw badRequest('SKU_DUPLICATE', `SKU duplicado: ${v.sku}`);
      skus.add(v.sku.trim().toLowerCase());
      const combo = JSON.stringify(Object.entries(v.optionValues ?? {}).sort());
      if (combos.has(combo)) throw badRequest('VARIANT_DUPLICATE', 'Hay variantes con la misma combinación de opciones.');
      combos.add(combo);
      if (!(toMinor(v.price) > 0n)) throw badRequest('PRICE_INVALID', `El precio de ${v.sku} debe ser mayor que cero.`);
      if (!Number.isInteger(Number(v.stock)) || Number(v.stock) < 0) throw badRequest('STOCK_INVALID', `Stock inválido para ${v.sku}.`);
      if (!(Number(v.weightKg) > 0) || !(Number(v.lengthCm) > 0) || !(Number(v.widthCm) > 0) || !(Number(v.heightCm) > 0))
        throw badRequest('SHIPPING_DIMENSIONS_REQUIRED', 'Indica peso (kg) y dimensiones (largo, ancho y alto en cm) del paquete para calcular el envío.');
    }
  }

  private async uniqueSlug(c: PoolClient, source: string, excludeId?: string) {
    const base = slugify(source, 70);
    let slug = base;
    for (let i = 2; await this.db.one(`select 1 from public.products where slug = $1 and ($2::uuid is null or id <> $2)`, [slug, excludeId ?? null], c); i++)
      slug = `${base}-${i}`;
    return slug;
  }

  private async ensureBrand(c: PoolClient, name: string) {
    const slug = slugify(name, 60);
    const b = await this.db.one(`select id from public.brands where slug = $1`, [slug], c);
    if (b) return b.id;
    return (await this.db.one(`insert into public.brands (name, slug) values ($1,$2) returning id`, [name, slug], c))!.id;
  }

  async attributeDefinitions(categoryId: string) {
    return this.db.many(
      `with recursive up as (select id, parent_id from public.categories where id = $1
                              union all select c.id, c.parent_id from public.categories c join up on c.id = up.parent_id)
       select distinct on (ad.id) ad.id, ad.code, ad.name, ad.data_type as "dataType", ad.unit_code as "unit", cad.is_required as "required",
              ad.validation_rules as "validation", cad.sort_order
         from public.category_attribute_definitions cad join public.attribute_definitions ad on ad.id = cad.attribute_definition_id
        where cad.category_id in (select id from up) and ad.status = 'ACTIVE'
        order by ad.id, cad.sort_order`,
      [categoryId],
    );
  }

  async variantTemplates(categoryId: string) {
    return this.db.many(
      `with recursive up as (select id, parent_id from public.categories where id = $1
                              union all select c.id, c.parent_id from public.categories c join up on c.id = up.parent_id)
       select t.code, t.name, t.option_values as "values" from public.category_variant_option_templates t
        where t.category_id in (select id from up) and t.status = 'ACTIVE' order by t.sort_order`,
      [categoryId],
    );
  }
}
