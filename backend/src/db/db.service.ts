import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { config } from '../config';
import { translateDbError } from '../common/errors';

// Keep NUMERIC as string (exact money), BIGINT as string; parse INT8 counts explicitly.
types.setTypeParser(1700, (v) => v); // numeric
types.setTypeParser(20, (v) => v); // int8

export type Queryable = Pick<PoolClient, 'query'>;

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      // TLS is configured below; a `sslmode` URL parameter would override it in node-pg.
      connectionString: config.databaseUrl?.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''),
      max: Number(process.env.DB_POOL_MAX ?? 8),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      ssl: { rejectUnauthorized: false },
    });
    this.pool.on('error', (err) => this.logger.error(`pg pool error: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async many<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], client?: Queryable): Promise<T[]> {
    try {
      const res = await (client ?? this.pool).query<T>(sql, params as any[]);
      return res.rows;
    } catch (e) {
      throw translateDbError(e);
    }
  }

  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], client?: Queryable): Promise<T | null> {
    const rows = await this.many<T>(sql, params, client);
    return rows[0] ?? null;
  }

  async exec(sql: string, params: unknown[] = [], client?: Queryable): Promise<number> {
    try {
      const res = await (client ?? this.pool).query(sql, params as any[]);
      return res.rowCount ?? 0;
    } catch (e) {
      throw translateDbError(e);
    }
  }

  /** Runs `fn` inside a single transaction; rolls back on any error. */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw translateDbError(e);
    } finally {
      client.release();
    }
  }
}
