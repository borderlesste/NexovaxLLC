-- NEXOVAX: seller coupons and seller affiliate programs on the existing promotion /
-- referral engine.
--
-- Coupons: a PROMOTION rule group scoped to the seller (funding SELLER) + promotion_codes.
--   The discount lowers the item's product net; the seller's entitlement shrinks with it.
-- Affiliates: one referral_program per seller with a REFERRAL_COMMISSION rule (funding
--   SELLER). Any user shares a link with their referral code; purchases inside the
--   attribution window earn a commission that the platform pays the affiliate and takes
--   from that seller's pending funds for the sale (SELLER_PENDING -> REFERRAL_PENDING).
--   It becomes available after delivery + the return window (REFERRAL_AVAILABLE) and an
--   admin settles it manually.

create table if not exists public.nx_seller_affiliate_programs (
  seller_id uuid primary key references public.sellers(id),
  program_id uuid not null unique references public.referral_programs(id),
  rule_group_id uuid not null unique references public.business_rule_groups(id),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.nx_seller_affiliate_programs enable row level security;
grant select, insert, update on public.nx_seller_affiliate_programs to nexovax_api_runtime;

create table if not exists public.nx_affiliate_payout_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  method text not null check (method in ('PAYPAL','BANK')),
  paypal_email text check (paypal_email is null or length(paypal_email) <= 254),
  bank jsonb not null default '{}'::jsonb check (jsonb_typeof(bank) = 'object'),
  updated_at timestamptz not null default now(),
  constraint chk_nx_affiliate_payout_method check ((method = 'PAYPAL' and paypal_email is not null) or (method = 'BANK' and bank <> '{}'::jsonb))
);
alter table public.nx_affiliate_payout_profiles enable row level security;
grant select, insert, update on public.nx_affiliate_payout_profiles to nexovax_api_runtime;

grant insert on public.promotion_rule_definitions, public.referral_rule_definitions to nexovax_api_runtime;
grant insert, update on public.promotion_codes, public.referral_programs, public.referral_codes, public.referral_attributions to nexovax_api_runtime;

-- Return policy in force for a seller (store policy first, then the marketplace one).
create or replace function public.nx_current_return_policy_version(p_seller uuid)
returns uuid language sql stable set search_path = pg_catalog, public as $$
  select c.rule_version_id
    from public.get_business_rule_candidates('RETURN_POLICY', p_seller, null, null, null, now()) c
    join public.business_rule_groups g on g.id = c.rule_group_id and g.status = 'ACTIVE'
    join public.return_policy_rule_definitions d on d.rule_version_id = c.rule_version_id
   order by c.specificity_rank desc, c.priority desc, c.effective_from desc
   limit 1
$$;

-- Posts the affiliate earnings of a paid order (idempotent): one earning per eligible
-- order item, funded by the seller, plus its availability record (delivery + return window).
create or replace function public.nx_post_referral_earnings(p_order uuid, p_payment uuid, p_actor uuid, p_correlation uuid)
returns integer language plpgsql set search_path = pg_catalog, public as $function$
declare
  s record; x jsonb; oi public.order_items%rowtype; so public.seller_orders%rowtype; pay public.payments%rowtype;
  rc_id uuid; set_id uuid; amount numeric; policy uuid; anchor text; seconds bigint; created integer := 0; rule_version uuid;
