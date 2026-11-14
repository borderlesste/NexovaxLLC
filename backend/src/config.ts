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
  supabaseUrl: secret('SUPABASE_URL', 'supabase_url') ?? '',
  supabasePublishableKey: secret('SUPABASE_PUBLISHABLE_KEY', 'supabase_publishable_key') ?? '',
  supabaseSecretKey: secret('SUPABASE_SECRET_KEY', 'supabase_secret_key'),
  /** AES-256-GCM key (base64, 32 bytes) for payout destination details. */
  dataEncryptionKey: secret('DATA_ENCRYPTION_KEY', 'data_encryption_key'),
  /**
   * When true, self-registered accounts skip e-mail verification. Off by default:
   * new customers confirm ownership of their address through a link we e-mail (Resend).
   */
  authAutoConfirm: process.env.AUTH_AUTO_CONFIRM === 'true' && process.env.NODE_ENV !== 'production',
  paymentEnvironment: (process.env.PAYMENT_ENVIRONMENT ?? 'TEST') as 'TEST' | 'LIVE',
  /**
   * Simulated card captures (no processor) for local development without Stripe.
   * Opt-in only, and never honoured in production or with LIVE payments.
   */
  paymentSandboxEnabled:
    process.env.PAYMENT_SANDBOX_ENABLED === 'true' && process.env.NODE_ENV !== 'production' && (process.env.PAYMENT_ENVIRONMENT ?? 'TEST') !== 'LIVE',
  mediaBucket: 'rd-product-images',
  documentsBucket: 'rd-seller-documents',
  avatarBucket: 'nx-user-avatars',
  attachmentBucket: 'nx-message-attachments',
  publicApiUrl: process.env.PUBLIC_API_URL ?? 'http://localhost:4000/api',
  /** Public storefront URL used to build links inside e-mails. */
  webUrl: (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  /** Shippo (multi-carrier rates, labels and tracking). Without a key only marketplace flat rates are offered. */
  shippoApiKey: secret('SHIPPO_API_KEY', 'shippo_api_key'),
  /** Shared secret expected as `?token=` on the Shippo webhook URL. */
  shippoWebhookToken: process.env.SHIPPO_WEBHOOK_TOKEN || secret('SHIPPO_WEBHOOK_TOKEN', 'shippo_webhook_token'),
  /** Label format bought from Shippo (PDF, PDF_4x6, PNG, ZPLII). */
  shippoLabelFormat: process.env.SHIPPO_LABEL_FORMAT ?? 'PDF_4x6',
  /** Stripe (cards). Keys come from .secrets/stripe_*; webhook secrets may list several (one per line). */
  stripeSecretKey: secret('STRIPE_SECRET_KEY', 'stripe_secret_key'),
  /** Read on demand so the key can be added without restarting the API. */
  get stripePublishableKey() {
    return secret('STRIPE_PUBLISHABLE_KEY', 'stripe_publishable_key');
  },
  stripeWebhookSecrets: (secret('STRIPE_WEBHOOK_SECRET', 'stripe_webhook_secret') ?? '').split(/[\s,]+/).filter(Boolean),
  /** PayPal (Orders v2). PAYPAL_ENV: sandbox | live. */
  get paypalClientId() {
    return secret('PAYPAL_CLIENT_ID', 'paypal_client_id');
  },
  get paypalClientSecret() {
    return secret('PAYPAL_CLIENT_SECRET', 'paypal_client_secret');
  },
  get paypalWebhookId() {
    return secret('PAYPAL_WEBHOOK_ID', 'paypal_webhook_id');
  },
  paypalEnv: (process.env.PAYPAL_ENV ?? 'sandbox') as 'sandbox' | 'live',
  /** Transactional e-mail (Resend). Without a key, e-mails are skipped and logged. */
  resendApiKey: secret('RESEND_API_KEY', 'resend_api_key'),
  mailFrom: process.env.MAIL_FROM ?? 'NEXOVAX <no-reply@nexovax.com>',
  mailReplyTo: process.env.MAIL_REPLY_TO || undefined,
  /** Development/QA: deliver every e-mail to this address instead of the real recipient. */
  mailRedirectTo: process.env.MAIL_REDIRECT_TO?.trim() || undefined,
  /** Recipient domains that never receive e-mail (demo/seed accounts), to protect sender reputation. */
  mailSuppressDomains: (process.env.MAIL_SUPPRESS_DOMAINS ?? 'rdmarketplace.do,demo.nexovax.com,example.com,example.org,test.local')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
};

export function assertConfig() {
  const missing: string[] = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL (.secrets/database_url)');
  if (!config.supabaseUrl) missing.push('SUPABASE_URL (.secrets/supabase_url)');
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
}
