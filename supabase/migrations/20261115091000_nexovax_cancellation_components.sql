-- NEXOVAX: trusted gross components for CANCELLATION refunds.
--
-- The gross-component evidence guard recomputes every refund item from trusted
-- sources before accepting its proof. Returns use the historical return
-- calculator; cancellations now use nx_cancellation_refund_component, a pure
-- function of the immutable order snapshots (every unit, in full: product,
-- tax, the seller order's shipping and fees on one anchor item).

create or replace function public.nx_cancellation_refund_component(p_cancellation uuid, p_policy uuid, p_order_item uuid)
returns jsonb language plpgsql stable set search_path = pg_catalog, public as $function$
declare
  c public.nx_order_cancellations%rowtype; sof public.seller_order_financial_snapshots%rowtype;
  oi public.order_items%rowtype; f public.order_item_financial_snapshots%rowtype;
  anchor uuid; ship_groups jsonb; ship_total numeric; ship_tax numeric; item_tax_total numeric; precision_ integer;
  item_ship numeric; item_shiptax numeric; item_fee numeric;
begin
  select * into c from public.nx_order_cancellations where id = p_cancellation;
  select * into oi from public.order_items where id = p_order_item;
  select * into f from public.order_item_financial_snapshots where order_item_id = p_order_item;
  select * into sof from public.seller_order_financial_snapshots where seller_order_id = c.seller_order_id;
  if c.id is null or oi.id is null or f.order_item_id is null or sof.seller_order_id is null or p_policy is null
     or oi.seller_order_id <> c.seller_order_id or f.quantity <> oi.quantity or f.currency_code <> sof.currency_code
     or f.seller_product_entitlement + f.platform_commission_amount <> f.product_net_amount then
    raise exception 'INVALID_FINANCIAL_CONFIGURATION' using errcode = '23514'; end if;
  select decimal_places into precision_ from public.currencies where code = sof.currency_code;
  select coalesce(sum(x.tax_amount), 0) into item_tax_total
    from public.order_item_financial_snapshots x join public.order_items y on y.id = x.order_item_id where y.seller_order_id = c.seller_order_id;
  ship_tax := sof.tax_amount - item_tax_total;
  select coalesce(jsonb_agg(jsonb_build_object('orderShippingGroupId', g.id, 'shippingRefund', g.customer_shipping_amount) order by g.id), '[]'),
         coalesce(sum(g.customer_shipping_amount), 0)
    into ship_groups, ship_total
    from public.order_shipping_groups g where g.seller_order_id = c.seller_order_id and g.customer_shipping_amount <> 0;
  if ship_tax < 0 or ship_total <> sof.shipping_amount then raise exception 'INVALID_FINANCIAL_CONFIGURATION' using errcode = '23514'; end if;
  select min(id::text)::uuid into anchor from public.order_items where seller_order_id = c.seller_order_id;
  item_ship := case when oi.id = anchor then ship_total else 0 end;
  item_shiptax := case when oi.id = anchor then ship_tax else 0 end;
  item_fee := case when oi.id = anchor then sof.customer_fee_amount else 0 end;
  return jsonb_build_object(
    'contract', 'REFUND_FINANCIAL_COMPONENTS_V1', 'basis', 'GROSS_BEFORE_REFERRAL', 'algorithm', 'ORDER_CANCELLATION_FULL_V1',
    'cancellationId', c.id, 'policyRuleVersionId', p_policy, 'orderItemId', oi.id,
    'sourceCheckoutItemFinancialSnapshotId', f.source_checkout_item_financial_snapshot_id, 'sourceCalculationRunId', f.source_calculation_run_id,
    'currencyPrecision', precision_, 'priorQuantity', 0, 'cumulativeQuantity', f.quantity, 'originalQuantity', f.quantity,
    'originalProduct', f.product_net_amount, 'originalDiscount', f.discount_amount,
    'originalSeller', f.seller_product_entitlement, 'originalPlatform', f.platform_commission_amount,
    'productTarget', f.product_net_amount, 'platformTarget', f.platform_commission_amount, 'sellerTarget', f.seller_product_entitlement,
    'taxTarget', f.tax_amount, 'productRefund', f.product_net_amount, 'productTaxRefund', f.tax_amount, 'shippingTaxRefund', item_shiptax,
    'taxRefund', f.tax_amount + item_shiptax, 'shippingRefund', item_ship, 'customerFeeRefund', item_fee,
    'shippingScopeSellerOrderId', c.seller_order_id, 'shippingTaxGroups', case when oi.id = anchor then ship_groups else '[]'::jsonb end,
    'originalShipping', sof.shipping_amount, 'originalCustomerFee', sof.customer_fee_amount,
    'cumulativeShippingTarget', sof.shipping_amount, 'cumulativeCustomerFeeTarget', sof.customer_fee_amount,
    'grossSellerRefund', f.seller_product_entitlement, 'grossPlatformCommissionRefund', f.platform_commission_amount,
    'unrecoverableRefund', 0, 'unrecoverableTarget', 0,
    'fullPlatformSellerRestoration', 0, 'fullPlatformSellerRestorationUnwind', 0, 'previousFullPlatformRestoration', 0, 'fullPlatformRestorationTarget', 0,
    'referralClawback', 0, 'referralComponents', '[]'::jsonb,
    'customerRefund', f.product_net_amount + f.tax_amount + item_shiptax + item_ship + item_fee);
end;
$function$;

create or replace function public.guard_referral_gross_component_origin()
returns trigger language plpgsql set search_path to 'pg_catalog', 'public' as $function$
DECLARE ri public.refund_items%ROWTYPE; r public.refunds%ROWTYPE; expected jsonb;
BEGIN
 PERFORM public.assert_referral_refund_actor(NEW.actor_user_id);
 SELECT * INTO ri FROM public.refund_items WHERE id=NEW.refund_item_id;
 SELECT * INTO r FROM public.refunds WHERE id=ri.refund_id;
 IF r.refund_kind='CANCELLATION' AND r.return_request_id IS NULL AND r.metadata ? 'cancellationId' AND r.metadata ? 'policyRuleVersionId'
    AND EXISTS(SELECT 1 FROM public.nx_order_cancellations c WHERE c.id=(r.metadata->>'cancellationId')::uuid
               AND c.seller_order_id=r.seller_order_id AND c.status='APPROVED') THEN
  expected:=public.nx_cancellation_refund_component((r.metadata->>'cancellationId')::uuid,(r.metadata->>'policyRuleVersionId')::uuid,ri.order_item_id);
  IF ri.quantity IS DISTINCT FROM (expected->>'cumulativeQuantity')::bigint OR ri.return_item_id IS NOT NULL THEN
   RAISE EXCEPTION 'REFUND_HISTORICAL_COMPONENT_PROOF_MISMATCH' USING ERRCODE='23514'; END IF;
 ELSIF r.refund_kind<>'RETURN' OR r.return_request_id IS NULL THEN
  RAISE EXCEPTION 'INVALID_FINANCIAL_CONFIGURATION' USING ERRCODE='23514';
 ELSE
  expected:=public.calculate_historical_return_component(r.return_request_id,ri.return_item_id,ri.quantity,r.id);
 END IF;
 IF ri.calculation_snapshot IS DISTINCT FROM expected OR NEW.original_order_item_id IS DISTINCT FROM ri.order_item_id
  OR NEW.policy_rule_version_id IS DISTINCT FROM (expected->>'policyRuleVersionId')::uuid
  OR NEW.gross_seller_amount IS DISTINCT FROM (expected->>'grossSellerRefund')::numeric
  OR NEW.gross_platform_amount IS DISTINCT FROM (expected->>'grossPlatformCommissionRefund')::numeric
  OR ri.product_refund_amount IS DISTINCT FROM (expected->>'productRefund')::numeric
  OR ri.tax_refund_amount IS DISTINCT FROM (expected->>'taxRefund')::numeric
  OR ri.referral_clawback_amount IS DISTINCT FROM (expected->>'referralClawback')::numeric
  OR ri.customer_refund_amount IS DISTINCT FROM (expected->>'customerRefund')::numeric
  OR ri.seller_clawback_amount IS DISTINCT FROM NEW.gross_seller_amount
  OR ri.platform_commission_reversal_amount IS DISTINCT FROM NEW.gross_platform_amount
  OR ri.allocated_shipping_refund_amount IS DISTINCT FROM (expected->>'shippingRefund')::numeric
  OR ri.customer_fee_refund_amount IS DISTINCT FROM (expected->>'customerFeeRefund')::numeric OR ri.restocking_fee_amount<>0
  OR NEW.calculation_snapshot_hash IS DISTINCT FROM extensions.digest(convert_to(expected::text,'UTF8'),'sha256') THEN
  RAISE EXCEPTION 'REFUND_HISTORICAL_COMPONENT_PROOF_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$function$;

-- The producer now takes each item's components from the trusted calculator.
create or replace function public.nx_create_cancellation_refund(p_cancellation uuid, p_payment uuid, p_policy uuid, p_actor uuid, p_identity text, p_correlation uuid)
returns uuid language plpgsql set search_path = pg_catalog, public as $function$
declare
  c public.nx_order_cancellations%rowtype; so public.seller_orders%rowtype; pay public.payments%rowtype;
  existing public.refunds%rowtype; sof public.seller_order_financial_snapshots%rowtype;
  it record; promo jsonb; snap jsonb; items jsonb := '[]'; x jsonb; activated timestamptz;
  p_total numeric := 0; t_total numeric := 0; s_total numeric := 0; pl_total numeric := 0; sh_total numeric := 0; fee_total numeric := 0;
  r_id uuid; item_id uuid;
begin
  perform public.assert_referral_refund_actor(p_actor);
  if p_identity is null or btrim(p_identity) = '' or p_correlation is null then
    raise exception 'INVALID_FINANCIAL_CONFIGURATION' using errcode = '23514'; end if;
  select * into c from public.nx_order_cancellations where id = p_cancellation;
  if not found then raise exception 'CANCELLATION_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.lock_referral_financial_orders(array[c.order_id]);
  select * into c from public.nx_order_cancellations where id = p_cancellation for update;

  select * into existing from public.refunds where idempotency_key = p_identity;
  if found then
    if existing.refund_kind <> 'CANCELLATION' or existing.seller_order_id is distinct from c.seller_order_id
       or existing.payment_id is distinct from p_payment or existing.correlation_id is distinct from p_correlation then
      raise exception 'REFUND_PRODUCER_RETRY_CONFLICT' using errcode = '23514'; end if;
    return existing.id;
  end if;
  if c.status <> 'APPROVED' or c.refund_id is not null then
    raise exception 'CANCELLATION_NOT_APPROVED' using errcode = '23514'; end if;

  select * into so from public.seller_orders where id = c.seller_order_id;
  select * into pay from public.payments where id = p_payment;
  if pay.id is null or pay.order_id is distinct from so.order_id or pay.customer_id is distinct from c.customer_id
     or pay.currency_code is distinct from so.currency_code or pay.status not in ('PAID','PARTIALLY_REFUNDED') then
    raise exception 'INVALID_FINANCIAL_CONFIGURATION' using errcode = '23514'; end if;
  if so.lifecycle_status in ('CANCELLED','CLOSED','COMPLETED') then
    raise exception 'CANCELLATION_ORDER_CLOSED' using errcode = '23514'; end if;
  select v.activated_at into activated from public.return_policy_rule_definitions d
    join public.business_rule_versions v on v.id = d.rule_version_id where d.rule_version_id = p_policy;
  if activated is null or activated > now() then raise exception 'INVALID_FINANCIAL_CONFIGURATION' using errcode = '23514'; end if;

  if exists (select 1 from public.order_items oi where oi.seller_order_id = so.id
       and (oi.fulfilled_quantity > 0 or oi.shipped_quantity > 0 or oi.delivered_quantity > 0 or oi.returned_quantity > 0
            or oi.refunded_quantity > 0 or oi.cancelled_quantity > 0))
     or exists (select 1 from public.shipments sh where sh.seller_order_id = so.id and sh.status <> 'CANCELLED')
     or exists (select 1 from public.refunds r where r.seller_order_id = so.id and r.status not in ('FAILED','CANCELLED'))
     or exists (select 1 from public.return_requests rr where rr.seller_order_id = so.id) then
    raise exception 'CANCELLATION_ITEMS_NOT_CANCELLABLE' using errcode = '23514'; end if;
  if exists (select 1 from public.referral_commissions rc join public.order_items oi on oi.id = rc.order_item_id where oi.seller_order_id = so.id) then
    raise exception 'CANCELLATION_REQUIRES_MANUAL_REVIEW' using errcode = '23514'; end if;
  select * into sof from public.seller_order_financial_snapshots where seller_order_id = so.id;

  for it in select oi.id from public.order_items oi where oi.seller_order_id = so.id order by oi.id loop
    promo := public.historical_product_promotion_refund_source(it.id);
    if coalesce((promo->>'platformFunded')::numeric, 0) <> 0 then
      raise exception 'CANCELLATION_REQUIRES_MANUAL_REVIEW' using errcode = '23514'; end if;
    snap := public.nx_cancellation_refund_component(c.id, p_policy, it.id);
    items := items || jsonb_build_array(jsonb_build_object('id', it.id, 'quantity', (snap->>'cumulativeQuantity')::bigint, 'snapshot', snap));
    p_total := p_total + (snap->>'productRefund')::numeric; t_total := t_total + (snap->>'taxRefund')::numeric;
    sh_total := sh_total + (snap->>'shippingRefund')::numeric; fee_total := fee_total + (snap->>'customerFeeRefund')::numeric;
    s_total := s_total + (snap->>'grossSellerRefund')::numeric; pl_total := pl_total + (snap->>'grossPlatformCommissionRefund')::numeric;
  end loop;
  if jsonb_array_length(items) = 0 or p_total + t_total + sh_total + fee_total <> sof.customer_total then
    raise exception 'INVALID_FINANCIAL_CONFIGURATION' using errcode = '23514'; end if;

  insert into public.refunds (payment_id, order_id, seller_order_id, seller_id, return_request_id, customer_id, currency_code,
    refund_kind, product_refund_amount, tax_refund_amount, shipping_refund_amount, customer_fee_refund_amount, refund_amount,
    seller_clawback_amount, platform_commission_reversal_amount, provider_code, provider_configuration_id, idempotency_key,
    correlation_id, requested_by, reason_code, reason_detail, metadata, referral_clawback_amount, platform_promotion_reversal_amount)
  values (pay.id, so.order_id, so.id, so.seller_id, null, c.customer_id, so.currency_code,
    'CANCELLATION', p_total, t_total, sh_total, fee_total, p_total + t_total + sh_total + fee_total,
    s_total, pl_total, pay.provider_code, pay.provider_configuration_id, p_identity,
    p_correlation, p_actor, 'ORDER_CANCELLED', coalesce(c.note, 'Pedido cancelado antes del envío'),
    jsonb_build_object('contract', 'REFUND_FINANCIAL_COMPONENTS_V1', 'cancellationId', c.id, 'policyRuleVersionId', p_policy), 0, 0)
  returning id into r_id;

  for x in select * from jsonb_array_elements(items) loop
    snap := x->'snapshot';
    insert into public.refund_items (refund_id, order_item_id, return_item_id, quantity, product_refund_amount, tax_refund_amount,
      allocated_shipping_refund_amount, customer_fee_refund_amount, seller_clawback_amount, platform_commission_reversal_amount,
      customer_refund_amount, calculation_snapshot, referral_clawback_amount, platform_promotion_reversal_amount)
    values (r_id, (x->>'id')::uuid, null, (x->>'quantity')::bigint, (snap->>'productRefund')::numeric, (snap->>'taxRefund')::numeric,
      (snap->>'shippingRefund')::numeric, (snap->>'customerFeeRefund')::numeric, (snap->>'grossSellerRefund')::numeric,
      (snap->>'grossPlatformCommissionRefund')::numeric, (snap->>'customerRefund')::numeric, snap, 0, 0)
    returning id into item_id;
    insert into public.referral_refund_gross_component_evidence (refund_item_id, original_order_item_id, policy_rule_version_id,
      gross_seller_amount, gross_platform_amount, calculation_snapshot_hash, actor_user_id)
    values (item_id, (x->>'id')::uuid, p_policy, (snap->>'grossSellerRefund')::numeric, (snap->>'grossPlatformCommissionRefund')::numeric,
      extensions.digest(convert_to(snap::text, 'UTF8'), 'sha256'), p_actor);
  end loop;
  perform public.validate_refund_totals(r_id);
  update public.nx_order_cancellations set refund_id = r_id, updated_at = now() where id = c.id;
  perform public.record_audit_event('USER', p_actor, null, 'SYSTEM', 'REFUND.COMPONENTS.PRODUCED', 'REFUND', r_id,
    null, null, p_correlation, 'cancellation-refund:' || r_id, 'ORDER_CANCELLATION', null, null, null,
    jsonb_build_object('algorithm', 'ORDER_CANCELLATION_FULL_V1', 'cancellationId', c.id, 'sellerOrderId', so.id));
  return r_id;
end;
$function$;

revoke all on function public.nx_cancellation_refund_component(uuid, uuid, uuid) from public;
grant execute on function public.nx_cancellation_refund_component(uuid, uuid, uuid) to nexovax_api_runtime;
