-- NEXOVAX: product engagement analytics (phase 1).
--
-- Raw events (views, add to cart, favorites) feed per-product daily totals. Sellers only
-- ever see aggregates. Identity (user / anonymous visitor id) is stored only with the
-- visitor's analytics consent; without it the event is anonymous. Raw events are kept
-- 90 days; the daily totals stay.

create table if not exists public.nx_product_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event_type text not null check (event_type in ('VIEW','ADD_TO_CART','FAVORITE','UNFAVORITE')),
  product_id uuid not null references public.products(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  visitor_id uuid,
  consented boolean not null default false,
  dwell_ms integer check (dwell_ms is null or dwell_ms between 0 and 3600000),
  source text check (source is null or source in ('DIRECT','SEARCH','CATALOG','STORE','HOME','PRODUCT','EXTERNAL','AFFILIATE')),
  constraint chk_nx_product_events_consent check (consented or (user_id is null and visitor_id is null))
);
create index if not exists idx_nx_product_events_seller_time on public.nx_product_events (seller_id, occurred_at desc);
create index if not exists idx_nx_product_events_product_time on public.nx_product_events (product_id, occurred_at desc);
create index if not exists idx_nx_product_events_visitor on public.nx_product_events (visitor_id, product_id, occurred_at desc) where visitor_id is not null;
create index if not exists idx_nx_product_events_user on public.nx_product_events (user_id) where user_id is not null;
alter table public.nx_product_events enable row level security;
grant select, insert, update, delete on public.nx_product_events to nexovax_api_runtime;

create table if not exists public.nx_product_daily_stats (
  product_id uuid not null references public.products(id) on delete cascade,
  day date not null,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  views integer not null default 0,
  unique_visitors integer not null default 0,
  add_to_cart integer not null default 0,
  favorites integer not null default 0,
  unfavorites integer not null default 0,
  dwell_ms_total bigint not null default 0,
  dwell_samples integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (product_id, day)
);
create index if not exists idx_nx_product_daily_stats_seller on public.nx_product_daily_stats (seller_id, day desc);
alter table public.nx_product_daily_stats enable row level security;
grant select, insert, update on public.nx_product_daily_stats to nexovax_api_runtime;

-- Rebuilds the daily totals of [p_from, p_to] from the raw events (idempotent).
-- Unique visitors: distinct consented identities + anonymous views (the browser already
-- de-duplicates anonymous views per session).
create or replace function public.nx_aggregate_product_events(p_from date, p_to date)
returns integer language plpgsql set search_path = pg_catalog, public as $function$
declare n integer;
begin
  insert into public.nx_product_daily_stats as d (product_id, day, seller_id, views, unique_visitors, add_to_cart, favorites, unfavorites, dwell_ms_total, dwell_samples, updated_at)
  select e.product_id, (e.occurred_at at time zone 'UTC')::date, min(e.seller_id::text)::uuid,
         count(*) filter (where e.event_type = 'VIEW'),
         count(distinct coalesce(e.user_id, e.visitor_id)) filter (where e.event_type = 'VIEW' and e.consented)
           + count(*) filter (where e.event_type = 'VIEW' and not e.consented),
         count(*) filter (where e.event_type = 'ADD_TO_CART'),
         count(*) filter (where e.event_type = 'FAVORITE'),
         count(*) filter (where e.event_type = 'UNFAVORITE'),
         coalesce(sum(e.dwell_ms) filter (where e.event_type = 'VIEW' and e.dwell_ms is not null), 0),
         count(*) filter (where e.event_type = 'VIEW' and e.dwell_ms is not null),
         now()
    from public.nx_product_events e
   where e.occurred_at >= p_from::timestamp at time zone 'UTC' and e.occurred_at < (p_to + 1)::timestamp at time zone 'UTC'
   group by e.product_id, (e.occurred_at at time zone 'UTC')::date
  on conflict (product_id, day) do update set
     views = excluded.views, unique_visitors = excluded.unique_visitors, add_to_cart = excluded.add_to_cart,
     favorites = excluded.favorites, unfavorites = excluded.unfavorites, dwell_ms_total = excluded.dwell_ms_total,
     dwell_samples = excluded.dwell_samples, updated_at = now();
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- Drops raw events older than p_keep_days (their days are aggregated first).
create or replace function public.nx_purge_product_events(p_keep_days integer)
returns integer language plpgsql set search_path = pg_catalog, public as $function$
declare cutoff date := current_date - greatest(p_keep_days, 30); n integer;
begin
  perform public.nx_aggregate_product_events(cutoff - 7, cutoff);
  delete from public.nx_product_events where occurred_at < cutoff::timestamp at time zone 'UTC';
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.nx_aggregate_product_events(date, date) from public;
revoke all on function public.nx_purge_product_events(integer) from public;
grant execute on function public.nx_aggregate_product_events(date, date) to nexovax_api_runtime;
grant execute on function public.nx_purge_product_events(integer) to nexovax_api_runtime;
