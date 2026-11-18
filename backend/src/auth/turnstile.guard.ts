import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { AppError } from '../common/errors';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Header the web sends with the widget token (one token per request; Cloudflare rejects reuse). */
export const TURNSTILE_HEADER = 'cf-turnstile-response';

/**
 * Cloudflare Turnstile check for public endpoints that create accounts or send e-mail
 * (register, password recovery, resend verification). These run with the Supabase admin key,
 * which bypasses Supabase's own CAPTCHA, so the API verifies the token itself.
 */
@Injectable()
export class TurnstileGuard implements CanActivate {
  private readonly logger = new Logger(TurnstileGuard.name);
  private warned = false;

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const secret = config.turnstileSecretKey;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('TURNSTILE_SECRET_KEY is not configured: refusing protected endpoint');
        throw new AppError('CAPTCHA_UNAVAILABLE', 'La verificación de seguridad no está disponible. Inténtalo más tarde.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (!this.warned) {
        this.warned = true;
        this.logger.warn('TURNSTILE_SECRET_KEY is not configured: Turnstile check skipped (development only)');
      }
      return true;
    }
    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers[TURNSTILE_HEADER];
    const token = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!token || token.length > 2048) throw invalid();

    let outcome: { success?: boolean; 'error-codes'?: string[] } = {};
    try {
      const res = await fetch(SITEVERIFY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, response: token }),
        signal: AbortSignal.timeout(8000),
      });
      outcome = await res.json();
    } catch (e: any) {
      this.logger.error(`Turnstile siteverify failed: ${e?.message ?? e}`);
      throw new AppError('CAPTCHA_UNAVAILABLE', 'La verificación de seguridad no está disponible. Inténtalo más tarde.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (!outcome.success) {
      this.logger.warn(`Turnstile rejected: ${(outcome['error-codes'] ?? []).join(',') || 'unknown'}`);
      throw invalid();
    }
    return true;
  }
}

const invalid = () =>
  new AppError('CAPTCHA_FAILED', 'No pudimos verificar que eres una persona. Completa la verificación e inténtalo de nuevo.', HttpStatus.BAD_REQUEST);
