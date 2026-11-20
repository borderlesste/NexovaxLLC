-- Optional Stripe Tax calculation per destination country (meant for the US: address-level
-- sales tax, only in the states where the platform registered in Stripe). Off by default.
alter table public.marketplace_tax_rates
  add column if not exists calculation_provider text not null default 'RATES';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_marketplace_tax_rates_provider') then
    alter table public.marketplace_tax_rates
      add constraint chk_marketplace_tax_rates_provider check (calculation_provider in ('RATES','STRIPE_TAX'));
  end if;
end $$;

comment on column public.marketplace_tax_rates.calculation_provider is 'RATES = configured rates; STRIPE_TAX = calculated by Stripe Tax for the exact address.';

-- Paid orders taxed by Stripe Tax are recorded as Stripe tax transactions (for filing reports),
-- and completed refunds are recorded as reversals.
create table if not exists public.stripe_tax_transactions (
  order_id uuid primary key references public.orders(id) on delete restrict,
  calculation_id text not null,
  transaction_id text,
  status text not null default 'PENDING',
  attempts integer not null default 0,
  last_error text,
  reversed_refund_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_stripe_tax_transactions_status check (status in ('PENDING','RECORDED','FAILED'))
);

alter table public.stripe_tax_transactions enable row level security;
revoke all on public.stripe_tax_transactions from anon, authenticated;
