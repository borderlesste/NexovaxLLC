-- Free shipping is now chosen per product (product form) instead of store-wide.
-- The store table nx_seller_free_shipping is kept read-only for history; the API no longer uses it.
create table if not exists public.nx_product_free_shipping (
  product_id uuid primary key references public.products(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete cascade,
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
create index if not exists nx_product_free_shipping_seller_idx on public.nx_product_free_shipping (seller_id) where enabled;
alter table public.nx_product_free_shipping enable row level security;
revoke all on public.nx_product_free_shipping from public, anon, authenticated;
grant select, insert, update on public.nx_product_free_shipping to nexovax_api_runtime;
drop policy if exists nx_product_free_shipping_api on public.nx_product_free_shipping;
create policy nx_product_free_shipping_api on public.nx_product_free_shipping
  to nexovax_api_runtime using (true) with check (true);

-- Keep what buyers saw: a store that offered free shipping keeps it on each of its current products.
insert into public.nx_product_free_shipping (product_id, seller_id, enabled, country_codes, minimum_subtotal, currency_code, updated_by, updated_at)
select p.id, s.seller_id, s.enabled, s.country_codes, s.minimum_subtotal, s.currency_code, s.updated_by, s.updated_at
  from public.nx_seller_free_shipping s
  join public.products p on p.seller_id = s.seller_id and p.status <> 'ARCHIVED'
 where s.enabled
on conflict (product_id) do nothing;

revoke insert, update on public.nx_seller_free_shipping from nexovax_api_runtime;
