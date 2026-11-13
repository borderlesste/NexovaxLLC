import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth';
import { DbService } from './db/db.service';
import { SupabaseAdminService } from './storage/supabase-admin.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly supa: SupabaseAdminService,
  ) {}

  @Public()
  @Get()
  async health() {
    const started = Date.now();
    let database = 'down';
    try {
      await this.db.one('select 1 as ok');
      database = 'up';
    } catch {}
    return { status: database === 'up' ? 'ok' : 'degraded', database, storage: this.supa.enabled ? 'configured' : 'not_configured', latencyMs: Date.now() - started };
  }
}
