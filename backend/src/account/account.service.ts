import { webUrl } from '../mail/mail.templates';
import { PoliciesService } from './policies.service';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { AppError, badRequest, forbidden, notFound } from '../common/errors';
import { RequestUser, invalidateUserCache } from '../auth/auth';
import { mediaUrl } from '../catalog/catalog.sql';
import { MailService } from '../mail/mail.service';
import { config } from '../config';
import { assertPasswordAcceptable } from '../common/password';
import { normalizeAddress, normalizeCountry, REAL_COUNTRY, resolveCityId } from '../common/geo';

export interface AddressInput {
  label?: string;
  recipientName: string;
  companyName?: string;
  line1: string;
  line2?: string;
  countryCode: string;
  city: string;
  region?: string;
  postalCode?: string;
  phone?: string;
  isDefaultShipping?: boolean;
}

const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);
export const LOCALES = ['es', 'en', 'fr', 'ht'] as const;
export type Locale = (typeof LOCALES)[number];

interface WelcomeBadge {
  publicName: string;
  zoom: number;
  x: number;
  y: number;
}

const WELCOME_BADGE_FIELDS = 'public_name as "publicName", zoom, x, y';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly db: DbService,
    private readonly supa: SupabaseAdminService,
    private readonly mail: MailService,
    private readonly policies: PoliciesService,
  ) {}

  /** Creates the Supabase identity; DB trigger provisions marketplace user + CUSTOMER role. */
  async register(input: { fullName: string; email: string; password: string; locale?: string; acceptTerms?: boolean; next?: string }, client: { ip?: string | null; userAgent?: string | null } = {}) {
    // The checkbox is the legal consent: no account without it.
    if (input.acceptTerms !== true) throw badRequest('TERMS_REQUIRED', 'Debes aceptar los términos y la política de privacidad.');
    await assertPasswordAcceptable(input.password);
    const user = await this.supa.createUser(input.email.trim().toLowerCase(), input.password, input.fullName.trim());
    const [first, ...rest] = input.fullName.trim().split(/\s+/);
    await this.db.exec(
      `insert into public.user_profiles (user_id, first_name, last_name, display_name)
       values ($1, $2, $3, $4)
       on conflict (user_id) do update set first_name = excluded.first_name, last_name = excluded.last_name, display_name = excluded.display_name`,
      [user.id, first, rest.join(' ') || null, input.fullName.trim()],
    );
    if (input.locale && (LOCALES as readonly string[]).includes(input.locale))
      await this.db.exec(`update public.users set locale = $2 where id = $1`, [user.id, input.locale]);
    await this.policies.acceptAccountPolicies(user.id, { method: 'REGISTRATION', locale: input.locale ?? 'es', ip: client.ip, userAgent: client.userAgent });
    const confirmed = !!user.email_confirmed_at;
    if (confirmed) this.mail.fire(() => this.mail.welcome(user.id));
    else this.mail.fire(() => this.sendVerification(user.id, user.email!, input.next));
    return { email: user.email, confirmed, verificationSent: !confirmed };
  }

  private async sendVerification(userId: string, email: string, next?: string) {
    const tokenHash = await this.supa.emailVerificationTokenHash(email);
    if (!tokenHash) return;
    const confirmation = new URL(`${webUrl()}/auth/confirmar`);
    confirmation.searchParams.set('token_hash', tokenHash);
    confirmation.searchParams.set('type', 'email');
    if (next?.startsWith('/') && !next.startsWith('//') && !/[\\\u0000-\u001f]/.test(next)) {
      const destination = new URL(next, confirmation.origin);
      if (destination.origin === confirmation.origin && !destination.pathname.startsWith('//') && !/^\/auth(?:\/|$)/.test(destination.pathname)) {
        confirmation.searchParams.set('next', `${destination.pathname}${destination.search}${destination.hash}`);
      }
    }
    await this.mail.emailVerification(userId, email, confirmation.href);
  }

  /** Password sign-in on behalf of the browser (see AccountController.login). */
  login(email: string, password: string, captchaToken?: string | null) {
    return this.supa.signInWithPassword(email.trim().toLowerCase(), password, captchaToken);
  }

  /**
   * Re-sends the verification link. Always answers OK (no account discovery).
   * New accounts stay in PENDING_VERIFICATION until the address is confirmed, so
   * those are exactly the ones that need it (suspended or deleted accounts never get one).
   */
  async resendVerification(email: string, next?: string) {
    const normalized = email.trim().toLowerCase();
    const u = await this.db.one<{ id: string }>(
      `select id from public.users
        where lower(email::text) = $1 and email_verified_at is null and status in ('PENDING_VERIFICATION', 'ACTIVE')`,
      [normalized],
    );
    if (u) this.mail.fire(() => this.sendVerification(u.id, normalized, next));
    return { ok: true };
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
        await this.mail.passwordRecovery(userId, normalized, `${webUrl()}/auth/restablecer?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`);
      });
    }
    return { ok: true };
  }

  async me(user: RequestUser) {
    const p = await this.db.one(
      `select u.id, u.email::text as email, u.status, u.created_at, u.email_verified_at, u.locale, u.delivery_country,
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
      locale: (LOCALES as readonly string[]).includes(p.locale) ? p.locale : 'es',
      deliveryCountry: p.delivery_country ?? null,
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

  async getWelcomeBadge(user: RequestUser) {
    if (user.status !== 'ACTIVE') throw forbidden('Tu cuenta aún no está activa en el marketplace.');
    return this.withWelcomeBadgeStorage(() => this.db.one<WelcomeBadge>(
      `select ${WELCOME_BADGE_FIELDS} from public.nx_welcome_badges b
        join public.users u on u.id = b.user_id where b.user_id = $1 and u.status = 'ACTIVE'`,
      [user.id],
    ));
  }

  async getWelcomeBadgePhoto(user: RequestUser) {
    if (user.status !== 'ACTIVE') throw forbidden('Tu cuenta aún no está activa en el marketplace.');
    const badge = await this.withWelcomeBadgeStorage(() => this.db.one<{ photo: Buffer }>(
      `select b.photo from public.nx_welcome_badges b
        join public.users u on u.id = b.user_id where b.user_id = $1 and u.status = 'ACTIVE'`,
      [user.id],
    ));
    if (!badge) throw notFound('Archivo');
    return badge.photo;
  }

  async saveWelcomeBadge(user: RequestUser, input: WelcomeBadge, file?: Express.Multer.File) {
    if (user.status !== 'ACTIVE') throw forbidden('Tu cuenta aún no está activa en el marketplace.');
    const photo = file ? await this.supa.normalizeWelcomeBadgePhoto(file) : null;
    const fields = [user.id, input.publicName, input.zoom, input.x, input.y];
    return this.withWelcomeBadgeStorage(() => this.db.tx(async (c) => {
      const active = await this.db.one(`select 1 from public.users where id = $1 and status = 'ACTIVE' for no key update`, [user.id], c);
      if (!active) throw forbidden('Tu cuenta aún no está activa en el marketplace.');
      if (photo) {
        return this.db.one<WelcomeBadge>(
          `insert into public.nx_welcome_badges (user_id, public_name, zoom, x, y, photo) values ($1, $2, $3, $4, $5, $6)
           on conflict (user_id) do update set public_name = excluded.public_name, zoom = excluded.zoom, x = excluded.x, y = excluded.y,
              photo = excluded.photo returning ${WELCOME_BADGE_FIELDS}`,
          [...fields, photo], c,
        );
      }
      const updated = await this.db.one<WelcomeBadge>(
        `update public.nx_welcome_badges set public_name = $2, zoom = $3, x = $4, y = $5
          where user_id = $1 returning ${WELCOME_BADGE_FIELDS}`,
        fields, c,
      );
      if (!updated) throw badRequest('WELCOME_BADGE_PHOTO_REQUIRED', 'Elige una foto para tu insignia.');
      return updated;
    }));
  }

  private async withWelcomeBadgeStorage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || (error.code !== '42P01' && error.code !== '42501')) throw error;
      this.logger.warn(`Welcome badge storage unavailable (SQLSTATE ${error.code}); check migration 20261127100000 and API role grants.`);
      throw new AppError('WELCOME_BADGE_STORAGE_UNAVAILABLE', 'El guardado de la insignia no está disponible en este momento.', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async setAvatar(user: RequestUser, file?: Express.Multer.File) {
    if (!file) throw badRequest('NO_FILES', 'Selecciona una imagen.');
    await this.supa.setUserAvatar(user.id, file);
    invalidateUserCache(user.id);
    return this.me(user);
  }

  async removeAvatar(user: RequestUser) {
    await this.supa.removeUserAvatar(user.id);
    invalidateUserCache(user.id);
    return this.me(user);
  }

  async setLocale(user: RequestUser, locale: string) {
    if (!(LOCALES as readonly string[]).includes(locale)) throw badRequest('LOCALE_INVALID', 'Idioma no soportado.');
    await this.db.exec(`update public.users set locale = $2 where id = $1`, [user.id, locale]);
    return { locale };
  }

  /** Saved browsing destination (country only); null clears it. */
  async setDeliveryCountry(user: RequestUser, country: string | null) {
    const cc = country ? await normalizeCountry(this.db, country) : null;
    await this.db.exec(`update public.users set delivery_country = $2 where id = $1`, [user.id, cc]);
    invalidateUserCache(user.id);
    return { deliveryCountry: cc };
  }

  async changePassword(user: RequestUser, password: string) {
    await assertPasswordAcceptable(password);
    await this.supa.updateUserPassword(user.id, password);
    return { ok: true };
  }

  // ---------------------------------------------------------------- addresses
  countries() {
    return this.db.many(
      `select alpha2 as code, alpha3, name, phone_prefix as "phonePrefix",
              exists (select 1 from public.geo_regions r where r.country_code = alpha2) as "hasRegions"
         from public.countries where is_active and ${REAL_COUNTRY} order by name`,
    );
  }

  async addresses(userId: string) {
    const rows = await this.db.many(
      `select id, label, recipient_name, company_name, line1, line2, city, region, postal_code,
              country_code, phone, is_default_shipping
         from public.addresses where user_id = $1 and deleted_at is null
        order by is_default_shipping desc, created_at`,
      [userId],
    );
    return rows.map(mapAddress);
  }

  async createAddress(userId: string, a: AddressInput) {
    return this.db.tx(async (c) => {
      const geo = await normalizeAddress(this.db, a, c);
      const cityId = await resolveCityId(this.db, geo.countryCode, geo.city, geo.region, c);
      const hasAny = await this.db.one(`select 1 from public.addresses where user_id = $1 and deleted_at is null limit 1`, [userId], c);
      const makeDefault = a.isDefaultShipping || !hasAny;
      if (makeDefault)
        await this.db.exec(`update public.addresses set is_default_shipping = false where user_id = $1 and is_default_shipping`, [userId], c);
      const row = await this.db.one(
        `insert into public.addresses (user_id, label, recipient_name, company_name, line1, line2, city, city_id, region,
                                       postal_code, country_code, phone, is_default_shipping)
         values ($1,$2,$3,$4,$5,$6,$7,$13,$8,$9,$10,$11,$12) returning *`,
        [userId, clean(a.label), a.recipientName.trim(), clean(a.companyName), a.line1.trim(), clean(a.line2), geo.city,
         geo.region, geo.postalCode, geo.countryCode, geo.phone, makeDefault, cityId],
        c,
      );
      return mapAddress(row);
    });
  }

  async updateAddress(userId: string, id: string, a: AddressInput) {
    return this.db.tx(async (c) => {
      const existing = await this.db.one(`select id from public.addresses where id = $1 and user_id = $2 and deleted_at is null`, [id, userId], c);
      if (!existing) throw notFound('Dirección');
      const geo = await normalizeAddress(this.db, a, c);
      const cityId = await resolveCityId(this.db, geo.countryCode, geo.city, geo.region, c);
      if (a.isDefaultShipping)
        await this.db.exec(`update public.addresses set is_default_shipping = false where user_id = $1 and id <> $2`, [userId, id], c);
      const row = await this.db.one(
        `update public.addresses set label=$3, recipient_name=$4, company_name=$5, line1=$6, line2=$7, city=$8, city_id=$14,
                region=$9, postal_code=$10, country_code=$11, phone=$12, is_default_shipping = coalesce($13, is_default_shipping)
          where id = $1 and user_id = $2 returning *`,
        [id, userId, clean(a.label), a.recipientName.trim(), clean(a.companyName), a.line1.trim(), clean(a.line2), geo.city,
         geo.region, geo.postalCode, geo.countryCode, geo.phone, a.isDefaultShipping ?? null, cityId],
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
    region: r.region,
    postalCode: r.postal_code,
    countryCode: r.country_code,
    phone: r.phone,
    isDefaultShipping: r.is_default_shipping,
  };
}
