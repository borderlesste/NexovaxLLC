import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import sharp, { OutputInfo } from 'sharp';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { AppError } from '../common/errors';
import { DbService, Queryable } from '../db/db.service';

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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

  /** Creates a Supabase Auth identity; the DB trigger provisions public.users + CUSTOMER role. */
  async createUser(email: string, password: string, fullName?: string) {
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: config.authAutoConfirm,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    });
    if (error) {
      if (/already been registered|already exists/i.test(error.message))
        throw new AppError('EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.', HttpStatus.CONFLICT);
      if (/password/i.test(error.message))
        throw new AppError('WEAK_PASSWORD', 'La contraseña no cumple los requisitos de seguridad.', HttpStatus.BAD_REQUEST);
      throw new AppError('AUTH_PROVIDER_ERROR', `No se pudo crear la cuenta: ${error.message}`, HttpStatus.BAD_GATEWAY);
    }
    return data.user!;
  }

  async updateUserPassword(userId: string, password: string) {
    const { error } = await this.admin.auth.admin.updateUserById(userId, { password });
    if (error) throw new AppError('AUTH_PROVIDER_ERROR', error.message, HttpStatus.BAD_GATEWAY);
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const row = await this.db.one<{ id: string }>(`select id from public.users where email = $1::extensions.citext`, [email]);
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
    if (!ALLOWED_IMAGE.includes(file.mimetype))
      throw new AppError('UNSUPPORTED_IMAGE', 'Formato no permitido. Usa JPG, PNG, WebP o AVIF.');
    if (file.size > MAX_IMAGE_BYTES) throw new AppError('IMAGE_TOO_LARGE', 'La imagen supera 10 MB.');
    let out: Buffer;
    let meta: OutputInfo;
    try {
      const r = await sharp(file.buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86 })
        .toBuffer({ resolveWithObject: true });
      out = r.data;
      meta = r.info;
    } catch {
      throw new AppError('INVALID_IMAGE', 'El archivo no es una imagen válida.');
    }
    const key = `${sellerId}/${folder}/${randomUUID()}.webp`;
    const { error } = await this.admin.storage.from(config.mediaBucket).upload(key, out, {
      contentType: 'image/webp',
      upsert: false,
    });
    if (error) throw new AppError('UPLOAD_FAILED', `No se pudo subir la imagen: ${error.message}`, HttpStatus.BAD_GATEWAY);
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

  async download(bucket: string, key: string): Promise<Buffer> {
    const { data, error } = await this.admin.storage.from(bucket).download(key);
    if (error || !data) throw new AppError('MEDIA_NOT_FOUND', 'Archivo no encontrado.', HttpStatus.NOT_FOUND);
    return Buffer.from(await data.arrayBuffer());
  }
}
