-- NX-GEO-001 phase 2: where each store (and optionally each product) ships to.
-- One row per store (product_id null) and at most one per product. No row = ships everywhere
-- the marketplace serves. Every change is kept in destination_restriction_history.
create table if not exists public.destination_restrictions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  product_id uuid references public.products (id) on delete cascade,
  -- ALL: every destination · DOMESTIC: only the ship-from country · ONLY: just the listed countries · EXCEPT: all but the listed
  mode text not null check (mode in ('ALL', 'DOMESTIC', 'ONLY', 'EXCEPT')),
  countries varchar(2)[] not null default '{}',
  note text check (note is null or length(note) <= 300),
  updated_by_user_id uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint destination_restrictions_countries_needed check (mode not in ('ONLY', 'EXCEPT') or cardinality(countries) > 0),
  constraint destination_restrictions_product_mode check (product_id is null or mode in ('ALL', 'ONLY', 'EXCEPT'))
);
create unique index if not exists destination_restrictions_store_uq on public.destination_restrictions (seller_id) where product_id is null;
create unique index if not exists destination_restrictions_product_uq on public.destination_restrictions (product_id) where product_id is not null;

create table if not exists public.destination_restriction_history (
  id uuid primary key default gen_random_uuid(),
  restriction_id uuid not null,
  seller_id uuid not null,
  product_id uuid,
  mode text not null,
  countries varchar(2)[] not null,
  note text,
  changed_by_user_id uuid,
  changed_at timestamptz not null default now()
);
create index if not exists destination_restriction_history_seller_idx on public.destination_restriction_history (seller_id, changed_at desc);

create or replace function public.log_destination_restriction() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.destination_restriction_history (restriction_id, seller_id, product_id, mode, countries, note, changed_by_user_id)
  values (new.id, new.seller_id, new.product_id, new.mode, new.countries, new.note, new.updated_by_user_id);
  return new;
end $$;
drop trigger if exists destination_restrictions_history on public.destination_restrictions;
create trigger destination_restrictions_history after insert or update on public.destination_restrictions
  for each row execute function public.log_destination_restriction();

-- Only the API touches these tables (it checks store ownership); no direct client access.
alter table public.destination_restrictions enable row level security;
alter table public.destination_restriction_history enable row level security;
revoke all on public.destination_restrictions, public.destination_restriction_history from anon, authenticated;
grant select, insert, update, delete on public.destination_restrictions to nexovax_api_runtime;
grant select on public.destination_restriction_history to nexovax_api_runtime;
revoke execute on function public.log_destination_restriction() from public, anon, authenticated;

-- Lane lookups for "Disponible": recent live quotes by store and destination country.
create index if not exists shipping_quote_requests_lane_idx
  on public.shipping_quote_requests (seller_id, ((request_snapshot -> 'destination' ->> 'country')), created_at desc);

