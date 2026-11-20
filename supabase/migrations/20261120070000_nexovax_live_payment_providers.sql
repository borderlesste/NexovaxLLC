-- LIVE payment provider rows. Checkout looks up an ACTIVE configuration and platform account for the
-- environment of the payment (STRIPE with an sk_live_ key, PAYPAL live, bank transfers when the API
-- runs LIVE). Until now only TEST rows existed, so a LIVE checkout failed with
-- "El procesador de pagos no está disponible". Idempotent: rows are only added when missing.

insert into public.platform_payment_provider_accounts
  (provider_code, environment, external_account_id, status, charges_enabled, payouts_enabled, capabilities, metadata, connected_at)
select v.provider_code, 'LIVE', v.external_account_id, 'ACTIVE', true, v.payouts_enabled, v.capabilities::jsonb, '{}'::jsonb, now()
  from (values
    ('STRIPE', 'stripe_platform_live', false, '{"methods":["CARD"]}'),
    ('PAYPAL', 'paypal_platform_live', false, '{"methods":["PAYPAL"]}'),
    ('RD_SANDBOX', 'bank_transfer_platform_live', false, '{"bank_transfer":true}')
  ) as v(provider_code, external_account_id, payouts_enabled, capabilities)
 where not exists (
   select 1 from public.platform_payment_provider_accounts a
    where a.provider_code = v.provider_code and a.environment = 'LIVE' and a.status = 'ACTIVE');

insert into public.payment_provider_configurations
  (provider_code, environment, name, status, version, activated_at, capture_method, charge_strategy, transfer_timing,
   public_configuration, webhook_signature_required, allowed_payment_method_types)
select v.provider_code, 'LIVE', v.name, 'ACTIVE', 1, now(), 'AUTOMATIC', 'PLATFORM_SEPARATE_TRANSFERS', 'DEFERRED',
       v.public_configuration::jsonb, false, v.methods::jsonb
  from (values
    ('STRIPE', 'Stripe', '{"display_name":"Tarjeta (Stripe)","supports_3ds":true}', '["CARD"]'),
    ('PAYPAL', 'PayPal', '{"display_name":"PayPal"}', '["PAYPAL"]'),
    -- Bank transfers are confirmed by hand in /admin; this provider never charges cards in LIVE.
    ('RD_SANDBOX', 'Transferencia bancaria', '{"display_name":"Transferencia bancaria"}', '["BANK_TRANSFER"]')
  ) as v(provider_code, name, public_configuration, methods)
 where not exists (
   select 1 from public.payment_provider_configurations c
    where c.provider_code = v.provider_code and c.environment = 'LIVE' and c.status = 'ACTIVE');
