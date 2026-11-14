-- NEXOVAX: cancellation of paid orders before they ship.
--
-- A cancellation covers one seller order (one store's part of the purchase).
-- Customers, sellers and staff open it; once APPROVED the fulfillment is undone
-- and stock returns (API), and an admin issues a CANCELLATION refund through the
-- same refund engine as returns (execute_referral_refund): the customer gets
-- products + tax + shipping + fees back, the commission is reversed and the
-- seller's entitlement leaves SELLER_PENDING.

create table if not exists public.nx_order_cancellations (
  id uuid primary key default gen_random_uuid(),
  public_number bigint generated always as identity (start with 81001),
  order_id uuid not null references public.orders(id),
  seller_order_id uuid not null references public.seller_orders(id),
  seller_id uuid not null references public.sellers(id),
  customer_id uuid not null references public.users(id),
  requested_by uuid references public.users(id) on delete set null,
  requested_by_role text not null check (requested_by_role in ('CUSTOMER','SELLER','STAFF')),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]*$'),
  note text check (note is null or (btrim(note) <> '' and length(note) <= 1000)),
  status text not null default 'REQUESTED' check (status in ('REQUESTED','APPROVED','REJECTED','WITHDRAWN','REFUNDED')),
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or (btrim(decision_note) <> '' and length(decision_note) <= 1000)),
  restocked_at timestamptz,
  refund_id uuid references public.refunds(id),
  refunded_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_nx_cancellation_decision check (status in ('REQUESTED','WITHDRAWN') or decided_at is not null),
  constraint chk_nx_cancellation_refunded check (status <> 'REFUNDED' or (refund_id is not null and refunded_at is not null))
);
create unique index if not exists uq_nx_order_cancellations_open on public.nx_order_cancellations (seller_order_id) where status in ('REQUESTED','APPROVED','REFUNDED');
create index if not exists idx_nx_order_cancellations_status on public.nx_order_cancellations (status, created_at desc);
create index if not exists idx_nx_order_cancellations_order on public.nx_order_cancellations (order_id);
alter table public.nx_order_cancellations enable row level security;
grant select, insert, update on public.nx_order_cancellations to nexovax_api_runtime;

-- A cancelled order never ships, so its seller funds are still in SELLER_PENDING (funds are
-- released only on delivery). Recover a CANCELLATION refund from there first; returns keep
-- the original order (reserve, available, pending).
create or replace function public.add_seller_refund_clawback_plan(p_refund_id uuid, p_seller_id uuid, p_amount numeric)
returns void language plpgsql set search_path to 'pg_catalog', 'public' as $function$
DECLARE
    v_currency VARCHAR(3);
    v_kind TEXT;
    v_remaining NUMERIC(20,8);
    v_account UUID;
    v_balance NUMERIC(20,8);
    v_take NUMERIC(20,8);
    v_code TEXT;
BEGIN

    PERFORM public.lock_referral_financial_orders(ARRAY(SELECT order_id FROM public.refunds WHERE id=p_refund_id));
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'SELLER_CLAWBACK_AMOUNT_MUST_BE_POSITIVE' USING ERRCODE = '22023';
    END IF;
    SELECT currency_code, refund_kind INTO v_currency, v_kind FROM public.refunds WHERE id = p_refund_id;
    IF v_currency IS NULL THEN RAISE EXCEPTION 'REFUND_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

    v_remaining := p_amount;

    -- Each is a credit-normal liability, so DEBIT reduces what the platform owes the seller.
    FOREACH v_code IN ARRAY CASE WHEN v_kind = 'CANCELLATION'
        THEN ARRAY['SELLER_PENDING','SELLER_RESERVE','SELLER_AVAILABLE']
        ELSE ARRAY['SELLER_RESERVE','SELLER_AVAILABLE','SELLER_PENDING'] END LOOP
        EXIT WHEN v_remaining <= 0;
        v_account := public.get_or_create_ledger_account(v_code, v_currency, p_seller_id);
        PERFORM 1 FROM public.ledger_accounts WHERE id=v_account FOR UPDATE;
        v_balance := public.ledger_account_posted_balance(v_account);
        -- Earlier items in this same atomic plan already consume this bucket.
        -- Keep posted history intact; include current draft debits under its lock.
        v_balance := v_balance-COALESCE((SELECT sum(l.amount) FROM public.refund_ledger_plan_lines l
          WHERE l.refund_id=p_refund_id AND l.account_definition_code=v_code
            AND l.owner_seller_id=p_seller_id AND l.side='DEBIT'),0);
        v_take := LEAST(GREATEST(v_balance,0), v_remaining);
        IF v_take > 0 THEN
            PERFORM public.add_refund_ledger_plan_line(
                p_refund_id, v_code, 'DEBIT', v_take, 'SELLER_CLAWBACK',
                p_seller_id, NULL, NULL, NULL,
                'Recover refund from ' || v_code, '{}'::JSONB
            );
            v_remaining := v_remaining - v_take;
        END IF;
    END LOOP;

    IF v_remaining > 0 THEN
        -- SELLER_RECEIVABLE is a debit-normal seller asset. Debit creates an
        -- amount the platform must recover from future seller earnings.
        PERFORM public.add_refund_ledger_plan_line(
            p_refund_id, 'SELLER_RECEIVABLE', 'DEBIT', v_remaining,
            'SELLER_RECEIVABLE', p_seller_id, NULL, NULL, NULL,
            'Uncovered seller refund obligation becomes receivable.', '{}'::JSONB
        );
    END IF;
