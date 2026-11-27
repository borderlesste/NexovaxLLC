-- Seller trust levels (2026-11-27). Idempotent: safe to run more than once.
--
-- The public badges now say exactly what the platform checked:
--   * Registered seller  – every active store (no check implied).
--   * Payout verified    – the store has an active payout account verified by Finance
--                          (computed from seller_payout_accounts, no column needed).
--   * Identity verified  – staff verified the store's identity with an official document or registry
--                          (Admin → Vendedores → «Verificar identidad»). Stored below.
-- sellers.verification_status (review of the declared tax details) stays internal and no longer
-- gives a public badge. No existing store starts as identity verified.

alter table public.sellers add column if not exists identity_verified_at timestamptz;
alter table public.sellers add column if not exists identity_verified_by uuid;
alter table public.sellers add column if not exists identity_verification_method text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sellers_identity_verification_method_chk') then
    alter table public.sellers add constraint sellers_identity_verification_method_chk
      check (identity_verification_method is null or identity_verification_method in ('GOVERNMENT_ID','BUSINESS_REGISTRY'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sellers_identity_verified_consistency_chk') then
    alter table public.sellers add constraint sellers_identity_verified_consistency_chk
      check ((identity_verified_at is null) = (identity_verification_method is null));
  end if;
end $$;

grant select (identity_verified_at, identity_verified_by, identity_verification_method),
      update (identity_verified_at, identity_verified_by, identity_verification_method)
  on public.sellers to nexovax_api_runtime;

-- Public listings check for a verified payout account per store.
create index if not exists idx_seller_payout_accounts_verified
  on public.seller_payout_accounts (seller_id) where status = 'ACTIVE' and verification_status = 'VERIFIED';
