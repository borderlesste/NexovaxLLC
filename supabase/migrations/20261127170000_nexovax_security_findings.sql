-- Security findings (informe de seguridad, 2026-11-27). Idempotent: safe to run more than once.

-- 1) Seller legal identity snapshot per seller order: receipts show the identity in force when the order
--    was placed, not whatever the seller types later.
create table if not exists public.nx_seller_order_legal_snapshots (
  seller_order_id uuid primary key references public.seller_orders(id) on delete cascade,
  legal_name text,
  entity_type_code text,
  registration_country_code text,
  tax_identifier_ciphertext bytea,
  tax_identifier_last4 text,
  encryption_key_version int,
  captured_at timestamptz not null default now()
);
alter table public.nx_seller_order_legal_snapshots enable row level security;
revoke all on public.nx_seller_order_legal_snapshots from anon, authenticated;
grant select on public.nx_seller_order_legal_snapshots to nexovax_api_runtime;

create or replace function public.nx_capture_seller_order_legal_snapshot()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.nx_seller_order_legal_snapshots (seller_order_id, legal_name, entity_type_code, registration_country_code,
         tax_identifier_ciphertext, tax_identifier_last4, encryption_key_version)
  select new.id, slp.legal_name, slp.entity_type_code, slp.registration_country_code,
         slp.tax_identifier_ciphertext, slp.tax_identifier_last4, slp.encryption_key_version
    from public.seller_legal_profiles slp where slp.seller_id = new.seller_id
  on conflict (seller_order_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_nx_seller_order_legal_snapshot on public.seller_orders;
create trigger trg_nx_seller_order_legal_snapshot after insert on public.seller_orders
  for each row execute function public.nx_capture_seller_order_legal_snapshot();

-- Existing orders: best available evidence is today's profile.
insert into public.nx_seller_order_legal_snapshots (seller_order_id, legal_name, entity_type_code, registration_country_code,
       tax_identifier_ciphertext, tax_identifier_last4, encryption_key_version)
select so.id, slp.legal_name, slp.entity_type_code, slp.registration_country_code,
       slp.tax_identifier_ciphertext, slp.tax_identifier_last4, slp.encryption_key_version
  from public.seller_orders so join public.seller_legal_profiles slp on slp.seller_id = so.seller_id
on conflict (seller_order_id) do nothing;

-- 2) Tunable security controls (Admin → Configuración → Seguridad). The API keeps safe defaults until saved.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('security.controls', 'Seguridad: retención de fondos tras la entrega, reservas por transferencia y límites anti-abuso.', 'OBJECT', '["GLOBAL"]', 'INTERNAL', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;

-- 3) Payouts never leave while the store has an open payment incident (chargeback, refund made outside
--    NEXOVAX) or an open dispute: released-but-unpaid funds are held too.
create or replace function public.nx_payout_incident_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if new.status not in ('REQUESTED','APPROVAL_REQUIRED','APPROVED','PROCESSING','PAID','COMPLETED') then return new; end if;
  if exists (select 1 from public.nx_payment_incidents i join public.seller_orders so on so.order_id = i.order_id
              where so.seller_id = new.seller_id and i.status = 'OPEN')
     or exists (select 1 from public.seller_orders so where so.seller_id = new.seller_id
                 and so.dispute_status in ('OPEN','ACTION_REQUIRED','UNDER_REVIEW')) then
    raise exception 'PAYOUT_BLOCKED_OPEN_INCIDENT' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_nx_payout_incident_guard on public.payouts;
create trigger trg_nx_payout_incident_guard before insert or update of status on public.payouts
  for each row execute function public.nx_payout_incident_guard();

-- 4) Purchase claims: only one request at a time may call a paid provider endpoint (e.g. a return label).
create table if not exists public.nx_purchase_claims (
  claim_key text primary key,
  claimed_at timestamptz not null default now()
);
alter table public.nx_purchase_claims enable row level security;
revoke all on public.nx_purchase_claims from anon, authenticated;
grant select, insert, update, delete on public.nx_purchase_claims to nexovax_api_runtime;

-- 5) Hourly analytics aggregation and purge filter by time: index it so a flooded table stays cheap.
create index if not exists idx_nx_product_events_occurred_at on public.nx_product_events (occurred_at);
