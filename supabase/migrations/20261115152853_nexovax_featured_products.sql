create table if not exists public.nx_featured_products (
  product_id uuid primary key references public.products(id) on delete cascade,
  sort_order integer not null default 0,
  featured_by uuid references public.users(id) on delete set null,
  featured_at timestamptz not null default now()
);
alter table public.nx_featured_products enable row level security;
grant select, insert, update, delete on public.nx_featured_products to nexovax_api_runtime;
