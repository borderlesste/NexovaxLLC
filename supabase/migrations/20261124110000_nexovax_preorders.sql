-- Incoming stock is advertised separately from sellable inventory and checkout holds.
create table public.nx_preorder_offers (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  arrival_at timestamptz not null,
  capacity integer not null check (capacity between 1 and 1000000),
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'EXPIRED', 'IN_STOCK')),
  constraint nx_preorder_five_days check (arrival_at > created_at and arrival_at <= created_at + interval '120 hours')
);
create unique index nx_preorder_one_open on public.nx_preorder_offers (variant_id) where status = 'OPEN';
create index nx_preorder_variant_history on public.nx_preorder_offers (variant_id, created_at desc);

create table public.nx_preorder_reservations (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.nx_preorder_offers(id) on delete cascade,
  buyer_id uuid not null references public.users(id) on delete cascade,
  product_title text not null,
  product_slug text not null,
  variant_title text,
  quantity integer not null check (quantity between 1 and 1000000),
  created_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  unique (offer_id, buyer_id)
);
create index nx_preorder_buyer_history on public.nx_preorder_reservations (buyer_id, created_at desc);

alter table public.nx_preorder_offers enable row level security;
alter table public.nx_preorder_reservations enable row level security;
revoke all on public.nx_preorder_offers, public.nx_preorder_reservations from public, anon, authenticated;
grant select, insert, update on public.nx_preorder_offers, public.nx_preorder_reservations to nexovax_api_runtime;
create policy nx_preorder_api on public.nx_preorder_offers to nexovax_api_runtime using (true) with check (true);
create policy nx_preorder_api on public.nx_preorder_reservations to nexovax_api_runtime using (true) with check (true);

-- Serialize stock receipts with campaign setup and reservations, even for the very
-- first inventory row, where there would be no existing row to lock.
create function public.nx_preorder_stock_received() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.variant_id::text, 20261124));
  update public.nx_preorder_offers
     set status = case when arrival_at <= clock_timestamp() then 'EXPIRED' else 'IN_STOCK' end
   where variant_id = new.variant_id and status = 'OPEN';
  return new;
end;
$$;
revoke all on function public.nx_preorder_stock_received() from public, anon, authenticated;
create trigger nx_preorder_inventory_insert after insert on public.inventory_items
  for each row when (new.status = 'ACTIVE' and new.on_hand > 0)
  execute function public.nx_preorder_stock_received();
create trigger nx_preorder_inventory_update after update on public.inventory_items
  for each row when (new.status = 'ACTIVE' and new.on_hand > 0
    and (old.status is distinct from new.status or old.on_hand <= 0 or old.variant_id is distinct from new.variant_id))
  execute function public.nx_preorder_stock_received();

-- A draft or moderated edit may retain its offer. A withdrawal, suspension or
-- rejection ends the campaign. Republishing does not reinstate those reservations.
create function public.nx_close_hidden_preorders() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_table_name = 'product_variants' then
    update public.nx_preorder_offers o
       set status = case when o.arrival_at <= statement_timestamp() then 'EXPIRED' else 'CLOSED' end
     where o.variant_id = new.id and o.status = 'OPEN';
  elsif tg_table_name = 'products' then
    update public.nx_preorder_offers o
       set status = case when o.arrival_at <= statement_timestamp() then 'EXPIRED' else 'CLOSED' end
      from public.product_variants v where v.product_id = new.id and o.variant_id = v.id and o.status = 'OPEN';
  else
    update public.nx_preorder_offers o
       set status = case when o.arrival_at <= statement_timestamp() then 'EXPIRED' else 'CLOSED' end
      from public.product_variants v join public.products p on p.id = v.product_id
     where p.seller_id = new.id and o.variant_id = v.id and o.status = 'OPEN';
  end if;
  return new;
end;
$$;
revoke all on function public.nx_close_hidden_preorders() from public, anon, authenticated;
create trigger nx_preorder_variant_hidden after update of status on public.product_variants
  for each row when (old.status = 'ACTIVE' and new.status <> 'ACTIVE')
  execute function public.nx_close_hidden_preorders();
create trigger nx_preorder_product_hidden after update of status on public.products
  for each row when (old.status is distinct from new.status and new.status in ('PAUSED','SUSPENDED','ARCHIVED','REJECTED'))
  execute function public.nx_close_hidden_preorders();
create trigger nx_preorder_seller_hidden after update of status on public.sellers
  for each row when (old.status = 'ACTIVE' and new.status <> 'ACTIVE')
  execute function public.nx_close_hidden_preorders();
