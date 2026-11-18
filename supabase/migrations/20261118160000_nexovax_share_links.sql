-- NEXOVAX: shared product links.
--
-- Any signed-in user can share a product with a personal link (?s=CODE). The link counts
-- visits, remembers which signed-in buyers arrived through it (30 days), and the user sees
-- in "Mi cuenta → Enlaces compartidos" which links ended in a paid sale of that product.
-- Independent of the store affiliate program (which pays commissions); no money moves here.

create table if not exists public.nx_share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{6,16}$'),
  clicks bigint not null default 0 check (clicks >= 0),
  last_click_at timestamptz,
  created_at timestamptz not null default now(),
  last_shared_at timestamptz not null default now(),
  unique (user_id, product_id)
);
create index if not exists idx_nx_share_links_product on public.nx_share_links (product_id);
alter table public.nx_share_links enable row level security;
grant select, insert, update on public.nx_share_links to nexovax_api_runtime;

create table if not exists public.nx_share_attributions (
  link_id uuid not null references public.nx_share_links(id) on delete cascade,
  customer_id uuid not null references public.users(id) on delete cascade,
  attributed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (link_id, customer_id),
  constraint chk_nx_share_attr_window check (expires_at > attributed_at)
);
create index if not exists idx_nx_share_attr_customer on public.nx_share_attributions (customer_id);
alter table public.nx_share_attributions enable row level security;
grant select, insert, update on public.nx_share_attributions to nexovax_api_runtime;
