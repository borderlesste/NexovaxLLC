import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { invalidateUserCache, RequestUser, SELLER_AREAS, SellerArea } from '../auth/auth';
import { AppError, badRequest, conflict, notFound } from '../common/errors';
import { MailService } from '../mail/mail.service';
import { webUrl } from '../mail/mail.templates';

const INVITE_DAYS = 7;
const MAX_MEMBERS = 25;
const hashToken = (token: string) => createHash('sha256').update(token).digest();
const code = (a: SellerArea) => `seller.area.${a.toLowerCase()}`;
const invitationNotFound = () => new AppError('NOT_FOUND', 'Invitación no encontrada.', HttpStatus.NOT_FOUND);

export function cleanAreas(areas: unknown): SellerArea[] {
  const list = Array.isArray(areas) ? areas : [];
  return SELLER_AREAS.filter((a) => list.includes(a));
}

/**
 * Store team: the owner invites people by e-mail and picks which parts of the panel each one
 * can use. Members never get the team itself, payout methods or withdrawals.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly db: DbService,
    private readonly mail: MailService,
  ) {}

  async list(sellerId: string) {
    const [owner, members, invitations] = await Promise.all([
      this.db.one(
        `select u.id, u.email::text as email, coalesce(nullif(trim(concat_ws(' ', up.first_name, up.last_name)), ''), up.display_name, split_part(u.email::text, '@', 1)) as name
           from public.sellers s join public.users u on u.id = s.owner_user_id left join public.user_profiles up on up.user_id = u.id
          where s.id = $1`,
        [sellerId],
      ),
      this.db.many(
        `select m.id, m.user_id, m.status, m.accepted_at, m.created_at, u.email::text as email,
                coalesce(nullif(trim(concat_ws(' ', up.first_name, up.last_name)), ''), up.display_name, split_part(u.email::text, '@', 1)) as name,
                coalesce((select array_agg(upper(substr(p.code, 13)) order by p.code)
                            from public.seller_member_permissions g join public.permissions p on p.id = g.permission_id
                           where g.seller_member_id = m.id and g.revoked_at is null and p.code like 'seller.area.%'), '{}') as areas
           from public.seller_members m join public.users u on u.id = m.user_id left join public.user_profiles up on up.user_id = u.id
          where m.seller_id = $1 and m.status <> 'REMOVED' order by m.created_at`,
        [sellerId],
      ),
      this.db.many(
        `select id, email::text as email, areas, expires_at, created_at from public.seller_member_invitations
          where seller_id = $1 and status = 'PENDING' and expires_at > now() order by created_at desc`,
        [sellerId],
      ),
    ]);
    return {
      owner: owner ? { userId: owner.id, email: owner.email, name: owner.name } : null,
      members: members.map((m) => ({
        id: m.id,
        userId: m.user_id,
        email: m.email,
        name: m.name,
        status: m.status,
        areas: cleanAreas(m.areas),
        joinedAt: m.accepted_at ?? m.created_at,
      })),
      invitations: invitations.map((i) => ({ id: i.id, email: i.email, areas: cleanAreas(i.areas), expiresAt: i.expires_at, createdAt: i.created_at })),
      areas: SELLER_AREAS,
    };
  }

  async invite(user: RequestUser, sellerId: string, input: { email: string; areas: string[] }) {
    const email = String(input.email ?? '').trim().toLowerCase();
    const areas = cleanAreas(input.areas);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('INVALID_EMAIL', 'Escribe un correo electrónico válido.');
    if (!areas.length) throw badRequest('TEAM_AREAS_REQUIRED', 'Elige al menos una sección para el nuevo miembro.');
    if (email === user.email.toLowerCase()) throw badRequest('TEAM_SELF_INVITE', 'No puedes invitarte a ti mismo.');
    const existing = await this.db.one(
      `select 1 from public.seller_members m join public.users u on u.id = m.user_id
        where m.seller_id = $1 and m.status <> 'REMOVED' and lower(u.email::text) = $2`,
      [sellerId, email],
    );
    if (existing) throw conflict('TEAM_ALREADY_MEMBER', 'Esa persona ya forma parte del equipo.');
    const count = await this.db.one<{ n: number }>(
      `select (select count(*) from public.seller_members where seller_id = $1 and status <> 'REMOVED')::int
            + (select count(*) from public.seller_member_invitations where seller_id = $1 and status = 'PENDING' and expires_at > now())::int as n`,
      [sellerId],
    );
    if ((count?.n ?? 0) >= MAX_MEMBERS) throw badRequest('TEAM_LIMIT', `Tu equipo puede tener hasta ${MAX_MEMBERS} personas.`);

    const token = randomBytes(32).toString('base64url');
    const inv = await this.db.tx(async (c) => {
      // A new invitation to the same address replaces the pending one (resend).
      await this.db.exec(
        `update public.seller_member_invitations set status = 'REVOKED', revoked_at = now()
          where seller_id = $1 and lower(email::text) = $2 and status = 'PENDING'`,
        [sellerId, email],
        c,
      );
      return this.db.one(
        `insert into public.seller_member_invitations (seller_id, email, token_hash, status, invited_by, expires_at, areas)
         values ($1, $2, $3, 'PENDING', $4, now() + make_interval(days => $5), $6::text[]) returning id, expires_at`,
        [sellerId, email, hashToken(token), user.id, INVITE_DAYS, areas],
        c,
      );
    });
    const link = `${webUrl()}/vendedor/invitacion?token=${token}`;
    this.mail.fire(() => this.mail.sellerTeamInvitation(inv!.id, sellerId, user.id, email, areas, link));
    return { id: inv!.id, email, areas, expiresAt: inv!.expires_at };
  }

  async revokeInvitation(sellerId: string, id: string) {
    const n = await this.db.exec(
      `update public.seller_member_invitations set status = 'REVOKED', revoked_at = now() where id = $1 and seller_id = $2 and status = 'PENDING'`,
      [id, sellerId],
    );
    if (!n) throw invitationNotFound();
    return { ok: true };
  }

  private async setAreas(memberId: string, areas: SellerArea[], byUserId: string, c?: any) {
    const wanted = areas.map(code);
    await this.db.exec(
      `update public.seller_member_permissions g set revoked_at = now(), revoked_by = $3
         from public.permissions p
        where g.permission_id = p.id and g.seller_member_id = $1 and g.revoked_at is null
          and p.code like 'seller.area.%' and not (p.code = any($2::text[]))`,
      [memberId, wanted, byUserId],
      c,
    );
    await this.db.exec(
      `insert into public.seller_member_permissions (seller_member_id, permission_id, granted_by)
       select $1, p.id, $3 from public.permissions p
        where p.code = any($2::text[])
          and not exists (select 1 from public.seller_member_permissions g where g.seller_member_id = $1 and g.permission_id = p.id and g.revoked_at is null)`,
      [memberId, wanted, byUserId],
      c,
    );
  }

  private async member(sellerId: string, memberId: string) {
    const m = await this.db.one(`select id, user_id, status from public.seller_members where id = $1 and seller_id = $2 and status <> 'REMOVED'`, [memberId, sellerId]);
    if (!m) throw notFound('Miembro');
    return m;
  }

  async updateMember(user: RequestUser, sellerId: string, memberId: string, input: { areas?: string[]; status?: 'ACTIVE' | 'SUSPENDED' }) {
    const m = await this.member(sellerId, memberId);
    await this.db.tx(async (c) => {
      if (input.areas) {
        const areas = cleanAreas(input.areas);
        if (!areas.length) throw badRequest('TEAM_AREAS_REQUIRED', 'Elige al menos una sección para el nuevo miembro.');
        await this.setAreas(m.id, areas, user.id, c);
      }
      if (input.status && input.status !== m.status)
        await this.db.exec(
          `update public.seller_members set status = $2, suspended_at = case when $2 = 'SUSPENDED' then now() end where id = $1`,
          [m.id, input.status],
          c,
        );
    });
    invalidateUserCache(m.user_id);
    return { ok: true };
  }

  async removeMember(user: RequestUser, sellerId: string, memberId: string) {
    const m = await this.member(sellerId, memberId);
    await this.db.tx(async (c) => {
      await this.setAreas(m.id, [], user.id, c);
      await this.db.exec(`update public.seller_members set status = 'REMOVED', removed_at = now(), suspended_at = null where id = $1`, [m.id], c);
    });
    invalidateUserCache(m.user_id);
    return { ok: true };
  }

  /** A member leaves a store they were invited to. */
  async leave(user: RequestUser, sellerId: string) {
    const m = await this.db.one(`select id from public.seller_members where seller_id = $1 and user_id = $2 and status <> 'REMOVED'`, [sellerId, user.id]);
    if (!m) throw notFound('Miembro');
    return this.removeMember(user, sellerId, m.id);
  }

  private async invitation(token: string) {
    if (!token || token.length < 20) throw invitationNotFound();
    const inv = await this.db.one(
      `select i.id, i.seller_id, i.email::text as email, i.status, i.areas, i.expires_at, i.invited_by, (i.expires_at <= now()) as expired,
              coalesce(ssp.display_name, s.slug) as store, s.slug as store_slug, s.owner_user_id
         from public.seller_member_invitations i join public.sellers s on s.id = i.seller_id
         left join public.seller_store_profiles ssp on ssp.seller_id = s.id
        where i.token_hash = $1`,
      [hashToken(token)],
    );
    if (!inv) throw invitationNotFound();
    return inv;
  }

  async preview(user: RequestUser, token: string) {
    const inv = await this.invitation(token);
    return {
      store: inv.store,
      storeSlug: inv.store_slug,
      email: inv.email,
      areas: cleanAreas(inv.areas),
      status: inv.status === 'PENDING' && inv.expired ? 'EXPIRED' : inv.status,
      emailMatches: inv.email.toLowerCase() === user.email.toLowerCase(),
    };
  }

  async accept(user: RequestUser, token: string) {
    const inv = await this.invitation(token);
    if (inv.status !== 'PENDING') throw badRequest('INVITATION_NOT_PENDING', 'Esta invitación ya fue usada o cancelada.');
    if (inv.expired) throw badRequest('INVITATION_EXPIRED', 'Esta invitación venció. Pide al propietario que te envíe otra.');
    if (inv.email.toLowerCase() !== user.email.toLowerCase())
      throw new AppError('INVITATION_EMAIL_MISMATCH', 'Esta invitación es para otro correo. Inicia sesión con la cuenta que recibió la invitación.', HttpStatus.FORBIDDEN);
    if (inv.owner_user_id === user.id) throw badRequest('TEAM_SELF_INVITE', 'No puedes invitarte a ti mismo.');
    await this.db.tx(async (c) => {
      const exists = await this.db.one(`select 1 from public.seller_members where seller_id = $1 and user_id = $2 and status <> 'REMOVED'`, [inv.seller_id, user.id], c);
      if (exists) throw conflict('TEAM_ALREADY_MEMBER', 'Esa persona ya forma parte del equipo.');
      const m = await this.db.one(
        `insert into public.seller_members (seller_id, user_id, status, added_by, accepted_at) values ($1, $2, 'ACTIVE', $3, now()) returning id`,
        [inv.seller_id, user.id, inv.invited_by],
        c,
      );
      await this.setAreas(m!.id, cleanAreas(inv.areas), inv.invited_by, c);
      await this.db.exec(
        `update public.seller_member_invitations set status = 'ACCEPTED', accepted_at = now(), accepted_by_user_id = $2 where id = $1`,
        [inv.id, user.id],
        c,
      );
    });
    invalidateUserCache(user.id);
    return { sellerId: inv.seller_id, store: inv.store };
  }
}
