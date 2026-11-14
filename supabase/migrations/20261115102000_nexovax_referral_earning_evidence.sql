-- NEXOVAX: affiliate earnings carry the precision proof the refund engine requires
-- (referral_original_precision): calculator version, settled amount as text, funding split,
-- currency and rounding mode.

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
          jsonb_build_object('contract', 'NX_AFFILIATE_EARNING_V1', 'calculatorVersion', '7A.2.1', 'orderReferralSnapshotId', s.id, 'item', x,
            'rate', s.eligibility_snapshot->'rate', 'finalAmount', to_char(amount, 'FM999999999990.00'), 'sellerFundedAmount', to_char(amount, 'FM999999999990.00'),
            'platformFundedAmount', '0.00', 'currencyCode', s.currency_code, 'roundingMode', 'CURRENCY_PRECISION'),
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
