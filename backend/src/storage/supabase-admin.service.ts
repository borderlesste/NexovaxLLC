import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { currentClientIp } from '../common/client-ip';
import sharp, { Metadata, OutputInfo, Sharp } from 'sharp';

type UploadFile = { buffer: Buffer; mimetype: string; originalname?: string; size: number };
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { AppError } from '../common/errors';
import { DbService, Queryable } from '../db/db.service';

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Decoding limits: reject decompression bombs before any pixel is decoded. */
const MAX_IMAGE_SIDE = 8000;
const MAX_IMAGE_PIXELS = 40_000_000;
const FORMAT_FOR_MIME: Record<string, string[]> = { 'image/jpeg': ['jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'image/avif': ['heif', 'avif'] };

/** Small in-process semaphore so concurrent uploads can't exhaust CPU/memory. */
const MAX_CONCURRENT_IMAGE_JOBS = 2;
let activeImageJobs = 0;
const imageQueue: Array<() => void> = [];
async function withImageSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeImageJobs >= MAX_CONCURRENT_IMAGE_JOBS) await new Promise<void>((res) => imageQueue.push(res));
  activeImageJobs++;
  try {
    return await fn();
  } finally {
    activeImageJobs--;
    imageQueue.shift()?.();
  }
}

function forwardClientIp(input: RequestInfo | URL, init?: RequestInit) {
  const client = currentClientIp();
  if (!client?.trusted) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('Sb-Forwarded-For', client.ip);
  return fetch(input, { ...init, headers });
}

/**
 * Server-only Supabase client using the project secret key.
 * Used for: admin user provisioning and private Storage objects.
 */
