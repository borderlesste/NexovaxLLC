-- NEXOVAX: real payment providers (TEST environment).
-- STRIPE: cards via Payment Intents (Payment Element, 3-D Secure). PAYPAL: Orders v2 (capture).
-- Captures are confirmed server-to-server (API retrieve / capture response) and, when the
-- public webhook is configured, by signed webhooks; therefore webhook receipts are optional.
-- Charges are taken by the platform; sellers are paid through the payout module.
DO $providers$
DECLARE
  v_cfg uuid;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('STRIPE', 'Stripe', '["CARD"]'::jsonb, '{"display_name":"Tarjeta (Stripe)","supports_3ds":true}'::jsonb),
    ('PAYPAL', 'PayPal', '["PAYPAL"]'::jsonb, '{"display_name":"PayPal"}'::jsonb)
  ) AS t(code, name, methods, public_cfg)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.payment_provider_configurations WHERE provider_code = r.code AND environment = 'TEST' AND status = 'ACTIVE') THEN
      INSERT INTO public.payment_provider_configurations (
        provider_code, environment, version, name, charge_strategy, capture_method, transfer_timing,
        webhook_signature_required, status, allowed_payment_method_types, public_configuration)
      VALUES (r.code, 'TEST',
              COALESCE((SELECT max(version) FROM public.payment_provider_configurations WHERE provider_code = r.code AND environment = 'TEST'), 0) + 1,
              r.name, 'PLATFORM_SEPARATE_TRANSFERS', 'AUTOMATIC', 'DEFERRED', false, 'DRAFT', r.methods, r.public_cfg)
      RETURNING id INTO v_cfg;
      PERFORM public.publish_payment_provider_configuration(v_cfg, NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.platform_payment_provider_accounts WHERE provider_code = r.code AND environment = 'TEST') THEN
      INSERT INTO public.platform_payment_provider_accounts (provider_code, environment, external_account_id, status, charges_enabled, payouts_enabled, capabilities, connected_at)
      VALUES (r.code, 'TEST', lower(r.code) || '_platform_test', 'ACTIVE', true, false, jsonb_build_object('methods', r.methods), now());
    END IF;
  END LOOP;
END
$providers$;
