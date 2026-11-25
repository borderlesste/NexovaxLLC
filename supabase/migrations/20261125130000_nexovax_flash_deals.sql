-- Ofertas relámpago de las tiendas: cada vendedor pone un producto en oferta relámpago con su propio
-- descuento, inicio y fin. El precio rebajado es real: la API publica versiones de precio
-- (variant_price_versions) para la ventana [starts_at, ends_at) y otra con el precio normal desde ends_at,
-- así carrito, pago y catálogo cobran lo mismo que muestra la cuenta regresiva. El admin puede retirar
-- una oferta (status REMOVED, con motivo); el vendedor puede cancelarla (CANCELLED).
create table public.nx_flash_deals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  currency_code varchar(3) not null references public.currencies(code),
  discount_percent numeric(5,2) not null check (discount_percent > 0 and discount_percent < 100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED', 'REMOVED')),
  ended_at timestamptz,
  ended_by uuid references public.users(id),
  removal_reason text check (removal_reason is null or length(removal_reason) <= 500),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  constraint nx_flash_deal_window check (ends_at > starts_at),
  constraint nx_flash_deal_ended check ((status = 'ACTIVE') = (ended_at is null))
);
create index nx_flash_deals_live on public.nx_flash_deals (ends_at) where status = 'ACTIVE';
create index nx_flash_deals_product on public.nx_flash_deals (product_id, starts_at desc);
create index nx_flash_deals_seller on public.nx_flash_deals (seller_id, created_at desc);

-- Precio normal y rebajado de cada variante al crear la oferta (para restaurarlo al terminar o cancelar).
create table public.nx_flash_deal_variants (
  deal_id uuid not null references public.nx_flash_deals(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  regular_amount numeric(14,2) not null check (regular_amount > 0),
  regular_compare_at numeric(14,2),
  flash_amount numeric(14,2) not null check (flash_amount > 0 and flash_amount < regular_amount),
  primary key (deal_id, variant_id)
);
create index nx_flash_deal_variants_variant on public.nx_flash_deal_variants (variant_id);

alter table public.nx_flash_deals enable row level security;
alter table public.nx_flash_deal_variants enable row level security;
revoke all on public.nx_flash_deals, public.nx_flash_deal_variants from public, anon, authenticated;
grant select, insert, update on public.nx_flash_deals, public.nx_flash_deal_variants to nexovax_api_runtime;

-- La API activa cada minuto los precios programados que ya entraron en vigor (inicio y fin de cada oferta).
grant execute on function public.activate_due_variant_prices(integer) to nexovax_api_runtime;
