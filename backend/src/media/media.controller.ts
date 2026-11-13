import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, isStaff, Public, RequestUser } from '../auth/auth';
import { DbService } from '../db/db.service';
import { SupabaseAdminService } from '../storage/supabase-admin.service';
import { forbidden, notFound } from '../common/errors';

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

@ApiTags('media')
@Controller('media')
export class MediaController {
  private cache = new Lru(96 * 1024 * 1024);

  constructor(
    private readonly db: DbService,
    private readonly storage: SupabaseAdminService,
  ) {}

  @Public()
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response, @CurrentUser() user?: RequestUser) {
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
      const owns = user?.sellers.some((s) => s.id === asset.owner_seller_id);
      if (!owns && !isStaff(user, 'MODERATOR', 'SUPPORT')) throw forbidden('Archivo privado.');
    }
    let hit = asset.visibility === 'PUBLIC' ? this.cache.get(id) : undefined;
    if (!hit) {
      const buf = await this.storage.download(asset.storage_bucket, asset.storage_key);
      hit = { buf, type: asset.mime_type };
      if (asset.visibility === 'PUBLIC') this.cache.set(id, hit);
    }
    res.setHeader('Content-Type', hit.type);
    res.setHeader('Content-Length', String(hit.buf.length));
    res.setHeader(
      'Cache-Control',
      asset.visibility === 'PUBLIC' ? 'public, max-age=604800, immutable' : 'private, max-age=300',
    );
    res.end(hit.buf);
  }
}
