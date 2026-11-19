-- Affiliates can be paid by more wallets: Wise, Payoneer, Zelle and Skrill.
-- Wallet details live in `bank` as {"holderName": "...", "account": "<email or phone>"}.
alter table public.nx_affiliate_payout_profiles drop constraint if exists nx_affiliate_payout_profiles_method_check;
alter table public.nx_affiliate_payout_profiles add constraint nx_affiliate_payout_profiles_method_check
  check (method in ('PAYPAL','BANK','WISE','PAYONEER','ZELLE','SKRILL'));
alter table public.nx_affiliate_payout_profiles drop constraint if exists chk_nx_affiliate_payout_method;
alter table public.nx_affiliate_payout_profiles add constraint chk_nx_affiliate_payout_method check (
  (method = 'PAYPAL' and paypal_email is not null)
  or (method = 'BANK' and bank <> '{}'::jsonb)
  or (method in ('WISE','PAYONEER','ZELLE','SKRILL') and coalesce(bank->>'account','') <> '')
);
