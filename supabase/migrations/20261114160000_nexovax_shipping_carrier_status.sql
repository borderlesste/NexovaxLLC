-- Which Shippo carrier accounts can actually issue labels. Shippo quotes carriers
-- whose registration isn't finished (DHL Express / UPS master accounts until their
-- terms are accepted) but rejects the label; those are BLOCKED and not offered.
create table if not exists public.shipping_carrier_status (
  carrier_account_id text primary key,
  carrier text not null,
  carrier_name text,
  environment text not null check (environment in ('TEST', 'LIVE')),
  status text not null default 'UNKNOWN' check (status in ('UNKNOWN', 'OK', 'BLOCKED')),
  reason text,
  checked_at timestamptz not null default now()
);
alter table public.shipping_carrier_status enable row level security;
grant select, insert, update on public.shipping_carrier_status to nexovax_api_runtime;
