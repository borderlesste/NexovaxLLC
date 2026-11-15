-- NEXOVAX: coupon offers to interested buyers (phase 4).
--
-- A store sends one of its coupons to the people who have a product in their favorites
-- and/or cart. The store only sees how many people it reaches and how many used the
-- coupon; recipients are known to the platform only (frequency caps and results).

update public.notification_categories
   set description = 'Vuelta a stock, bajadas de precio y ofertas de tus favoritos y tu carrito.'
 where code = 'PRODUCT_ALERTS';

create table if not exists public.nx_offer_campaigns (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  promotion_code_id uuid not null references public.promotion_codes(id) on delete cascade,
  audience text not null check (audience in ('FAVORITES','CART','BOTH')),
  message text check (message is null or (btrim(message) <> '' and length(message) <= 280)),
  recipients integer not null default 0 check (recipients >= 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_nx_offer_campaigns_seller on public.nx_offer_campaigns (seller_id, created_at desc);
create index if not exists idx_nx_offer_campaigns_product on public.nx_offer_campaigns (product_id, created_at desc);
alter table public.nx_offer_campaigns enable row level security;
grant select, insert, update on public.nx_offer_campaigns to nexovax_api_runtime;

create table if not exists public.nx_offer_recipients (
  campaign_id uuid not null references public.nx_offer_campaigns(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
create index if not exists idx_nx_offer_recipients_user on public.nx_offer_recipients (user_id, sent_at desc);
alter table public.nx_offer_recipients enable row level security;
grant select, insert on public.nx_offer_recipients to nexovax_api_runtime;
