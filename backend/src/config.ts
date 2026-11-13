import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runtime configuration. Secrets are read from environment variables, or from
 * the local secret store (`.secrets/` at the repository root) during
 * development. Secrets never live in source control.
 */
function secret(envName: string, file: string): string | undefined {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const candidates = [resolve(process.cwd(), '.secrets', file), resolve(process.cwd(), '..', '.secrets', file)];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  }
  return undefined;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  databaseUrl: secret('DATABASE_URL', 'database_url'),
  supabaseUrl: process.env.SUPABASE_URL ?? 'https://oncwajkjomplextntpye.supabase.co',
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_Ul_2a_610N97ximhM-jjkg_NCAU5Ojd',
  supabaseSecretKey: secret('SUPABASE_SECRET_KEY', 'supabase_secret_key'),
  /** AES-256-GCM key (base64, 32 bytes) for payout destination details. */
  dataEncryptionKey: secret('DATA_ENCRYPTION_KEY', 'data_encryption_key'),
  /**
   * When true, accounts created through the API are confirmed immediately.
   * Required while the project has no transactional SMTP provider configured
   * (Supabase's default SMTP only delivers to project team members).
   */
  authAutoConfirm: (process.env.AUTH_AUTO_CONFIRM ?? 'true') === 'true',
  paymentEnvironment: (process.env.PAYMENT_ENVIRONMENT ?? 'TEST') as 'TEST' | 'LIVE',
  mediaBucket: 'rd-product-images',
  documentsBucket: 'rd-seller-documents',
  publicApiUrl: process.env.PUBLIC_API_URL ?? 'http://localhost:4000/api',
};

export function assertConfig() {
  const missing: string[] = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL (.secrets/database_url)');
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
}
