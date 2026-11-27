import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from './errors';

/**
 * Admission control for multipart uploads, checked before Multer buffers anything in memory:
 * the declared request size must fit a hard cap, each client may run only a couple of uploads
 * at once, and all uploads together may hold at most a fixed number of bytes in flight.
 */
const MAX_REQUEST_BYTES = 70 * 1024 * 1024;
const MAX_INFLIGHT_BYTES = 256 * 1024 * 1024;
const MAX_PER_CLIENT = 4;

let inflight = 0;
const perClient = new Map<string, number>();

@Injectable()
export class UploadBudgetGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    if (!/^multipart\//i.test(String(req.headers?.['content-type'] ?? ''))) return true;
    const size = Number(req.headers?.['content-length']);
    if (!Number.isFinite(size) || size <= 0)
      throw new AppError('LENGTH_REQUIRED', 'No se pudo leer el tamaño del archivo.', HttpStatus.LENGTH_REQUIRED);
    if (size > MAX_REQUEST_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'El archivo es demasiado grande.', HttpStatus.PAYLOAD_TOO_LARGE);
    const who = String(req.user?.id ?? req.clientIp ?? 'anon');
    const mine = perClient.get(who) ?? 0;
    if (mine >= MAX_PER_CLIENT || inflight + size > MAX_INFLIGHT_BYTES)
      throw new AppError('UPLOAD_BUSY', 'Hay demasiadas subidas en curso. Inténtalo de nuevo en unos segundos.', HttpStatus.TOO_MANY_REQUESTS);
    inflight += size;
    perClient.set(who, mine + 1);
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      inflight -= size;
      const n = (perClient.get(who) ?? 1) - 1;
      if (n > 0) perClient.set(who, n);
      else perClient.delete(who);
    };
    res.once('finish', release);
    res.once('close', release);
    return true;
  }
}
