-- RD Marketplace MVP: platform commission is evidenced per checkout item, and the
-- evidence trigger supports PRODUCT_GROSS / PRODUCT_AFTER_DISCOUNT bases only.
-- Publish version 2 of the global commission (10 % of product after discounts).
DO $c$
DECLARE
  v_group uuid;
  v_version uuid;
BEGIN
  SELECT id INTO v_group FROM public.business_rule_groups
   WHERE rule_type_code = 'PLATFORM_COMMISSION' AND code = 'RD-GLOBAL-COMMISSION';
  IF v_group IS NULL THEN RAISE EXCEPTION 'RD-GLOBAL-COMMISSION missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.business_rule_versions v
               JOIN public.commission_rule_definitions d ON d.rule_version_id = v.id
              WHERE v.rule_group_id = v_group AND v.status = 'ACTIVE'
                AND d.calculation_base_code = 'PRODUCT_AFTER_DISCOUNT') THEN
    RETURN;
  END IF;
  v_version := (public.create_business_rule_version(v_group, NULL, '{}'::jsonb,
                'Comisión por artículo (10 % del producto tras descuentos)', 'SYSTEM',
                'Item-level commission evidence', NULL)).id;
  INSERT INTO public.commission_rule_definitions (
    rule_version_id, calculation_type, calculation_base_code, percentage_rate, rounding_mode)
  VALUES (v_version, 'PERCENTAGE', 'PRODUCT_AFTER_DISCOUNT', 0.10, 'ROUND_HALF_UP');
  PERFORM public.publish_business_rule_version(v_version, NULL, now(),
          'SYSTEM', 'Item-level commission evidence', NULL);
END
$c$;
