-- Customer-arranged return shipment (carrier + tracking typed by the buyer).
create table if not exists public.nx_return_request_shipping (
  return_request_id uuid primary key references public.return_requests(id) on delete restrict,
  carrier text not null check (btrim(carrier) <> '' and length(carrier) <= 80),
  tracking_number text check (tracking_number is null or tracking_number ~ '^[A-Za-z0-9 -]{4,60}$'),
  shipped_at timestamptz not null default now(),
  created_by uuid not null references public.users(id)
);
alter table public.nx_return_request_shipping enable row level security;
grant select, insert on public.nx_return_request_shipping to nexovax_api_runtime;

-- Scheduled payouts: one schedule per seller and currency.
create table if not exists public.nx_seller_payout_schedules (
  seller_id uuid not null references public.sellers(id) on delete cascade,
  currency_code varchar(3) not null references public.currencies(code),
  enabled boolean not null default true,
  frequency text not null check (frequency in ('WEEKLY', 'BIWEEKLY', 'MONTHLY')),
  weekday smallint check (weekday between 1 and 7),
  monthday smallint check (monthday between 1 and 28),
  payout_account_id uuid not null references public.seller_payout_accounts(id),
  minimum_amount numeric(20,2) not null default 0 check (minimum_amount >= 0),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  last_result text,
  last_payout_id uuid references public.payouts(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (seller_id, currency_code),
  check ((frequency in ('WEEKLY','BIWEEKLY') and weekday is not null) or (frequency = 'MONTHLY' and monthday is not null))
);
create index if not exists idx_nx_payout_schedules_due on public.nx_seller_payout_schedules (next_run_at) where enabled;
alter table public.nx_seller_payout_schedules enable row level security;
grant select, insert, update, delete on public.nx_seller_payout_schedules to nexovax_api_runtime;