END;
$function$;

-- Produces the CANCELLATION refund (header, items, gross component evidence) for an
-- approved cancellation: every unit of the seller order, in full. Idempotent per identity.
create or replace function public.nx_create_cancellation_refund(p_cancellation uuid, p_payment uuid, p_policy uuid, p_actor uuid, p_identity text, p_correlation uuid)
returns uuid language plpgsql set search_path = pg_catalog, public as $function$
declare
  c public.nx_order_cancellations%rowtype; so public.seller_orders%rowtype; pay public.payments%rowtype;
  existing public.refunds%rowtype; sof public.seller_order_financial_snapshots%rowtype;
  it record; promo jsonb; snap jsonb; items jsonb := '[]'; x jsonb;
  anchor uuid; ship_groups jsonb; ship_total numeric; ship_tax numeric; item_tax_total numeric; activated timestamptz;
  item_ship numeric; item_shiptax numeric; item_fee numeric; precision_ integer;
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

  -- Nothing may have left the warehouse, been refunded or returned; the fulfillment was already undone.
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
  if sof.seller_order_id is null or sof.currency_code <> so.currency_code then
    raise exception 'INVALID_FINANCIAL_CONFIGURATION' using errcode = '23514'; end if;
  select decimal_places into precision_ from public.currencies where code = so.currency_code for share;
  select coalesce(sum(f.tax_amount), 0) into item_tax_total
    from public.order_item_financial_snapshots f join public.order_items oi on oi.id = f.order_item_id where oi.seller_order_id = so.id;
  ship_tax := sof.tax_amount - item_tax_total;
  select coalesce(jsonb_agg(jsonb_build_object('orderShippingGroupId', g.id, 'shippingRefund', g.customer_shipping_amount) order by g.id), '[]'),
         coalesce(sum(g.customer_shipping_amount), 0)
    into ship_groups, ship_total
    from public.order_shipping_groups g where g.seller_order_id = so.id and g.customer_shipping_amount <> 0;
  if ship_tax < 0 or ship_total <> sof.shipping_amount then raise exception 'INVALID_FINANCIAL_CONFIGURATION' using errcode = '23514'; end if;
  select min(id::text)::uuid into anchor from public.order_items where seller_order_id = so.id;

  for it in select oi.id, oi.quantity as ordered_qty, f.* from public.order_items oi
              join public.order_item_financial_snapshots f on f.order_item_id = oi.id
             where oi.seller_order_id = so.id order by oi.id loop
    promo := public.historical_product_promotion_refund_source(it.id);
    if coalesce((promo->>'platformFunded')::numeric, 0) <> 0 or it.ordered_qty <> it.quantity
       or it.seller_product_entitlement + it.platform_commission_amount <> it.product_net_amount
       or it.currency_code <> so.currency_code then
      raise exception 'CANCELLATION_REQUIRES_MANUAL_REVIEW' using errcode = '23514'; end if;
    item_ship := case when it.id = anchor then ship_total else 0 end;
    item_shiptax := case when it.id = anchor then ship_tax else 0 end;
    item_fee := case when it.id = anchor then sof.customer_fee_amount else 0 end;
    snap := jsonb_build_object(
      'contract', 'REFUND_FINANCIAL_COMPONENTS_V1', 'basis', 'GROSS_BEFORE_REFERRAL', 'algorithm', 'ORDER_CANCELLATION_FULL_V1',
      'cancellationId', c.id, 'policyRuleVersionId', p_policy, 'orderItemId', it.id,
      'sourceCheckoutItemFinancialSnapshotId', it.source_checkout_item_financial_snapshot_id, 'sourceCalculationRunId', it.source_calculation_run_id,
      'currencyPrecision', precision_, 'priorQuantity', 0, 'cumulativeQuantity', it.quantity, 'originalQuantity', it.quantity,
      'originalProduct', it.product_net_amount, 'originalDiscount', it.discount_amount,
      'originalSeller', it.seller_product_entitlement, 'originalPlatform', it.platform_commission_amount,
      'productTarget', it.product_net_amount, 'platformTarget', it.platform_commission_amount, 'sellerTarget', it.seller_product_entitlement,
      'taxTarget', it.tax_amount, 'productRefund', it.product_net_amount, 'productTaxRefund', it.tax_amount, 'shippingTaxRefund', item_shiptax,
      'taxRefund', it.tax_amount + item_shiptax, 'shippingRefund', item_ship, 'customerFeeRefund', item_fee,
      'shippingScopeSellerOrderId', so.id, 'shippingTaxGroups', case when it.id = anchor then ship_groups else '[]'::jsonb end,
      'originalShipping', sof.shipping_amount, 'originalCustomerFee', sof.customer_fee_amount,
      'cumulativeShippingTarget', sof.shipping_amount, 'cumulativeCustomerFeeTarget', sof.customer_fee_amount,
      'grossSellerRefund', it.seller_product_entitlement, 'grossPlatformCommissionRefund', it.platform_commission_amount,
      'unrecoverableRefund', 0, 'unrecoverableTarget', 0,
      'fullPlatformSellerRestoration', 0, 'fullPlatformSellerRestorationUnwind', 0, 'previousFullPlatformRestoration', 0, 'fullPlatformRestorationTarget', 0,
      'referralClawback', 0, 'referralComponents', '[]'::jsonb,
      'customerRefund', it.product_net_amount + it.tax_amount + item_shiptax + item_ship + item_fee);
    items := items || jsonb_build_array(jsonb_build_object('id', it.id, 'quantity', it.quantity, 'snapshot', snap));
    p_total := p_total + it.product_net_amount; t_total := t_total + it.tax_amount + item_shiptax;
    sh_total := sh_total + item_ship; fee_total := fee_total + item_fee;
    s_total := s_total + it.seller_product_entitlement; pl_total := pl_total + it.platform_commission_amount;
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
    jsonb_build_object('contract', 'REFUND_FINANCIAL_COMPONENTS_V1', 'cancellationId', c.id), 0, 0)
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

