import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { SettingsService } from '../settings/settings.service';
import type { RequestUser } from './auth';

/**
 * Maintenance mode (Configuración → Opciones → Modo mantenimiento): while it is on, only
 * administrators use the API. Runs after AuthGuard so the user is known. Always open:
 * health checks, public config (the web needs the flag), sign-in and the current user
 * (so an admin can log in), and payment/shipping webhooks (money and tracking keep flowing).
 */
const ALWAYS_OPEN = /^\/api\/(health(\/|$)|config\/public$|auth\/login$|me$|stripe\/webhook$|paypal\/webhook$|webhooks\/)/;

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest();
    if (!(await this.settings.get('features.maintenance_mode'))) return true;
    const path = String(req.path ?? req.url ?? '').split('?')[0];
    if (ALWAYS_OPEN.test(path)) return true;
    const user: RequestUser | undefined = req.user;
    if (user?.roles.includes('ADMIN') || user?.roles.includes('SUPER_ADMIN')) return true;
    throw new AppError('MAINTENANCE', 'NEXOVAX está en mantenimiento. Vuelve a intentarlo en unos minutos.', HttpStatus.SERVICE_UNAVAILABLE);
  }
}
