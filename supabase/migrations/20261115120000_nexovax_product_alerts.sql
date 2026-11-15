-- NEXOVAX: product alerts for buyers (phase 2).
--
-- * Back in stock: the buyer asks to be told when an out-of-stock product (or variant)
--   is available again.
-- * Price drop: products in the buyer's favorites or cart are watched automatically;
--   when the price goes down the buyer is told (at most once a week per product).
-- Both respect the new "Avisos de productos" notification category.

insert into public.notification_categories (code, name, description, user_configurable)
values ('PRODUCT_ALERTS', 'Avisos de productos', 'Vuelta a stock y bajadas de precio de tus favoritos y tu carrito.', true)
on conflict (code) do nothing;

create table if not exists public.nx_product_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  kind text not null default 'BACK_IN_STOCK' check (kind in ('BACK_IN_STOCK')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SENT','CANCELLED')),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  constraint chk_nx_product_alerts_sent check (status <> 'SENT' or notified_at is not null)
);
create unique index if not exists uq_nx_product_alerts_active
  on public.nx_product_alerts (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'ACTIVE';
create index if not exists idx_nx_product_alerts_product on public.nx_product_alerts (product_id) where status = 'ACTIVE';
alter table public.nx_product_alerts enable row level security;
grant select, insert, update on public.nx_product_alerts to nexovax_api_runtime;

create table if not exists public.nx_price_watches (
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  reference_price numeric(20,8) not null check (reference_price >= 0),
  source text not null check (source in ('FAVORITE','CART')),
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists idx_nx_price_watches_product on public.nx_price_watches (product_id);
alter table public.nx_price_watches enable row level security;
grant select, insert, update, delete on public.nx_price_watches to nexovax_api_runtime;
