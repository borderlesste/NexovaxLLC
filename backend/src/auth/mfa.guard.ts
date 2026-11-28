import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/errors';
import { SettingsService } from '../settings/settings.service';
import { REQUIRE_MFA, ROLES, type RequestUser, type RoleCode } from './auth';

const STAFF: RoleCode[] = ['SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

/**
 * Two-step verification (Supabase MFA, authenticator app). Runs after AuthGuard:
 * - staff routes (@Roles) need an aal2 session when «Verificación en dos pasos para el equipo» is on;
 * - store money routes (@RequireMfa) need it when «… para retiros de vendedores» is on.
 * Enrolling a factor happens in the browser with Supabase, so nobody can be locked out by this guard.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const user: RequestUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || user.aal === 'aal2') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const roles = this.reflector.getAllAndOverride<RoleCode[]>(ROLES, targets);
    const staffRoute = !!roles?.length && user.roles.some((r) => STAFF.includes(r));
    const moneyRoute = this.reflector.getAllAndOverride<boolean>(REQUIRE_MFA, targets) === true;
    if (!staffRoute && !moneyRoute) return true;
    const required =
      (staffRoute && (await this.settings.get('features.mfa_staff_required')) !== false) ||
      (moneyRoute && (await this.settings.get('features.mfa_seller_payouts_required')) !== false);
    if (!required) return true;
    throw new AppError(
      'MFA_REQUIRED',
      staffRoute
        ? 'El panel del equipo requiere la verificación en dos pasos. Actívala o escribe el código de tu app de autenticación.'
        : 'Para gestionar cobros y retiros necesitas la verificación en dos pasos. Actívala o escribe el código de tu app de autenticación.',
      HttpStatus.FORBIDDEN,
    );
  }
}
