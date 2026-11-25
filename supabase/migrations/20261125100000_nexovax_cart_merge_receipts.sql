-- NX-GEO-001 (auditoría 2026-11-23): la unión del carrito invitado con el de la cuenta es idempotente.
-- El navegador envía una clave por carrito invitado; si la respuesta se pierde y se reintenta (u otra
-- pestaña repite la unión), la API encuentra el recibo y no vuelve a sumar las cantidades.
create table if not exists public.cart_merge_receipts (
  user_id uuid not null references public.users (id) on delete cascade,
  merge_key uuid not null,
  cart_id uuid not null,
  line_count int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, merge_key)
);
create index if not exists cart_merge_receipts_created_idx on public.cart_merge_receipts (created_at);

-- Solo la API (rol de servicio) lee y escribe; ningún acceso directo desde el navegador.
alter table public.cart_merge_receipts enable row level security;
revoke all on public.cart_merge_receipts from anon, authenticated;
grant select, insert, delete on public.cart_merge_receipts to nexovax_api_runtime;
