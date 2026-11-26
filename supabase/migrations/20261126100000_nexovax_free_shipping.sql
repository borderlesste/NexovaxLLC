-- Seller-funded delivery applies only to explicitly selected destination countries.
create table public.nx_seller_free_shipping (
  seller_id uuid primary key references public.sellers(id) on delete cascade,
  enabled boolean not null default false,
  country_codes text[] not null default '{}',
  minimum_subtotal numeric(18,2),
  currency_code text not null references public.currencies(code),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not enabled or cardinality(country_codes) > 0),
  check (cardinality(country_codes) <= 249 and array_position(country_codes, null) is null),
  check (minimum_subtotal >= 0 and minimum_subtotal <> 'NaN'::numeric)
);
alter table public.nx_seller_free_shipping enable row level security;
revoke all on public.nx_seller_free_shipping from public, anon, authenticated;
grant select, insert, update on public.nx_seller_free_shipping to nexovax_api_runtime;
create policy nx_free_shipping_api on public.nx_seller_free_shipping
  to nexovax_api_runtime using (true) with check (true);
