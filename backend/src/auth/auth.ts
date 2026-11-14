import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { AppError } from '../common/errors';

export type RoleCode = 'CUSTOMER' | 'SELLER' | 'SUPPORT' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';

export interface RequestUser {
  id: string;
  email: string;
  status: string;
  roles: RoleCode[];
  /** Sellers the user owns or is an active member of. */
  sellers: { id: string; slug: string; status: string; isOwner: boolean }[];
  sessionId?: string;
}

export const IS_PUBLIC = 'rd:isPublic';
export const ROLES = 'rd:roles';
/** Route is reachable without a token (a valid token still populates the user). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Requires at least one of the given roles. ADMIN/SUPER_ADMIN satisfy staff roles. */
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as RequestUser | undefined;
});

const jwks = createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`), {
  cacheMaxAge: 10 * 60 * 1000,
});

const userCache = new Map<string, { at: number; user: RequestUser }>();
const USER_CACHE_MS = 15_000;

export function invalidateUserCache(userId: string) {
  userCache.delete(userId);
}

export function isStaff(u: RequestUser | undefined, ...roles: RoleCode[]) {
  if (!u) return false;
  if (u.roles.includes('SUPER_ADMIN') || u.roles.includes('ADMIN')) return true;
  return roles.some((r) => u.roles.includes(r));
}

export const ROLE_NAMES: Record<RoleCode, string> = {
  CUSTOMER: 'Cliente', SELLER: 'Vendedor', SUPPORT: 'Soporte', MODERATOR: 'Moderador', ADMIN: 'Administrador', SUPER_ADMIN: 'Super administrador',
};
const STAFF: RoleCode[] = ['SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

/**
 * 403 that tells staff which of their roles falls short and which role the action needs
 * (e.g. «Tu rol (Soporte) no permite esta acción. Requiere: Moderador o Administrador.»).
 * Non-staff users get the generic message: the admin area's role map is not theirs to see.
 */
export function forbiddenFor(user: RequestUser, required: RoleCode[]) {
  const mine = user.roles.filter((r) => STAFF.includes(r));
  if (!mine.length) return new AppError('FORBIDDEN', 'No tienes permiso para acceder a esta sección.', HttpStatus.FORBIDDEN);
  const need = [...new Set<RoleCode>(required.includes('SUPER_ADMIN') ? ['SUPER_ADMIN'] : [...required.filter((r) => r !== 'SUPER_ADMIN'), 'ADMIN'])];
  const or = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} o ${xs[xs.length - 1]}` : xs[0]);
  return new AppError(
    'FORBIDDEN',
    `Tu rol (${mine.map((r) => ROLE_NAMES[r]).join(', ')}) no permite esta acción. Requiere: ${or(need.map((r) => ROLE_NAMES[r]))}.`,
    HttpStatus.FORBIDDEN,
    { yourRoles: mine, requiredRoles: need },
  );
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const roles = this.reflector.getAllAndOverride<RoleCode[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);

    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (token) {
      try {
        req.user = await this.resolveUser(token);
      } catch (e) {
        if (!isPublic) throw e instanceof AppError ? e : new AppError('UNAUTHENTICATED', 'Tu sesión no es válida o expiró.', HttpStatus.UNAUTHORIZED);
      }
    }

    if (isPublic) return true;
    const user: RequestUser | undefined = req.user;
    if (!user) throw new AppError('UNAUTHENTICATED', 'Debes iniciar sesión.', HttpStatus.UNAUTHORIZED);
    if (user.status === 'CLOSED') throw new AppError('ACCOUNT_CLOSED', 'Esta cuenta fue eliminada.', HttpStatus.UNAUTHORIZED);
    if (['SUSPENDED', 'BLOCKED'].includes(user.status)) {
      throw new AppError('ACCOUNT_RESTRICTED', 'Tu cuenta está restringida. Contacta a soporte.', HttpStatus.FORBIDDEN);
    }
    if (roles?.length) {
      const ok =
        roles.some((r) => user.roles.includes(r)) ||
        (user.roles.includes('ADMIN') && !roles.includes('SUPER_ADMIN')) ||
        user.roles.includes('SUPER_ADMIN');
      if (!ok) throw forbiddenFor(user, roles);
    }
    return true;
  }

  private async resolveUser(token: string): Promise<RequestUser> {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${config.supabaseUrl}/auth/v1`,
      audience: 'authenticated',
    });
    const sub = String(payload.sub);
    const cached = userCache.get(sub);
    if (cached && Date.now() - cached.at < USER_CACHE_MS) return { ...cached.user, sessionId: String(payload.session_id ?? '') };

    const row = await this.db.one<{ id: string; email: string; status: string; email_verified_at: string | null }>(
      `select id, email::text as email, status, email_verified_at from public.users where id = $1`,
      [sub],
    );
    if (!row) throw new AppError('PROFILE_NOT_PROVISIONED', 'Tu cuenta aún no está activa en el marketplace.', HttpStatus.UNAUTHORIZED);
    if (!row.email_verified_at && !config.authAutoConfirm)
      throw new AppError('EMAIL_NOT_VERIFIED', 'Confirma tu correo electrónico para continuar.', HttpStatus.FORBIDDEN);
    const roles = await this.db.many<{ code: RoleCode }>(
      `select r.code from public.user_roles ur join public.roles r on r.id = ur.role_id
        where ur.user_id = $1 and ur.revoked_at is null and (ur.expires_at is null or ur.expires_at > now()) and r.is_active`,
      [sub],
    );
    const sellers = await this.db.many<{ id: string; slug: string; status: string; is_owner: boolean }>(
      `select s.id, s.slug, s.status, (s.owner_user_id = $1) as is_owner
         from public.sellers s
        where s.owner_user_id = $1
           or exists (select 1 from public.seller_members m where m.seller_id = s.id and m.user_id = $1 and m.status = 'ACTIVE')
        order by (s.owner_user_id = $1) desc, s.created_at`,
      [sub],
    );
    const user: RequestUser = {
      id: row.id,
      email: row.email,
      status: row.status,
      roles: roles.map((r) => r.code),
      sellers: sellers.map((s) => ({ id: s.id, slug: s.slug, status: s.status, isOwner: s.is_owner })),
    };
    userCache.set(sub, { at: Date.now(), user });
    // Best-effort login timestamp.
    this.db
      .exec(`update public.users set last_login_at = now() where id = $1 and (last_login_at is null or last_login_at < now() - interval '10 minutes')`, [sub])
      .catch(() => undefined);
    return { ...user, sessionId: String(payload.session_id ?? '') };
  }
}

/** Resolves the seller the current user acts for (owner or active member). */
export function requireSeller(user: RequestUser, sellerId?: string) {
  const s = sellerId ? user.sellers.find((x) => x.id === sellerId) : user.sellers[0];
  if (!s) throw new AppError('NO_SELLER', 'Aún no tienes una tienda. Crea tu tienda para continuar.', HttpStatus.FORBIDDEN);
  return s;
}