-- After the refund is COMPLETED: units cancelled, seller order (and the order, when every
-- store's part is cancelled) moves to CANCELLED.
create or replace function public.nx_finish_order_cancellation(p_cancellation uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $function$
declare c public.nx_order_cancellations%rowtype; r public.refunds%rowtype; so public.seller_orders%rowtype;
begin
  select * into c from public.nx_order_cancellations where id = p_cancellation for update;
  if not found then raise exception 'CANCELLATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if c.status = 'REFUNDED' then return; end if;
  select * into r from public.refunds where id = c.refund_id;
  if c.status <> 'APPROVED' or r.id is null or r.status <> 'COMPLETED' or r.refund_kind <> 'CANCELLATION' or r.seller_order_id <> c.seller_order_id then
    raise exception 'CANCELLATION_REFUND_NOT_COMPLETED' using errcode = '23514'; end if;
  select * into so from public.seller_orders where id = c.seller_order_id for update;
  update public.order_items set cancelled_quantity = quantity, version = version + 1, updated_at = now()
   where seller_order_id = so.id and cancelled_quantity = 0 and fulfilled_quantity = 0;
  if so.lifecycle_status in ('NEW','PROCESSING') then
    update public.seller_orders set lifecycle_status = 'CANCELLED', cancelled_at = now(), version = version + 1 where id = so.id;
  end if;
  if not exists (select 1 from public.seller_orders x where x.order_id = c.order_id and x.lifecycle_status <> 'CANCELLED') then
    update public.orders set lifecycle_status = 'CANCELLED', cancelled_at = now(), version = version + 1
     where id = c.order_id and lifecycle_status = 'PROCESSING';
  end if;
  update public.nx_order_cancellations set status = 'REFUNDED', refunded_at = now(), last_error = null, updated_at = now() where id = c.id;
end;
$function$;

revoke all on function public.nx_create_cancellation_refund(uuid, uuid, uuid, uuid, text, uuid) from public;
revoke all on function public.nx_finish_order_cancellation(uuid) from public;
grant execute on function public.nx_create_cancellation_refund(uuid, uuid, uuid, uuid, text, uuid) to nexovax_api_runtime;
grant execute on function public.nx_finish_order_cancellation(uuid) to nexovax_api_runtime;
grant execute on function public.cancel_fulfillment(uuid) to nexovax_api_runtime;
