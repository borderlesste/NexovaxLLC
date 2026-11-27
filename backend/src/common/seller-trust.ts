/**
 * Public seller trust levels. Each one states only what the platform actually checked:
 *  - registered: the store signed up (always true for a listed store; no check implied).
 *  - payoutVerified: Finance verified an active payout account of the store.
 *  - identityVerified: staff verified the store's identity with an official document or registry
 *    (Admin → Vendedores → «Verificar identidad»). Reviewing the declared tax details is NOT this.
 */
export const SELLER_TRUST_SQL = (s: string, prefix = '') => `
  (${s}.identity_verified_at is not null) as ${prefix}identity_verified,
  exists (select 1 from public.seller_payout_accounts tpa
           where tpa.seller_id = ${s}.id and tpa.status = 'ACTIVE' and tpa.verification_status = 'VERIFIED') as ${prefix}payout_verified`;

export type SellerTrust = { registered: true; payoutVerified: boolean; identityVerified: boolean };

export function sellerTrust(r: any, prefix = ''): SellerTrust {
  return { registered: true, payoutVerified: !!r[`${prefix}payout_verified`], identityVerified: !!r[`${prefix}identity_verified`] };
}
