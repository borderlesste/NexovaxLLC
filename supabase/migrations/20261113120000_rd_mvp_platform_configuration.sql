-- RD Marketplace MVP: platform reference data and versioned commercial configuration.
-- * DOP (peso dominicano) as marketplace currency.
-- * RD_SANDBOX payment provider (TEST environment, no external credentials):
--   simulates card/transfer processing behind the provider-neutral payment model.
-- * RD_MANUAL payout provider (manual external bank transfer, admin-confirmed).
-- * Global PLATFORM_COMMISSION rule: 10 % of seller product subtotal.
-- * Global PAYOUT_POLICY rule (DOP): funds released on delivery, manual approval.
-- All commercial values are data in versioned rules, never application constants.

INSERT INTO public.currencies (code, name, decimal_places, is_active)
VALUES ('DOP', 'Peso dominicano', 2, true)
ON CONFLICT (code) DO NOTHING;

DO $cfg$
DECLARE
  v_cfg uuid;
  v_group uuid;
  v_version uuid;
BEGIN
  -- Payment provider (sandbox) ------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.payment_provider_configurations
                 WHERE provider_code = 'RD_SANDBOX' AND environment = 'TEST') THEN
    INSERT INTO public.payment_provider_configurations (
      provider_code, environment, version, name, charge_strategy, capture_method,
      transfer_timing, webhook_signature_required, status,
      allowed_payment_method_types, public_configuration)
    VALUES ('RD_SANDBOX', 'TEST', 1, 'RD Marketplace Sandbox', 'PLATFORM_SEPARATE_TRANSFERS',
            'AUTOMATIC', 'DEFERRED', false, 'DRAFT',
            '["CARD","BANK_TRANSFER"]'::jsonb,
            '{"display_name":"Pagos de prueba RD Marketplace","test_cards":{"success":"4242 4242 4242 4242","decline":"4000 0000 0000 0002"}}'::jsonb)
    RETURNING id INTO v_cfg;
    PERFORM public.publish_payment_provider_configuration(v_cfg, NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.platform_payment_provider_accounts
                 WHERE provider_code = 'RD_SANDBOX' AND environment = 'TEST') THEN
    INSERT INTO public.platform_payment_provider_accounts (
      provider_code, environment, external_account_id, status, charges_enabled,
      payouts_enabled, capabilities, connected_at)
    VALUES ('RD_SANDBOX', 'TEST', 'rd_sandbox_platform', 'ACTIVE', true, true,
            '{"card":true,"bank_transfer":true}'::jsonb, now());
  END IF;

  -- Payout provider (manual bank transfer) ----------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.payout_provider_configurations
                 WHERE provider_code = 'RD_MANUAL' AND environment = 'TEST') THEN
    INSERT INTO public.payout_provider_configurations (
      provider_code, environment, version, name, execution_mode,
      settlement_ledger_account_code, webhook_confirmation_required,
      supports_idempotency, status, public_configuration, activated_at)
    VALUES ('RD_MANUAL', 'TEST', 1, 'Transferencia manual RD', 'MANUAL_EXTERNAL',
            'BANK_CASH', false, true, 'ACTIVE', '{}'::jsonb, now());
  END IF;

  -- Platform commission: global 10 % ----------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.business_rule_groups
                 WHERE rule_type_code = 'PLATFORM_COMMISSION' AND code = 'RD-GLOBAL-COMMISSION') THEN
    INSERT INTO public.business_rule_groups (
      rule_type_code, code, name, description, scope_type_code, priority, application_mode)
    VALUES ('PLATFORM_COMMISSION', 'RD-GLOBAL-COMMISSION', 'Comisión global del marketplace',
            'Comisión por venta aplicada a todos los vendedores salvo regla más específica.',
            'GLOBAL', 0, 'EXCLUSIVE')
    RETURNING id INTO v_group;
    v_version := (public.create_business_rule_version(v_group, NULL, '{}'::jsonb,
                  'Comisión inicial MVP', 'SYSTEM', 'Initial MVP configuration', NULL)).id;
    INSERT INTO public.commission_rule_definitions (
      rule_version_id, calculation_type, calculation_base_code, percentage_rate, rounding_mode)
    VALUES (v_version, 'PERCENTAGE', 'SELLER_PRODUCT_SUBTOTAL', 0.10, 'ROUND_HALF_UP');
    PERFORM public.publish_business_rule_version(v_version, NULL, now(),
            'SYSTEM', 'Initial MVP configuration', NULL);
  END IF;

  -- Payout policy (DOP) -----------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.business_rule_groups
                 WHERE rule_type_code = 'PAYOUT_POLICY' AND code = 'RD-GLOBAL-PAYOUT-DOP') THEN
    INSERT INTO public.business_rule_groups (
      rule_type_code, code, name, description, scope_type_code, priority, application_mode)
    VALUES ('PAYOUT_POLICY', 'RD-GLOBAL-PAYOUT-DOP', 'Política de retiros DOP',
            'Libera fondos al entregar el pedido; retiros bajo demanda con aprobación manual.',
            'GLOBAL', 0, 'EXCLUSIVE')
    RETURNING id INTO v_group;
    v_version := (public.create_business_rule_version(v_group, NULL, '{}'::jsonb,
                  'Política inicial MVP', 'SYSTEM', 'Initial MVP configuration', NULL)).id;
    INSERT INTO public.payout_policy_definitions (
      rule_version_id, currency_code, release_trigger_code, hold_period_seconds, reserve_rate,
      reserve_hold_seconds, minimum_payout_amount, maximum_payout_amount, approval_mode,
      approval_threshold_amount, require_distinct_approver, schedule_mode, automatic_submission,
      require_seller_active, block_open_return, block_open_dispute, provider_fee_funding_source_code)
    VALUES (v_version, 'DOP', 'DELIVERED', 0, 0, 0, 500, NULL, 'MANUAL', NULL, false,
            'ON_DEMAND', false, true, true, true, 'PLATFORM');
    PERFORM public.publish_business_rule_version(v_version, NULL, now(),
            'SYSTEM', 'Initial MVP configuration', NULL);
  END IF;
END
$cfg$;
