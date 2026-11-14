-- Account deletion: the user requests it, an admin approves it.
--  * No purchase/sale history  → HARD: every row of the account is deleted (and the auth identity).
--  * With history              → ANONYMIZED: personal data is deleted or redacted; orders, refunds and
--                                ledger rows stay (accounting + the other party's records) under a
--                                closed, anonymous user that can never sign in again.
-- Blockers (orders in progress, open returns, seller balance/payouts, staff roles) must be cleared first.

create table if not exists public.nx_account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  email_snapshot text not null,
  name_snapshot text,
  reason text check (reason is null or length(reason) <= 1000),
  status text not null default 'REQUESTED' check (status in ('REQUESTED','APPROVED','REJECTED','CANCELLED','COMPLETED','FAILED')),
  mode text check (mode is null or mode in ('HARD','ANONYMIZED')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  completed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_nx_account_deletion_open on public.nx_account_deletion_requests (user_id) where status in ('REQUESTED','APPROVED');
create index if not exists idx_nx_account_deletion_status on public.nx_account_deletion_requests (status, requested_at desc);
alter table public.nx_account_deletion_requests enable row level security;
grant select, insert, update on public.nx_account_deletion_requests to nexovax_api_runtime;

-- What still prevents closing the account (empty array = can be closed).
create or replace function public.nx_account_deletion_blockers(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare out jsonb := '[]'::jsonb; n bigint;
begin
  select count(*) into n from public.orders o
   where o.customer_id = p_user and o.lifecycle_status not in ('CANCELLED','CLOSED','COMPLETED')
     and (o.payment_status <> 'PAID' or o.fulfillment_status not in ('DELIVERED','RETURNED','PARTIALLY_RETURNED'));
  if n > 0 then out := out || jsonb_build_object('code','BUYER_ORDERS_IN_PROGRESS','count',n); end if;
  select count(*) into n from public.return_requests r
   where (r.customer_id = p_user or r.seller_id in (select id from public.sellers where owner_user_id = p_user))
     and r.status in ('REQUESTED','UNDER_REVIEW','APPROVED','AWAITING_SHIPMENT','IN_TRANSIT','RECEIVED','INSPECTING','REFUND_PENDING');
  if n > 0 then out := out || jsonb_build_object('code','OPEN_RETURNS','count',n); end if;
  select count(*) into n from public.seller_orders so join public.sellers s on s.id = so.seller_id
   where s.owner_user_id = p_user and so.lifecycle_status in ('NEW','PROCESSING')
     and so.fulfillment_status not in ('DELIVERED','RETURNED','PARTIALLY_RETURNED');
  if n > 0 then out := out || jsonb_build_object('code','SELLER_ORDERS_IN_PROGRESS','count',n); end if;
  select count(*) into n from public.seller_balance_projections b join public.sellers s on s.id = b.seller_id
   where s.owner_user_id = p_user and (b.pending_amount <> 0 or b.available_amount <> 0 or coalesce(b.reserve_amount,0) <> 0);
  if n > 0 then out := out || jsonb_build_object('code','SELLER_BALANCE','count',n); end if;
  select count(*) into n from public.payouts p join public.sellers s on s.id = p.seller_id
   where s.owner_user_id = p_user and p.status in ('REQUESTED','APPROVAL_REQUIRED','APPROVED','PROCESSING');
  if n > 0 then out := out || jsonb_build_object('code','PAYOUTS_IN_PROGRESS','count',n); end if;
  select count(*) into n from public.user_roles ur join public.roles r on r.id = ur.role_id
   where ur.user_id = p_user and ur.revoked_at is null and r.code in ('SUPER_ADMIN','ADMIN','SUPPORT','MODERATOR');
  if n > 0 then out := out || jsonb_build_object('code','STAFF_ROLES','count',n); end if;
  return out;
end $$;

-- True when the account has records other people or the books depend on.
create or replace function public.nx_account_has_history(p_user uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.orders where customer_id = p_user)
      or exists (select 1 from public.payments where customer_id = p_user)
      or exists (select 1 from public.refunds where customer_id = p_user)
      or exists (select 1 from public.seller_orders so join public.sellers s on s.id = so.seller_id where s.owner_user_id = p_user)
      or exists (select 1 from public.payouts p join public.sellers s on s.id = p.seller_id where s.owner_user_id = p_user)
      or exists (select 1 from public.ledger_accounts la where la.owner_user_id = p_user
                  or la.owner_seller_id in (select id from public.sellers where owner_user_id = p_user));
$$;

-- Executes an approved deletion. Returns {mode, ...}.
CREATE OR REPLACE FUNCTION public.nx_delete_account(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  keep_tables text[] := array['attribute_definitions','business_rule_definition_registry','business_rule_groups','business_rule_scope_types','business_rule_types',
    'business_rule_version_history','business_rule_versions','calculation_bases','categories','category_attribute_definitions','city_references',
    'commission_rule_definitions','cost_component_types','countries','country_catalog_sources','country_catalog_sync_runs','currencies','funding_sources',
    'ledger_account_definitions','marketplace_tax_rates','payment_provider_configurations','payout_policy_definitions','payout_provider_configurations',
    'permissions','platform_metadata','platform_payment_provider_accounts','product_types','role_permissions','roles','support_priorities',
    'support_sla_policies','support_teams','support_ticket_categories','system_setting_definitions','system_setting_history','system_setting_values',
    'brands','geo_regions','geo_postal_codes','shipping_carrier_status','return_policy_rule_definitions','return_reason_definitions',
    'notification_categories','nx_account_deletion_requests'];
  personal text[] := array['addresses','auth_password_credentials','auth_sessions','customer_favorites','customer_payment_method_references',
    'customer_payment_provider_profiles','email_verification_tokens','password_reset_tokens','mfa_methods','mfa_recovery_codes',
    'notification_preferences','notifications','seller_followers','feature_flag_targets','support_ticket_watchers','seller_members'];
  r record; n int; added int; pass int := 0; conds text; remaining text[]; progress bool; tn text; t text; col text;
  placeholder text := 'deleted-' || replace(p_user::text, '-', '') || '@deleted.nexovax.invalid';
  skipped text[] := '{}';
begin
  if not exists (select 1 from public.users where id = p_user) then raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0002'; end if;
  if jsonb_array_length(public.nx_account_deletion_blockers(p_user)) > 0 then raise exception 'ACCOUNT_DELETION_BLOCKED' using errcode = '55000'; end if;

  if not public.nx_account_has_history(p_user) then
    create temp table if not exists nx_del_marks(tbl text, id text, primary key (tbl, id)) on commit drop;
    delete from nx_del_marks;
    insert into nx_del_marks values ('users', p_user::text);
    loop
      pass := pass + 1; added := 0;
      for r in select cl.relname src, a.attname c, cf.relname dst
                 from pg_constraint k join pg_class cl on cl.oid = k.conrelid join pg_class cf on cf.oid = k.confrelid
                 cross join lateral generate_subscripts(k.confkey, 1) i
                 join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[i] and af.attname = 'id'
                 join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[i]
                where k.contype = 'f' and cl.relnamespace = 'public'::regnamespace and not (cl.relname = any(keep_tables))
                  and (a.attname = 'uploaded_by_user_id' or not (a.attname ~ '(_by|_by_user_id|actor_user_id|decided_by|reviewed_by|approved_by|created_by|updated_by|assigned_by|changed_by_user_id|removed_by_user_id)$'))
                  and exists (select 1 from pg_attribute x where x.attrelid = k.conrelid and x.attname = 'id' and not x.attisdropped)
                  and exists (select 1 from nx_del_marks m where m.tbl = cf.relname) loop
        execute format('insert into nx_del_marks select %L, s.id::text from public.%I s where s.%I::text in (select id from nx_del_marks where tbl = %L) on conflict do nothing', r.src, r.src, r.c, r.dst);
        get diagnostics n = row_count; added := added + n;
      end loop;
      exit when added = 0 or pass > 30;
    end loop;
    if exists (select 1 from nx_del_marks where tbl = 'users' and id <> p_user::text)
       or exists (select 1 from nx_del_marks m join public.sellers s on s.id::text = m.id where m.tbl = 'sellers' and s.owner_user_id <> p_user) then
      raise exception 'ACCOUNT_DELETION_SCOPE_ERROR' using errcode = '55000';
    end if;
    for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' loop
      execute format('alter table public.%I disable trigger user', r.relname);
    end loop;
    for r in select cl.relname src, a.attname c from pg_constraint k join pg_class cl on cl.oid = k.conrelid
               join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
              where k.contype = 'f' and cardinality(k.conkey) = 1 and k.confrelid in ('public.users'::regclass, 'public.sellers'::regclass)
                and cl.relnamespace = 'public'::regnamespace and not a.attnotnull loop
      execute format('update public.%I set %I = null where %I::text in (select id from nx_del_marks where tbl in (''users'',''sellers''))%s', r.src, r.c, r.c,
        case when exists (select 1 from pg_attribute x join pg_class xc on xc.oid = x.attrelid where xc.relname = r.src and xc.relnamespace = 'public'::regnamespace and x.attname = 'id' and not x.attisdropped)
             then format(' and id::text not in (select id from nx_del_marks where tbl = %L)', r.src) else '' end);
    end loop;
    pass := 0;
    loop
      progress := false; remaining := '{}';
      for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not (c.relname = any(keep_tables)) loop
        select string_agg(format('%I::text in (select id from nx_del_marks where tbl = %L)', a.attname, cf.relname), ' or ') into conds
          from pg_constraint k join pg_class cl on cl.oid = k.conrelid join pg_class cf on cf.oid = k.confrelid
          cross join lateral generate_subscripts(k.confkey, 1) i
          join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[i] and af.attname = 'id'
          join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[i]
         where k.contype = 'f' and cl.relname = tn and cl.relnamespace = 'public'::regnamespace
           and not exists (select 1 from pg_attribute x where x.attrelid = cl.oid and x.attname = 'id' and not x.attisdropped)
           and (a.attname = 'uploaded_by_user_id' or not (a.attname ~ '(_by|_by_user_id|actor_user_id|decided_by|reviewed_by|approved_by|created_by|updated_by|assigned_by|changed_by_user_id|removed_by_user_id)$'))
           and exists (select 1 from nx_del_marks m where m.tbl = cf.relname);
        if exists (select 1 from nx_del_marks where tbl = tn) then conds := coalesce(conds || ' or ', '') || format('id::text in (select id from nx_del_marks where tbl = %L)', tn); end if;
        continue when conds is null;
        begin
          execute format('delete from public.%I where %s', tn, conds);
          get diagnostics n = row_count; if n > 0 then progress := true; end if;
          execute format('select count(*) from public.%I where %s', tn, conds) into n;
          if n > 0 then remaining := remaining || tn; end if;
        exception when foreign_key_violation then remaining := remaining || tn;
        end;
      end loop;
      exit when cardinality(remaining) = 0;
      pass := pass + 1;
      if not progress then
        for r in select cl.relname src, a.attname c, cf.relname dst from pg_constraint k
                   join pg_class cl on cl.oid = k.conrelid join pg_class cf on cf.oid = k.confrelid
                   join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
                  where k.contype = 'f' and cl.relnamespace = 'public'::regnamespace and cl.relname = any(remaining) and not a.attnotnull
                    and exists (select 1 from nx_del_marks m where m.tbl = cf.relname) loop
          execute format('update public.%I set %I = null where %I::text in (select id from nx_del_marks where tbl = %L)', r.src, r.c, r.c, r.dst);
        end loop;
      end if;
      if pass > 80 then raise exception 'ACCOUNT_DELETION_INCOMPLETE: %', remaining using errcode = '55000'; end if;
    end loop;
    for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' loop
      execute format('alter table public.%I enable trigger user', r.relname);
    end loop;
    delete from auth.users where id = p_user;
    return jsonb_build_object('mode', 'HARD', 'rows', (select count(*) from nx_del_marks));
  end if;

  foreach t in array personal loop
    for col in select a.attname from pg_constraint k join pg_class cl on cl.oid = k.conrelid
                 join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
                where k.contype = 'f' and k.confrelid = 'public.users'::regclass and cl.relname = t and cl.relnamespace = 'public'::regnamespace loop
      begin
        if t = 'addresses' then
          alter table public.checkout_address_snapshots disable trigger user;
          update public.checkout_address_snapshots set source_address_id = null where source_address_id in (select id from public.addresses where user_id = p_user);
          alter table public.checkout_address_snapshots enable trigger user;
        end if;
        execute format('delete from public.%I where %I = $1', t, col) using p_user;
      exception when others then
        skipped := skipped || (t || ': ' || sqlerrm);
      end;
    end loop;
  end loop;
  update public.user_roles set revoked_at = now(), revoked_by = p_user where user_id = p_user and revoked_at is null;
  delete from public.cart_item_events e using public.cart_items ci, public.carts c
   where e.cart_item_id = ci.id and ci.cart_id = c.id and c.customer_id = p_user
     and not exists (select 1 from public.checkout_items x where x.cart_item_id = ci.id);
  delete from public.cart_items ci using public.carts c
   where ci.cart_id = c.id and c.customer_id = p_user and not exists (select 1 from public.checkout_items x where x.cart_item_id = ci.id);
  insert into public.user_profiles (user_id, display_name) values (p_user, 'Usuario eliminado')
    on conflict (user_id) do update set first_name = null, last_name = null, display_name = 'Usuario eliminado', phone = null, avatar_asset_id = null;
  -- address snapshots and e-mail log are append-only; redaction of a closed account is the one sanctioned exception
  alter table public.order_address_snapshots disable trigger user;
  alter table public.shipment_address_snapshots disable trigger user;
  alter table public.checkout_address_snapshots disable trigger user;
  alter table public.email_deliveries disable trigger user;
  update public.email_deliveries set to_email = placeholder where user_id = p_user;
  update public.order_address_snapshots s set recipient_name = 'Usuario eliminado', company_name = null, line1 = 'Dirección eliminada', line2 = null, phone = null
    from public.orders o where o.id = s.order_id and o.customer_id = p_user;
  update public.shipment_address_snapshots s set recipient_name = 'Usuario eliminado', company_name = null, line1 = 'Dirección eliminada', line2 = null, phone = null, email = null
    from public.shipments sh join public.orders o on o.id = sh.order_id where sh.id = s.shipment_id and s.address_type = 'TO' and o.customer_id = p_user;
  update public.checkout_address_snapshots s set recipient_name = 'Usuario eliminado', company_name = null, line1 = 'Dirección eliminada', line2 = null, phone = null
    from public.checkout_sessions cs where cs.id = s.checkout_session_id and cs.customer_id = p_user;
  alter table public.order_address_snapshots enable trigger user;
  alter table public.shipment_address_snapshots enable trigger user;
  alter table public.checkout_address_snapshots enable trigger user;
  alter table public.email_deliveries enable trigger user;
  update public.products set status = 'ARCHIVED' where seller_id in (select id from public.sellers where owner_user_id = p_user) and status <> 'ARCHIVED';
  update public.sellers set status = 'CLOSED' where owner_user_id = p_user and status <> 'CLOSED';
  update public.users set email = placeholder, status = 'CLOSED', closed_at = now(), email_verified_at = null where id = p_user;
  update auth.users set email = placeholder, encrypted_password = '', phone = null, raw_user_meta_data = '{}'::jsonb,
         banned_until = '2999-12-31 00:00:00+00', email_confirmed_at = null where id = p_user;
  delete from auth.identities where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  return jsonb_build_object('mode', 'ANONYMIZED', 'skipped', to_jsonb(skipped));
end $function$;

revoke all on function public.nx_account_deletion_blockers(uuid) from public;
revoke all on function public.nx_account_has_history(uuid) from public;
revoke all on function public.nx_delete_account(uuid) from public;
grant execute on function public.nx_account_deletion_blockers(uuid) to nexovax_api_runtime;
grant execute on function public.nx_account_has_history(uuid) to nexovax_api_runtime;
grant execute on function public.nx_delete_account(uuid) to nexovax_api_runtime;