begin
  select * into pay from public.payments where id = p_payment;
  if pay.id is null or pay.order_id <> p_order or pay.status not in ('PAID','PARTIALLY_REFUNDED') or pay.paid_at is null then return 0; end if;
  for s in select * from public.order_referral_snapshots where order_id = p_order and status = 'ELIGIBLE' order by id loop
    rule_version := (s.eligibility_snapshot->>'ruleVersionId')::uuid;
    select * into so from public.seller_orders where order_id = p_order and seller_id = (s.eligibility_snapshot->>'sellerId')::uuid;
    if so.id is null or rule_version is null then continue; end if;
    policy := public.nx_current_return_policy_version(so.seller_id);
    select d.return_window_anchor, d.return_window_seconds into anchor, seconds from public.return_policy_rule_definitions d where d.rule_version_id = policy;
    for x in select * from jsonb_array_elements(coalesce(s.eligibility_snapshot->'items', '[]'::jsonb)) loop
      amount := (x->>'commission')::numeric;
      if amount is null or amount <= 0 then continue; end if;
      select * into oi from public.order_items where order_id = p_order and seller_order_id = so.id and source_checkout_item_id = (x->>'itemId')::uuid;
      if oi.id is null then continue; end if;
      rc_id := null;
      select id into rc_id from public.referral_commissions where order_item_id = oi.id and referral_program_id = s.program_id;
      if rc_id is null then
        insert into public.referral_commissions (order_item_id, referral_program_id, attribution_id, referrer_id, customer_id, order_id, seller_order_id,
          business_rule_version_id, currency_code, calculation_base_code, raw_amount, bounded_amount, final_amount, seller_funded_amount,
          platform_funded_amount, rounding_mode, status, calculation_evidence, funding_evidence)
        values (oi.id, s.program_id, s.referral_attribution_id, s.referrer_id, pay.customer_id, p_order, so.id,
          rule_version, s.currency_code, coalesce(x->>'baseCode', 'PRODUCT_AFTER_DISCOUNT'), coalesce((x->>'raw')::numeric, amount), amount, amount, amount,
          0, 'CURRENCY_PRECISION', 'PENDING',
          jsonb_build_object('contract', 'NX_AFFILIATE_EARNING_V1', 'orderReferralSnapshotId', s.id, 'item', x, 'rate', s.eligibility_snapshot->'rate'),
          jsonb_build_object('fundingSource', 'SELLER', 'sellerId', so.seller_id))
        returning id into rc_id;
      end if;
      if not exists (select 1 from public.financial_allocation_sets where referral_commission_id = rc_id and status = 'POSTED') then
        set_id := null;
        select id into set_id from public.financial_allocation_sets where referral_commission_id = rc_id;
        if set_id is null then
          insert into public.financial_allocation_sets (purpose_code, currency_code, payment_id, order_id, seller_order_id, expected_total,
            idempotency_key, correlation_id, metadata, referral_commission_id)
          values ('REFERRAL_EARNING', s.currency_code, pay.id, p_order, so.id, amount, 'referral-earning:' || rc_id, p_correlation,
            jsonb_build_object('engine', 'nx-affiliates-1.0'), rc_id)
          returning id into set_id;
          insert into public.financial_allocations (allocation_set_id, direction, allocation_type_code, ledger_account_definition_code, amount,
            owner_seller_id, seller_order_id, order_referral_snapshot_id, business_rule_version_id, funding_source_code, memo, referral_leg_code)
          values (set_id, 'SOURCE', 'REFERRAL_EARNING', 'SELLER_PENDING', amount, so.seller_id, so.id, s.id, rule_version, 'SELLER',
            'Comisión de afiliado descontada al vendedor', 'SELLER_SOURCE');
          insert into public.financial_allocations (allocation_set_id, direction, allocation_type_code, ledger_account_definition_code, amount,
            owner_user_id, seller_order_id, order_referral_snapshot_id, business_rule_version_id, memo, referral_leg_code)
          values (set_id, 'DESTINATION', 'REFERRAL_EARNING', 'REFERRAL_PENDING', amount, s.referrer_id, so.id, s.id, rule_version,
            'Comisión de afiliado pendiente', 'REFERRER_DESTINATION');
          perform public.finalize_financial_allocation_set(set_id);
        end if;
        perform public.post_financial_allocation_set(set_id, 'REFERRAL_EARNING', 'ledger:referral-earning:' || rc_id, p_actor, p_correlation);
        created := created + 1;
      end if;
      if policy is not null and not exists (select 1 from public.referral_availability_records where referral_commission_id = rc_id) then
        insert into public.referral_availability_records (referral_commission_id, policy_rule_version_id, order_id, currency_code, amount, reference_event_code, hold_seconds)
        values (rc_id, policy, p_order, s.currency_code, amount, anchor, seconds);
      end if;
    end loop;
  end loop;
  return created;
end;
$function$;

-- Releases one pending affiliate earning once its item was delivered and the return window
-- passed: REFERRAL_PENDING -> REFERRAL_AVAILABLE (net of reversals and receivable offsets).
create or replace function public.nx_release_referral_earning(p_record uuid, p_actor uuid)
returns text language plpgsql set search_path = pg_catalog, public as $function$
declare
  ar public.referral_availability_records%rowtype; rc public.referral_commissions%rowtype; oi public.order_items%rowtype;
  ship record; ref_at timestamptz; amount numeric; reversed numeric; offsets numeric; batch uuid; acct uuid;
  src_ids uuid[]; off_ids uuid[];
