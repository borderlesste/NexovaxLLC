-- NEXOVAX: product recommendations (phase 3).
--
-- * nx_product_affinities: "people who viewed / bought this also viewed / bought that",
--   from consented browsing (same visitor) and from purchases (same customer).
-- * nx_product_popularity: recent engagement score (views, carts, favorites, sales).
-- Both are rebuilt by nx_rebuild_recommendations (nightly job). Only aggregates are stored.

create table if not exists public.nx_product_affinities (
  product_id uuid not null references public.products(id) on delete cascade,
  related_product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('CO_VIEW','CO_BUY')),
  score numeric(12,4) not null check (score > 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, kind, related_product_id),
  constraint chk_nx_affinity_distinct check (product_id <> related_product_id)
);
create index if not exists idx_nx_product_affinities_rank on public.nx_product_affinities (product_id, kind, score desc);
alter table public.nx_product_affinities enable row level security;
grant select, insert, update, delete on public.nx_product_affinities to nexovax_api_runtime;

create table if not exists public.nx_product_popularity (
  product_id uuid primary key references public.products(id) on delete cascade,
  score numeric(14,4) not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists idx_nx_product_popularity_score on public.nx_product_popularity (score desc);
alter table public.nx_product_popularity enable row level security;
grant select, insert, update, delete on public.nx_product_popularity to nexovax_api_runtime;

create or replace function public.nx_rebuild_recommendations(p_days integer default 90)
returns jsonb language plpgsql set search_path = pg_catalog, public as $function$
declare n_pop integer; n_view integer; n_buy integer; d integer := greatest(least(p_days, 365), 7);
begin
  -- Popularity: last 14 days of engagement plus 30 days of sales.
  delete from public.nx_product_popularity;
  insert into public.nx_product_popularity (product_id, score)
  select p.id,
         coalesce((select sum(s.views + 3 * s.add_to_cart + 2 * greatest(s.favorites - s.unfavorites, 0)) from public.nx_product_daily_stats s
                    where s.product_id = p.id and s.day > current_date - 14), 0)
       + 10 * coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
                         where oi.product_id = p.id and o.paid_at > now() - interval '30 days' and o.lifecycle_status <> 'CANCELLED'), 0)
       + 2 * (select count(*) from public.customer_favorites cf where cf.product_id = p.id)
    from public.products p where p.status = 'ACTIVE';
  get diagnostics n_pop = row_count;

  -- Co-views: products seen by the same consented visitor (last 50 products each).
  delete from public.nx_product_affinities where kind = 'CO_VIEW';
  with v as (
    select coalesce(user_id, visitor_id) as who, product_id, max(occurred_at) as at
      from public.nx_product_events where consented and event_type = 'VIEW' and occurred_at > now() - make_interval(days => d)
     group by 1, 2),
  recent as (select who, product_id from (select v.*, row_number() over (partition by who order by at desc) rn from v) x where rn <= 50),
  pairs as (
    select a.product_id, b.product_id as related, count(distinct a.who) as n
      from recent a join recent b on a.who = b.who and a.product_id <> b.product_id
     group by 1, 2),
  ranked as (select *, row_number() over (partition by product_id order by n desc, related) rn from pairs)
  insert into public.nx_product_affinities (product_id, related_product_id, kind, score)
  select r.product_id, r.related, 'CO_VIEW', r.n from ranked r
    join public.products p1 on p1.id = r.product_id join public.products p2 on p2.id = r.related
   where r.rn <= 30;
  get diagnostics n_view = row_count;

  -- Co-purchases: products bought by the same customer (paid, not cancelled).
  delete from public.nx_product_affinities where kind = 'CO_BUY';
  with b as (
    select distinct o.customer_id as who, oi.product_id
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where o.paid_at > now() - make_interval(days => d * 2) and o.lifecycle_status <> 'CANCELLED'),
  pairs as (
    select a.product_id, c.product_id as related, count(distinct a.who) as n
      from b a join b c on a.who = c.who and a.product_id <> c.product_id
     group by 1, 2),
  ranked as (select *, row_number() over (partition by product_id order by n desc, related) rn from pairs)
  insert into public.nx_product_affinities (product_id, related_product_id, kind, score)
  select product_id, related, 'CO_BUY', n from ranked where rn <= 30;
  get diagnostics n_buy = row_count;

  return jsonb_build_object('popularity', n_pop, 'coViews', n_view, 'coBuys', n_buy);
end;
$function$;

revoke all on function public.nx_rebuild_recommendations(integer) from public;
grant execute on function public.nx_rebuild_recommendations(integer) to nexovax_api_runtime;
