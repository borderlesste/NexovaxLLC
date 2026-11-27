import { Controller, Get, Param, ParseUUIDPipe, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import sharp from 'sharp';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, FreshUser, isStaff, Public, RequestUser } from '../auth/auth';
import { DbService } from '../db/db.service';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { forbidden, notFound } from '../common/errors';
import { config } from '../config';

/** Widths the web can ask for (`?w=`): resized copies of public images, so a 270 px card doesn't download a 1448 px photo. */
export const MEDIA_WIDTHS = [96, 160, 320, 480, 640, 960, 1280] as const;
const RESIZABLE = /^image\/(jpeg|png|webp|avif)$/;

/** Small in-memory LRU for hot catalog images. */
class Lru {
  private map = new Map<string, { buf: Buffer; type: string }>();
  private bytes = 0;
  constructor(private readonly maxBytes: number) {}
  get(k: string) {
    const v = this.map.get(k);
    if (v) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: { buf: Buffer; type: string }) {
    this.map.set(k, v);
    this.bytes += v.buf.length;
    while (this.bytes > this.maxBytes && this.map.size) {
      const [first, val] = this.map.entries().next().value!;
      this.map.delete(first);
      this.bytes -= val.buf.length;
    }
  }
}

/** Bounded concurrency: at most `max` jobs run at once; the rest wait in line (or are refused when the line is full). */
class Gate {
  private running = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly max: number, private readonly maxQueue: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      if (this.queue.length >= this.maxQueue) throw new ServiceUnavailableException('Servidor ocupado, inténtalo de nuevo.');
      await new Promise<void>((r) => this.queue.push(r));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}

@ApiTags('media')
@Controller('media')
export class MediaController {
  private cache = new Lru(96 * 1024 * 1024);
  /** Same file or same resized copy requested by many visitors at once: one download / one resize. */
  private inflight = new Map<string, Promise<{ buf: Buffer; type: string }>>();
  private downloads = new Gate(8, 200);
  private resizes = new Gate(2, 100);

  private once(key: string, fn: () => Promise<{ buf: Buffer; type: string }>) {
    const cur = this.inflight.get(key);
    if (cur) return cur;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  constructor(
    private readonly db: DbService,
    private readonly storage: SupabaseAdminService,
  ) {}

  @Public()
  @FreshUser()
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response, @CurrentUser() user?: RequestUser, @Query('w') w?: string) {
    const asset = await this.db.one<{
      storage_bucket: string;
      storage_key: string;
      mime_type: string;
      visibility: string;
      owner_seller_id: string | null;
      status: string;
    }>(`select storage_bucket, storage_key, mime_type, visibility, owner_seller_id, status from public.assets where id = $1`, [id]);
    if (!asset || asset.status !== 'READY' || !asset.storage_bucket) throw notFound('Archivo');
    if (asset.visibility !== 'PUBLIC') {
      if (user?.status !== 'ACTIVE') throw forbidden('Archivo privado.');
      // Verification documents (ID, tax and bank papers) are for the store owner and staff only,
      // not for every team member of the store.
      const isDocument = asset.storage_bucket === config.documentsBucket;
      const owns = user.sellers.some((s) => s.id === asset.owner_seller_id && (!isDocument || s.isOwner));
      if (!owns && !isStaff(user, 'MODERATOR', 'SUPPORT')) throw forbidden('Archivo privado.');
    }
    let hit = asset.visibility === 'PUBLIC' ? this.cache.get(id) : undefined;
    if (!hit) {
      const load = () => this.downloads.run(async () => ({ buf: await this.storage.download(asset.storage_bucket, asset.storage_key), type: asset.mime_type }));
      hit = asset.visibility === 'PUBLIC' ? await this.once(id, load) : await load();
      if (asset.visibility === 'PUBLIC') this.cache.set(id, hit);
    }
    // Resized copy (public images only; unknown widths and other files are served as they are).
    const width = Number(w);
    if (asset.visibility === 'PUBLIC' && (MEDIA_WIDTHS as readonly number[]).includes(width) && RESIZABLE.test(hit.type)) {
      const key = `${id}:w${width}`;
      let small = this.cache.get(key);
      if (!small) {
        const original = hit;
        small = await this.once(key, () =>
          this.resizes.run(async () => {
            try {
              const buf = await sharp(original.buf, { failOn: 'none', pages: 1, limitInputPixels: 40_000_000 })
                .rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
              return buf.length < original.buf.length ? { buf, type: 'image/webp' } : original;
            } catch {
              return original;
            }
          }),
        );
        this.cache.set(key, small);
      }
      hit = small;
    }
    res.setHeader('Content-Type', hit.type);
    res.setHeader('Content-Length', String(hit.buf.length));
    res.setHeader(
      'Cache-Control',
      // Asset ids never change content (a new photo gets a new id), so public copies can be cached for a year.
      asset.visibility === 'PUBLIC' ? 'public, max-age=31536000, immutable' : 'private, no-store',
    );
    res.end(hit.buf);
  }
}