begin
  select * into ar from public.referral_availability_records where id = p_record;
  if ar.id is null then return 'NOT_FOUND'; end if;
  select * into rc from public.referral_commissions where id = ar.referral_commission_id;
  perform public.lock_referral_financial_orders(array[rc.order_id]);
  select * into ar from public.referral_availability_records where id = p_record for update;
  select * into rc from public.referral_commissions where id = ar.referral_commission_id;
  if ar.status <> 'PENDING' or rc.status <> 'PENDING' then return 'DONE'; end if;
  if exists (select 1 from public.referral_net_release_evidence where availability_record_id = ar.id) then return 'REVERSED'; end if;
  select * into oi from public.order_items where id = rc.order_item_id;
  if ar.reference_event_code = 'DELIVERED_AT' then
    if oi.delivered_quantity < oi.quantity then return 'WAITING'; end if;
    select s.id, s.delivered_at as at into ship from public.shipments s
      join public.shipment_package_items spi on spi.shipment_id = s.id and spi.order_item_id = oi.id
     where s.status = 'DELIVERED' and s.delivered_at is not null order by s.delivered_at desc limit 1;
  elsif ar.reference_event_code = 'SHIPPED_AT' then
    if oi.shipped_quantity < oi.quantity then return 'WAITING'; end if;
    select s.id, s.shipped_at as at into ship from public.shipments s
      join public.shipment_package_items spi on spi.shipment_id = s.id and spi.order_item_id = oi.id
     where s.shipped_at is not null order by s.shipped_at desc limit 1;
  else
    select null::uuid as id, case when ar.reference_event_code = 'ORDER_PAID_AT' then o.paid_at else o.placed_at end as at into ship
      from public.orders o where o.id = rc.order_id;
  end if;
  ref_at := ship.at;
  if ref_at is null then return 'WAITING'; end if;
  if now() < ref_at + ar.hold_seconds * interval '1 second' then return 'HOLD'; end if;

  perform public.offset_referral_receivables_before_release(rc.id);
  select coalesce(sum(rv.reversal_amount), 0) into reversed from public.referral_commission_reversals rv
   where rv.referral_commission_id = rc.id and (rv.payment_dispute_resolution_id is not null
     or exists (select 1 from public.referral_refund_sources src where src.reversal_id = rv.id));
  offsets := public.referral_effective_offsets(rc.id);
  amount := rc.final_amount - reversed - offsets;
  select coalesce(array_agg(src.id order by src.id), array[]::uuid[]) into src_ids from public.referral_refund_sources src where src.referral_commission_id = rc.id;
  select coalesce(array_agg(id order by id), array[]::uuid[]) into off_ids from public.referral_receivable_offsets where future_earning_id = rc.id;

  if amount > 0 then
    perform public.lock_referral_ledger_accounts(jsonb_build_array(
      jsonb_build_object('code', 'REFERRAL_PENDING', 'currency', rc.currency_code, 'user_id', rc.referrer_id),
      jsonb_build_object('code', 'REFERRAL_AVAILABLE', 'currency', rc.currency_code, 'user_id', rc.referrer_id)));
    insert into public.ledger_batches (batch_type, source_type, source_id, currency_code, idempotency_key, order_id, seller_order_id, actor_user_id, description)
    values ('REFERRAL_AVAILABILITY', 'REFERRAL_AVAILABILITY_RECORD', ar.id, rc.currency_code, 'referral-availability:' || ar.id, rc.order_id, rc.seller_order_id, p_actor,
            'Comisión de afiliado disponible tras la entrega y el plazo de devolución')
    returning id into batch;
    acct := public.get_or_create_ledger_account('REFERRAL_PENDING', rc.currency_code, null, rc.referrer_id);
    perform public.add_ledger_entry(batch, acct, 'DEBIT', amount, 'referral_release_pending', null, rc.order_item_id);
    acct := public.get_or_create_ledger_account('REFERRAL_AVAILABLE', rc.currency_code, null, rc.referrer_id);
    perform public.add_ledger_entry(batch, acct, 'CREDIT', amount, 'referral_release_available', null, rc.order_item_id);
    perform public.post_ledger_batch(batch);
  end if;
  if reversed + offsets > 0 then
    insert into public.referral_net_release_evidence (availability_record_id, effective_reversals, offset_amount, offset_ids, residual_amount, source_ids, ledger_batch_id, evaluated_at)
    values (ar.id, reversed, offsets, off_ids, greatest(amount, 0), src_ids, case when amount > 0 then batch end, now());
  end if;
  if amount <= 0 then return 'REVERSED'; end if;
  update public.referral_availability_records
     set status = 'RELEASED', reference_shipment_id = ship.id, hold_reference_at = ref_at,
         available_at = ref_at + hold_seconds * interval '1 second', decided_at = now(), ledger_batch_id = batch
   where id = ar.id;
  update public.referral_commissions set status = 'AVAILABLE', available_at = now() where id = rc.id;
  return 'RELEASED';
end;
$function$;

revoke all on function public.nx_current_return_policy_version(uuid) from public;
revoke all on function public.nx_post_referral_earnings(uuid, uuid, uuid, uuid) from public;
revoke all on function public.nx_release_referral_earning(uuid, uuid) from public;
grant execute on function public.nx_current_return_policy_version(uuid) to nexovax_api_runtime;
grant execute on function public.nx_post_referral_earnings(uuid, uuid, uuid, uuid) to nexovax_api_runtime;
grant execute on function public.nx_release_referral_earning(uuid, uuid) to nexovax_api_runtime;
grant execute on function public.reserve_promotion_code_for_checkout(uuid, uuid, text, timestamptz, text, uuid) to nexovax_api_runtime;
grant execute on function public.settle_referral_user_manually(uuid, uuid, numeric, text, text, timestamptz, uuid) to nexovax_api_runtime;
grant execute on function public.offset_referral_receivables_before_release(uuid) to nexovax_api_runtime;
