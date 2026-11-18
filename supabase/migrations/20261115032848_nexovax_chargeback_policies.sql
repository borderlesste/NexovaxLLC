select public.publish_initial_chargeback_cost_policies(null, '2026-11-01T00:00:00Z'::timestamptz)
 where not exists (select 1 from public.business_rule_groups where rule_type_code = 'COST_ALLOCATION' and code like 'CHARGEBACK-%-INITIAL-2026-10-08');

create or replace function public.nx_pin_chargeback_policies(p_order uuid)
returns integer
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  o public.orders%rowtype; v_run uuid; it record; c record; v_src uuid; n integer := 0;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  select car.calculation_run_id into v_run from public.order_applied_rules oar
    join public.checkout_applied_rules car on car.id = oar.source_checkout_applied_rule_id
   where oar.order_id = p_order limit 1;
  if v_run is null then
    select r.id into v_run from public.checkout_calculation_runs r where r.checkout_session_id = o.checkout_session_id order by r.created_at desc limit 1;
  end if;
  if v_run is null then raise exception 'CHARGEBACK_POLICY_RUN_NOT_FOUND' using errcode = 'P0002'; end if;
  for it in select oi.id, oi.seller_id, oi.seller_order_id, oi.source_checkout_item_id from public.order_items oi where oi.order_id = p_order order by oi.id loop
    for c in
      select distinct on (d.cost_component_code) d.*, v.id as version_id
        from public.business_rule_groups g join public.business_rule_versions v on v.rule_group_id = g.id
        join public.cost_allocation_rule_definitions d on d.rule_version_id = v.id
       where g.rule_type_code = 'COST_ALLOCATION' and g.scope_type_code = 'GLOBAL'
         and d.cost_component_code in ('CHARGEBACK_PRINCIPAL', 'CHARGEBACK_FEE')
         and v.status in ('ACTIVE', 'SUPERSEDED', 'EXPIRED')
       order by d.cost_component_code,
                (coalesce(v.effective_from, v.activated_at, v.created_at) <= coalesce(o.placed_at, o.created_at)) desc,
                case when coalesce(v.effective_from, v.activated_at, v.created_at) <= coalesce(o.placed_at, o.created_at)
                     then coalesce(v.effective_from, v.activated_at, v.created_at) end desc nulls last,
                coalesce(v.effective_from, v.activated_at, v.created_at)
    loop
      continue when exists (select 1 from public.order_applied_rules x where x.order_item_id = it.id and x.rule_type_code = 'COST_ALLOCATION'
                              and x.rule_snapshot->>'authority' = 'COST_FUNDING_POLICY_1' and x.rule_snapshot->>'component' = c.cost_component_code);
      insert into public.checkout_applied_rules (calculation_run_id, checkout_session_id, checkout_item_id, seller_id, business_rule_version_id,
             rule_type_code, scope_type_code, funding_source_code, currency_code, rule_snapshot)
      values (v_run, o.checkout_session_id, it.source_checkout_item_id, it.seller_id, c.version_id, 'COST_ALLOCATION', 'GLOBAL',
              case when c.allocation_method = 'PLATFORM' then 'PLATFORM' else 'SELLER' end, o.currency_code,
              jsonb_build_object('authority', 'COST_FUNDING_POLICY_1', 'component', c.cost_component_code, 'method', c.allocation_method,
                'platformRate', c.platform_share_rate::text, 'sellerRate', c.seller_share_rate::text, 'customerRate', c.customer_share_rate::text,
                'config', c.config, 'ruleVersionId', c.version_id, 'itemId', it.id, 'pinnedAt', now()))
      returning id into v_src;
      insert into public.order_applied_rules (order_id, seller_order_id, order_item_id, source_checkout_applied_rule_id, business_rule_version_id,
             rule_type_code, scope_type_code, funding_source_code, currency_code, rule_snapshot)
      select o.id, it.seller_order_id, it.id, car.id, car.business_rule_version_id, car.rule_type_code, car.scope_type_code, car.funding_source_code,
             car.currency_code, car.rule_snapshot
        from public.checkout_applied_rules car where car.id = v_src;
      n := n + 1;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.nx_pin_chargeback_policies(uuid) from public;
grant execute on function public.nx_pin_chargeback_policies(uuid) to nexovax_api_runtime;
grant execute on function public.mark_payment_processing(uuid, uuid, uuid) to nexovax_api_runtime;