@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  private client?: SupabaseClient;

  constructor(private readonly db: DbService) {
    if (config.supabaseSecretKey) {
      this.client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        // Supabase Auth applies its rate limits to the end user's IP (Sb-Forwarded-For) instead of the
        // API's when "IP address forwarding" is enabled in Auth settings. Only real visitor IPs are sent.
        global: { fetch: forwardClientIp },
      });
    } else {
      this.logger.warn('SUPABASE_SECRET_KEY not configured: user provisioning and uploads are disabled.');
    }
  }

  get enabled() {
    return !!this.client;
  }

  private get admin(): SupabaseClient {
    if (!this.client)
      throw new AppError(
        'SERVICE_NOT_CONFIGURED',
        'El servicio de cuentas y archivos no está configurado (falta la clave secreta de Supabase).',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    return this.client;
  }

  /**
   * Password sign-in on behalf of the browser, so the visitor talks only to our domain.
   * Uses a publishable-key client (no admin bypass): Supabase still applies CAPTCHA, rate limits
   * (per visitor IP via Sb-Forwarded-For) and e-mail confirmation. Returns the session tokens.
   */
  async signInWithPassword(email: string, password: string, captchaToken?: string | null) {
    if (!config.supabaseUrl || !config.supabasePublishableKey)
      throw new AppError('SERVICE_NOT_CONFIGURED', 'El inicio de sesión no está configurado.', HttpStatus.SERVICE_UNAVAILABLE);
    const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: forwardClientIp },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined });
    if (error || !data.session) {
      const code = (error as { code?: string } | null)?.code ?? '';
      const msg = error?.message ?? '';
      if (code === 'invalid_credentials' || /invalid login/i.test(msg))
        throw new AppError('INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.', HttpStatus.UNAUTHORIZED);
      if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg))
        throw new AppError('EMAIL_NOT_CONFIRMED', 'Debes confirmar tu correo antes de iniciar sesión.', HttpStatus.FORBIDDEN);
      if (code === 'captcha_failed' || /captcha/i.test(msg))
        throw new AppError('CAPTCHA_FAILED', 'No pudimos verificar que eres una persona. Completa la verificación e inténtalo de nuevo.', HttpStatus.BAD_REQUEST);
      if (error?.status === 429 || /rate limit/i.test(msg))
        throw new AppError('TOO_MANY_ATTEMPTS', 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.', HttpStatus.TOO_MANY_REQUESTS);
      this.logger.warn(`sign-in failed: ${code || msg}`);
      throw new AppError('AUTH_PROVIDER_ERROR', 'No se pudo iniciar sesión. Inténtalo de nuevo.', HttpStatus.BAD_GATEWAY);
    }
    const { access_token, refresh_token, expires_in, expires_at, token_type } = data.session;
    return { access_token, refresh_token, expires_in, expires_at, token_type };
  }

  /** Creates a Supabase Auth identity; the DB trigger provisions public.users + CUSTOMER role. */
  /** Status page: lists one object of the avatars bucket (proves credentials and storage answer). */
  async ping() {
    const { error } = await this.admin.storage.from(config.avatarBucket).list('', { limit: 1 });
    if (error) throw new Error(error.message);
  }

  async createUser(email: string, password: string, fullName?: string, opts: { confirmed?: boolean } = {}) {
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: opts.confirmed ?? config.authAutoConfirm,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    });
    if (error) {
      if (/already been registered|already exists/i.test(error.message))
        throw new AppError('EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.', HttpStatus.CONFLICT);
      if (/password/i.test(error.message))
        throw new AppError('WEAK_PASSWORD', 'La contraseña no cumple los requisitos de seguridad.', HttpStatus.BAD_REQUEST);
      this.logger.warn(`createUser failed: ${error.message}`);
      throw new AppError('AUTH_PROVIDER_ERROR', 'No se pudo crear la cuenta. Inténtalo de nuevo.', HttpStatus.BAD_GATEWAY);
    }
    return data.user!;
  }

  async updateUserPassword(userId: string, password: string) {
    const { error } = await this.admin.auth.admin.updateUserById(userId, { password });
    if (error && /password/i.test(error.message))
      throw new AppError('WEAK_PASSWORD', 'La contraseña no cumple los requisitos de seguridad.', HttpStatus.BAD_REQUEST);
    if (error) {
      this.logger.warn(`updateUserPassword failed: ${error.message}`);
      throw new AppError('AUTH_PROVIDER_ERROR', 'No se pudo actualizar la contraseña. Inténtalo de nuevo.', HttpStatus.BAD_GATEWAY);
    }
  }

  /** One-time recovery token (hashed) for a password-reset link we e-mail ourselves. */
  async recoveryTokenHash(email: string): Promise<string | null> {
    const { data, error } = await this.admin.auth.admin.generateLink({ type: 'recovery', email });
    if (error) {
      this.logger.warn(`generateLink(recovery) failed: ${error.message}`);
      return null;
    }
    return data.properties?.hashed_token ?? null;
  }

  /**
   * One-time e-mail token (hashed) used to verify a not-yet-confirmed address.
   * Verifying it (`verifyOtp({ token_hash, type: 'email' })`) confirms the account.
   */
  async emailVerificationTokenHash(email: string): Promise<string | null> {
    const { data, error } = await this.admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error) {
      this.logger.warn(`generateLink(magiclink) failed: ${error.message}`);
      return null;
    }
    return data.properties?.hashed_token ?? null;
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const row = await this.db.one<{ id: string }>(`select id from public.users where lower(email::text) = lower($1)`, [email]);
    return row?.id ?? null;
  }

  /**
   * Normalizes an uploaded image (auto-rotate, max 1600px, WebP) and stores it
   * in the private product-media bucket under the seller's prefix, registering
   * it in public.assets. Returns the asset id.
   */
  async uploadSellerImage(
    sellerId: string,
    userId: string,
    file: { buffer: Buffer; mimetype: string; originalname?: string; size: number },
    folder: string,
    visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC',
    client?: Queryable,
  ): Promise<string> {
    const { out, meta } = await this.processImage(file, (img) => img.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }));
    const key = `${sellerId}/${folder}/${randomUUID()}.webp`;
    const { error } = await this.admin.storage.from(config.mediaBucket).upload(key, out, {
      contentType: 'image/webp',
      upsert: false,
    });
    if (error) {
      this.logger.warn(`image upload failed: ${error.message}`);
      throw new AppError('UPLOAD_FAILED', 'No se pudo subir la imagen. Inténtalo de nuevo.', HttpStatus.BAD_GATEWAY);
    }
    const row = await this.db.one<{ id: string }>(
      `insert into public.assets (uploaded_by_user_id, owner_seller_id, storage_provider, storage_bucket, storage_key,
                                  original_filename, mime_type, size_bytes, width_pixels, height_pixels, visibility,
                                  status, uploaded_at, ready_at)
       values ($1,$2,'SUPABASE',$3,$4,$5,'image/webp',$6,$7,$8,$9,'READY',now(),now())
       returning id`,
      [userId, sellerId, config.mediaBucket, key, file.originalname?.slice(0, 200) ?? null, out.length, meta.width, meta.height, visibility],
      client,
    );
    return row!.id;
  }

  /**
   * Marketplace share image (Open Graph / X card): 1200×630 JPEG, the format every
   * social network previews, public in the media bucket. Returns the asset id.
   */
  async uploadPlatformImage(userId: string, file: UploadFile): Promise<string> {
    const { out, meta } = await this.processImage(file, (img) => img.resize({ width: 1200, height: 630, fit: 'cover', position: 'attention' }), 'jpeg');
    const key = `platform/seo/${randomUUID()}.jpg`;
    const { error } = await this.admin.storage.from(config.mediaBucket).upload(key, out, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      this.logger.warn(`image upload failed: ${error.message}`);
      throw new AppError('UPLOAD_FAILED', 'No se pudo subir la imagen. Inténtalo de nuevo.', HttpStatus.BAD_GATEWAY);
    }
    const row = await this.db.one<{ id: string }>(
      `insert into public.assets (uploaded_by_user_id, owner_seller_id, storage_provider, storage_bucket, storage_key,
                                  original_filename, mime_type, size_bytes, width_pixels, height_pixels, visibility,
                                  status, uploaded_at, ready_at)
       values ($1,null,'SUPABASE',$2,$3,$4,'image/jpeg',$5,$6,$7,'PUBLIC','READY',now(),now()) returning id`,
      [userId, config.mediaBucket, key, file.originalname?.slice(0, 200) ?? null, out.length, meta.width, meta.height],
    );
    return row!.id;
  }

  /**
   * Validates an uploaded image (declared and real format, size, dimensions, no
   * animation) from its header before decoding, then re-encodes it to WebP.
   */
  private async processImage(file: UploadFile, transform: (img: Sharp) => Sharp, format: 'webp' | 'jpeg' = 'webp'): Promise<{ out: Buffer; meta: OutputInfo }> {
    if (!ALLOWED_IMAGE.includes(file.mimetype))
      throw new AppError('UNSUPPORTED_IMAGE', 'Formato no permitido. Usa JPG, PNG, WebP o AVIF.');
    if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) throw new AppError('IMAGE_TOO_LARGE', 'La imagen supera 8 MB.');
    // Header-only inspection first (no pixel decoding): real format, dimensions, frames.
    let head: Metadata;
    try {
      head = await sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    } catch (e: any) {
      if (/pixel limit/i.test(e?.message ?? '')) throw new AppError('IMAGE_DIMENSIONS', `La imagen es demasiado grande (máximo ${MAX_IMAGE_SIDE} px por lado).`);
      throw new AppError('INVALID_IMAGE', 'El archivo no es una imagen válida.');
    }
    if (!head.format || !FORMAT_FOR_MIME[file.mimetype]?.includes(head.format))
      throw new AppError('UNSUPPORTED_IMAGE', 'Formato no permitido. Usa JPG, PNG, WebP o AVIF.');
    const w = head.width ?? 0;
    const h = head.height ?? 0;
    if (!w || !h || w > MAX_IMAGE_SIDE || h > MAX_IMAGE_SIDE || w * h > MAX_IMAGE_PIXELS)
      throw new AppError('IMAGE_DIMENSIONS', `La imagen es demasiado grande (máximo ${MAX_IMAGE_SIDE} px por lado).`);
    if ((head.pages ?? 1) > 1) throw new AppError('IMAGE_ANIMATED', 'No se permiten imágenes animadas ni de varias páginas.');
    let out: Buffer;
    let meta: OutputInfo;
    try {
      const r = await withImageSlot(() =>
        (format === 'jpeg'
          ? transform(sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error', pages: 1 }).rotate()).flatten({ background: '#ffffff' }).jpeg({ quality: 86, mozjpeg: true })
          : transform(sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error', pages: 1 }).rotate()).webp({ quality: 86 })
        ).toBuffer({ resolveWithObject: true }),
      );
      out = r.data;
      meta = r.info;
    } catch {
      throw new AppError('INVALID_IMAGE', 'El archivo no es una imagen válida.');
    }
    return { out, meta };
  }

  /**
   * Profile photo: square 512×512 WebP in the private avatars bucket (served by
   * /api/media/:id). Replaces and deletes the previous photo.
   */
  async setUserAvatar(userId: string, file: UploadFile): Promise<string> {
    const { out, meta } = await this.processImage(file, (img) => img.resize({ width: 512, height: 512, fit: 'cover', position: 'attention' }));
    const key = `${userId}/avatar/${randomUUID()}.webp`;
    const { error } = await this.admin.storage.from(config.avatarBucket).upload(key, out, { contentType: 'image/webp', upsert: false });
    if (error) {
      this.logger.warn(`image upload failed: ${error.message}`);
      throw new AppError('UPLOAD_FAILED', 'No se pudo subir la imagen. Inténtalo de nuevo.', HttpStatus.BAD_GATEWAY);
    }
    let previous: { id: string; storage_key: string } | null = null;
    try {
      previous = await this.db.tx(async (c) => {
        const old = await this.db.one<{ id: string; storage_key: string }>(
          `select a.id, a.storage_key from public.user_profiles up join public.assets a on a.id = up.avatar_asset_id
            where up.user_id = $1 and a.storage_bucket = $2 for update of up`,
          [userId, config.avatarBucket],
          c,
        );
        const row = await this.db.one<{ id: string }>(
          `insert into public.assets (uploaded_by_user_id, owner_seller_id, storage_provider, storage_bucket, storage_key,
                                      original_filename, mime_type, size_bytes, width_pixels, height_pixels, visibility,
                                      status, uploaded_at, ready_at)
           values ($1,null,'SUPABASE',$2,$3,$4,'image/webp',$5,$6,$7,'PUBLIC','READY',now(),now()) returning id`,
          [userId, config.avatarBucket, key, file.originalname?.slice(0, 200) ?? null, out.length, meta.width, meta.height],
          c,
        );
        await this.db.exec(
          `insert into public.user_profiles (user_id, avatar_asset_id) values ($1, $2)
           on conflict (user_id) do update set avatar_asset_id = excluded.avatar_asset_id`,
          [userId, row!.id],
          c,
        );
        if (old) await this.db.exec(`update public.assets set status = 'DELETED', deleted_at = now() where id = $1`, [old.id], c);
        return old;
      });
    } catch (e) {
      await this.admin.storage.from(config.avatarBucket).remove([key]).catch(() => undefined);
      throw e;
    }
    if (previous) await this.admin.storage.from(config.avatarBucket).remove([previous.storage_key]).catch((e) => this.logger.warn(`avatar cleanup: ${e?.message}`));
    return key;
  }

  /** Removes the profile photo (falls back to the initials avatar). */
  async removeUserAvatar(userId: string) {
    const old = await this.db.tx(async (c) => {
      const a = await this.db.one<{ id: string; storage_key: string; storage_bucket: string }>(
        `select a.id, a.storage_key, a.storage_bucket from public.user_profiles up join public.assets a on a.id = up.avatar_asset_id
          where up.user_id = $1 for update of up`,
        [userId],
        c,
      );
      await this.db.exec(`update public.user_profiles set avatar_asset_id = null where user_id = $1`, [userId], c);
      if (a?.storage_bucket === config.avatarBucket) await this.db.exec(`update public.assets set status = 'DELETED', deleted_at = now() where id = $1`, [a.id], c);
      return a;
    });
    if (old?.storage_bucket === config.avatarBucket) await this.admin.storage.from(config.avatarBucket).remove([old.storage_key]).catch(() => undefined);
  }

  /**
   * Message / report / return evidence: photos (re-encoded to WebP, metadata stripped)
   * or PDF documents (real header checked, active content refused). Private bucket,
   * served only through the conversation or return it belongs to.
   */
  async uploadAttachment(userId: string, file: UploadFile, client?: Queryable): Promise<{ id: string; kind: 'IMAGE' | 'DOCUMENT'; name: string; size: number; mime: string }> {
    const name = (file.originalname ?? 'archivo').normalize('NFC').replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || 'archivo';
    let body: Buffer;
    let mime: string;
    let kind: 'IMAGE' | 'DOCUMENT';
    let meta: { width?: number; height?: number } = {};
    if (file.mimetype === 'application/pdf') {
      if (file.size > MAX_ATTACHMENT_BYTES || file.buffer.length > MAX_ATTACHMENT_BYTES) throw new AppError('ATTACHMENT_TOO_LARGE', 'El documento supera 10 MB.');
      if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError('INVALID_ATTACHMENT', 'El archivo no es un PDF válido.');
      if (/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(file.buffer.toString('latin1')))
        throw new AppError('INVALID_ATTACHMENT', 'El PDF contiene contenido activo (scripts o archivos incrustados) y no se puede adjuntar.');
      body = file.buffer;
      mime = 'application/pdf';
      kind = 'DOCUMENT';
    } else if (ALLOWED_IMAGE.includes(file.mimetype)) {
      const r = await this.processImage(file, (img) => img.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }));
      body = r.out;
      meta = { width: r.meta.width, height: r.meta.height };
      mime = 'image/webp';
      kind = 'IMAGE';
    } else throw new AppError('UNSUPPORTED_ATTACHMENT', 'Formato no permitido. Adjunta fotos (JPG, PNG, WebP) o documentos PDF.');
    const key = `${userId}/attachments/${randomUUID()}.${kind === 'IMAGE' ? 'webp' : 'pdf'}`;
    const { error } = await this.admin.storage.from(config.attachmentBucket).upload(key, body, { contentType: mime, upsert: false });
    if (error) {
      this.logger.warn(`file upload failed: ${error.message}`);
      throw new AppError('UPLOAD_FAILED', 'No se pudo subir el archivo. Inténtalo de nuevo.', HttpStatus.BAD_GATEWAY);
    }
    try {
      const row = await this.db.one<{ id: string }>(
        `insert into public.assets (uploaded_by_user_id, owner_seller_id, storage_provider, storage_bucket, storage_key,
                                    original_filename, mime_type, size_bytes, width_pixels, height_pixels, visibility, status, uploaded_at, ready_at)
         values ($1,null,'SUPABASE',$2,$3,$4,$5,$6,$7,$8,'PRIVATE','READY',now(),now()) returning id`,
        [userId, config.attachmentBucket, key, name, mime, body.length, meta.width ?? null, meta.height ?? null],
        client,
      );
      return { id: row!.id, kind, name, size: body.length, mime };
    } catch (e) {
      await this.admin.storage.from(config.attachmentBucket).remove([key]).catch(() => undefined);
      throw e;
    }
  }

  /** Removes stored objects (best effort; missing objects are ignored). */
  async removeObjects(bucket: string, keys: string[]) {
    for (let i = 0; i < keys.length; i += 100) {
      const { error } = await this.admin.storage.from(bucket).remove(keys.slice(i, i + 100));
      if (error) this.logger.warn(`remove ${bucket}: ${error.message}`);
    }
  }

  async download(bucket: string, key: string): Promise<Buffer> {
    const { data, error } = await this.admin.storage.from(bucket).download(key);
    if (error || !data) throw new AppError('MEDIA_NOT_FOUND', 'Archivo no encontrado.', HttpStatus.NOT_FOUND);
    return Buffer.from(await data.arrayBuffer());
  }
}
