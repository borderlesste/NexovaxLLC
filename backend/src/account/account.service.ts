import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { badRequest, notFound } from '../common/errors';
import { RequestUser, invalidateUserCache } from '../auth/auth';
import { mediaUrl } from '../catalog/catalog.sql';
import { MailService } from '../mail/mail.service';
import { config } from '../config';

export interface AddressInput {
  label?: string;
  recipientName: string;
  companyName?: string;
  line1: string;
  line2?: string;
  cityId: number;
  region?: string;
  postalCode?: string;
  phone?: string;
  isDefaultShipping?: boolean;
}

const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);

@Injectable()
export class AccountService {
  constructor(
    private readonly db: DbService,
    private readonly supa: SupabaseAdminService,
    private readonly mail: MailService,
  ) {}

  /** Creates the Supabase identity; DB trigger provisions marketplace user + CUSTOMER role. */
  async register(input: { fullName: string; email: string; password: string }) {
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(input.password))
      throw badRequest('WEAK_PASSWORD', 'La contraseña debe tener al menos 8 caracteres, con letras y números.');
    const user = await this.supa.createUser(input.email.trim().toLowerCase(), input.password, input.fullName.trim());
    const [first, ...rest] = input.fullName.trim().split(/\s+/);
    await this.db.exec(
      `insert into public.user_profiles (user_id, first_name, last_name, display_name)
       values ($1, $2, $3, $4)
       on conflict (user_id) do update set first_name = excluded.first_name, last_name = excluded.last_name, display_name = excluded.display_name`,
      [user.id, first, rest.join(' ') || null, input.fullName.trim()],
    );
    this.mail.fire(() => this.mail.welcome(user.id));
    return { id: user.id, email: user.email, confirmed: !!user.email_confirmed_at };
  }

  /**
   * Password recovery through our own e-mail (Resend): generates a one-time
   * Supabase recovery token and mails a link to /auth/restablecer. Always
   * answers OK so the endpoint cannot be used to discover accounts.
   */
  async requestPasswordRecovery(email: string) {
    const normalized = email.trim().toLowerCase();
    const userId = await this.supa.findUserIdByEmail(normalized);
    if (userId) {
      this.mail.fire(async () => {
        const tokenHash = await this.supa.recoveryTokenHash(normalized);
        if (!tokenHash) return;
        await this.mail.passwordRecovery(userId, normalized, `${config.webUrl}/auth/restablecer?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`);
      });
    }
    return { ok: true };
  }

  async me(user: RequestUser) {
    const p = await this.db.one(
      `select u.id, u.email::text as email, u.status, u.created_at, u.email_verified_at,
              up.first_name, up.last_name, up.display_name, up.phone, up.avatar_asset_id
         from public.users u left join public.user_profiles up on up.user_id = u.id where u.id = $1`,
      [user.id],
    );
    const counts = await this.db.one(
      `select (select count(*) from public.customer_favorites where user_id = $1)::int as favorites,
              (select coalesce(sum(ci.quantity),0) from public.cart_items ci join public.carts c on c.id = ci.cart_id
                where c.customer_id = $1 and c.status = 'ACTIVE' and ci.status = 'ACTIVE')::int as cart_items,
              (select count(*) from public.conversation_participants cp
                where cp.user_id = $1 and cp.status = 'ACTIVE'
                  and exists (select 1 from public.conversation_messages m
                               where m.conversation_id = cp.conversation_id and m.sender_user_id is distinct from $1
                                 and m.status = 'SENT'
                                 and m.sequence_number > coalesce((select lm.sequence_number from public.conversation_messages lm
                                                                    where lm.id = cp.last_read_message_id), 0)))::int as unread_conversations`,
      [user.id],
    );
    return {
      id: p.id,
      email: p.email,
      status: p.status,
      emailVerified: !!p.email_verified_at,
      memberSince: p.created_at,
      firstName: p.first_name,
      lastName: p.last_name,
      displayName: p.display_name ?? ([p.first_name, p.last_name].filter(Boolean).join(' ') || p.email),
      phone: p.phone,
      avatarUrl: p.avatar_asset_id ? mediaUrl(p.avatar_asset_id) : null,
      roles: user.roles,
      sellers: user.sellers,
      counts,
    };
  }

  async updateProfile(user: RequestUser, input: { firstName?: string; lastName?: string; phone?: string }) {
    const first = clean(input.firstName);
    const last = clean(input.lastName);
    await this.db.exec(
      `insert into public.user_profiles (user_id, first_name, last_name, display_name, phone)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id) do update set first_name = excluded.first_name, last_name = excluded.last_name,
              display_name = excluded.display_name, phone = excluded.phone`,
      [user.id, first, last, [first, last].filter(Boolean).join(' ') || null, clean(input.phone)],
    );
    invalidateUserCache(user.id);
    return this.me(user);
  }

  async changePassword(user: RequestUser, password: string) {
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password))
      throw badRequest('WEAK_PASSWORD', 'La contraseña debe tener al menos 8 caracteres, con letras y números.');
    await this.supa.updateUserPassword(user.id, password);
    return { ok: true };
  }

  // ---------------------------------------------------------------- addresses
  cities(q?: string) {
    return this.db.many(
      `select id::text as id, name, admin1_code from public.city_references
        where country_code = 'DO' and ($1::text is null or name ilike '%' || $1 || '%')
        order by population desc limit 60`,
      [clean(q)],
    );
  }

  async addresses(userId: string) {
    const rows = await this.db.many(
      `select id, label, recipient_name, company_name, line1, line2, city, city_id::text as city_id, region, postal_code,
              country_code, phone, is_default_shipping
         from public.addresses where user_id = $1 and deleted_at is null
        order by is_default_shipping desc, created_at`,
      [userId],
    );
    return rows.map(mapAddress);
  }

  async createAddress(userId: string, a: AddressInput) {
    return this.db.tx(async (c) => {
      const city = await this.db.one(`select id, name from public.city_references where id = $1 and country_code = 'DO'`, [a.cityId], c);
      if (!city) throw badRequest('CITY_SELECTION_REQUIRED', 'Selecciona una ciudad válida.');
      const hasAny = await this.db.one(`select 1 from public.addresses where user_id = $1 and deleted_at is null limit 1`, [userId], c);
      const makeDefault = a.isDefaultShipping || !hasAny;
      if (makeDefault)
        await this.db.exec(`update public.addresses set is_default_shipping = false where user_id = $1 and is_default_shipping`, [userId], c);
      const row = await this.db.one(
        `insert into public.addresses (user_id, label, recipient_name, company_name, line1, line2, city, city_id, region,
                                       postal_code, country_code, phone, is_default_shipping)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DO',$11,$12) returning *, city_id::text as city_id`,
        [userId, clean(a.label), a.recipientName.trim(), clean(a.companyName), a.line1.trim(), clean(a.line2), city.name, city.id,
         clean(a.region), clean(a.postalCode), clean(a.phone), makeDefault],
        c,
      );
      return mapAddress(row);
    });
  }

  async updateAddress(userId: string, id: string, a: AddressInput) {
    return this.db.tx(async (c) => {
      const existing = await this.db.one(`select id from public.addresses where id = $1 and user_id = $2 and deleted_at is null`, [id, userId], c);
      if (!existing) throw notFound('Dirección');
      const city = await this.db.one(`select id, name from public.city_references where id = $1 and country_code = 'DO'`, [a.cityId], c);
      if (!city) throw badRequest('CITY_SELECTION_REQUIRED', 'Selecciona una ciudad válida.');
      if (a.isDefaultShipping)
        await this.db.exec(`update public.addresses set is_default_shipping = false where user_id = $1 and id <> $2`, [userId, id], c);
      const row = await this.db.one(
        `update public.addresses set label=$3, recipient_name=$4, company_name=$5, line1=$6, line2=$7, city=$8, city_id=$9,
                region=$10, postal_code=$11, phone=$12, is_default_shipping = coalesce($13, is_default_shipping)
          where id = $1 and user_id = $2 returning *, city_id::text as city_id`,
        [id, userId, clean(a.label), a.recipientName.trim(), clean(a.companyName), a.line1.trim(), clean(a.line2), city.name, city.id,
         clean(a.region), clean(a.postalCode), clean(a.phone), a.isDefaultShipping ?? null],
        c,
      );
      return mapAddress(row);
    });
  }

  async deleteAddress(userId: string, id: string) {
    const n = await this.db.exec(
      `update public.addresses set deleted_at = now(), is_default_shipping = false where id = $1 and user_id = $2 and deleted_at is null`,
      [id, userId],
    );
    if (!n) throw notFound('Dirección');
    await this.db.exec(
      `update public.addresses set is_default_shipping = true
        where id = (select id from public.addresses where user_id = $1 and deleted_at is null order by created_at limit 1)
          and not exists (select 1 from public.addresses where user_id = $1 and deleted_at is null and is_default_shipping)`,
      [userId],
    );
    return { ok: true };
  }

  // ---------------------------------------------------------------- favorites / follows
  async toggleFavorite(userId: string, productId: string) {
    const del = await this.db.exec(`delete from public.customer_favorites where user_id = $1 and product_id = $2`, [userId, productId]);
    if (del) return { favorite: false };
    const p = await this.db.one(`select id from public.products where id = $1 and status = 'ACTIVE'`, [productId]);
    if (!p) throw notFound('Producto');
    await this.db.exec(`insert into public.customer_favorites (user_id, product_id) values ($1, $2) on conflict do nothing`, [userId, productId]);
    return { favorite: true };
  }

  async favorites(userId: string, currency: string) {
    const { PRODUCT_CARD_SELECT, PRODUCT_CARD_JOINS, mapProductCard } = await import('../catalog/catalog.sql');
    const rows = await this.db.many(
      `select ${PRODUCT_CARD_SELECT('$2')} from public.customer_favorites f
         join public.products p on p.id = f.product_id ${PRODUCT_CARD_JOINS('$2')}
        where f.user_id = $1 order by f.created_at desc`,
      [userId, currency],
    );
    return rows.map(mapProductCard);
  }

  async toggleFollow(userId: string, sellerId: string) {
    const del = await this.db.exec(`delete from public.seller_followers where user_id = $1 and seller_id = $2`, [userId, sellerId]);
    if (del) return { following: false };
    const s = await this.db.one(`select id from public.sellers where id = $1 and status = 'ACTIVE'`, [sellerId]);
    if (!s) throw notFound('Tienda');
    await this.db.exec(`insert into public.seller_followers (user_id, seller_id) values ($1, $2) on conflict do nothing`, [userId, sellerId]);
    return { following: true };
  }

  async followedStores(userId: string) {
    return this.db.many(
      `select s.id, s.slug, coalesce(ssp.display_name, s.slug) as name, ssp.short_description as "shortDescription",
              case when ssp.logo_asset_id is null then null else '/api/media/' || ssp.logo_asset_id end as "logoUrl"
         from public.seller_followers f join public.sellers s on s.id = f.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where f.user_id = $1 order by f.created_at desc`,
      [userId],
    );
  }
}

function mapAddress(r: any) {
  return {
    id: r.id,
    label: r.label,
    recipientName: r.recipient_name,
    companyName: r.company_name,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    cityId: r.city_id,
    region: r.region,
    postalCode: r.postal_code,
    countryCode: r.country_code,
    phone: r.phone,
    isDefaultShipping: r.is_default_shipping,
  };
}
