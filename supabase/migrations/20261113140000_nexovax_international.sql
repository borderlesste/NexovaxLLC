-- NEXOVAX: international marketplace configuration.
-- * Brand NEXOVAX, base currency USD (single marketplace currency, admin-configurable),
--   default locale "es" with English available.
-- * Per-country tax rates (destination based), editable from the admin panel.
-- * Configurable bank-transfer instructions (no hard-coded bank).
-- * Shippo as live shipping provider; marketplace flat rates as fallback.
-- * USD payout policy.

-- 1. Real ISO currencies offered in the admin (idempotent; fixes placeholder names)
INSERT INTO public.currencies (code, name, decimal_places, is_active) VALUES
  ('USD', 'US Dollar', 2, true), ('EUR', 'Euro', 2, true), ('GBP', 'Pound Sterling', 2, true),
  ('CAD', 'Canadian Dollar', 2, true), ('MXN', 'Mexican Peso', 2, true), ('DOP', 'Dominican Peso', 2, true),
  ('COP', 'Colombian Peso', 2, true), ('CLP', 'Chilean Peso', 0, true), ('PEN', 'Peruvian Sol', 2, true),
  ('ARS', 'Argentine Peso', 2, true), ('BRL', 'Brazilian Real', 2, true)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true
  WHERE public.currencies.name IS DISTINCT FROM EXCLUDED.name OR NOT public.currencies.is_active;

-- 2. Per-country tax rates -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_tax_rates (
  country_code          varchar(2) PRIMARY KEY,
  tax_name              text NOT NULL CHECK (btrim(tax_name) <> ''),
  rate                  numeric(7,6) NOT NULL CHECK (rate >= 0 AND rate < 1),
  applies_to_shipping   boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  notes                 text,
  updated_by_user_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_marketplace_tax_rates_country CHECK (country_code ~ '^[A-Z]{2}$')
);
COMMENT ON TABLE public.marketplace_tax_rates IS
  'Destination-country tax applied at checkout on product net (and optionally shipping). Countries without an active row are taxed at 0. Starting values are common standard rates; operators must confirm them with their tax advisor.';
ALTER TABLE public.marketplace_tax_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_tax_rates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_tax_rates TO nexovax_api_runtime;

INSERT INTO public.marketplace_tax_rates (country_code, tax_name, rate, notes) VALUES
  ('DO', 'ITBIS', 0.18, NULL), ('MX', 'IVA', 0.16, NULL), ('CO', 'IVA', 0.19, NULL),
  ('ES', 'IVA', 0.21, NULL), ('AR', 'IVA', 0.21, NULL), ('CL', 'IVA', 0.19, NULL),
  ('PE', 'IGV', 0.18, NULL), ('UY', 'IVA', 0.22, NULL), ('CR', 'IVA', 0.13, NULL),
  ('GT', 'IVA', 0.12, NULL), ('PA', 'ITBMS', 0.07, NULL), ('EC', 'IVA', 0.15, NULL),
  ('PR', 'IVU', 0.115, NULL), ('GB', 'VAT', 0.20, NULL), ('DE', 'MwSt', 0.19, NULL),
  ('FR', 'TVA', 0.20, NULL), ('IT', 'IVA', 0.22, NULL), ('PT', 'IVA', 0.23, NULL),
  ('CA', 'GST', 0.05, 'Federal GST only; provincial taxes not included.'),
  ('US', 'Sales tax', 0, 'US sales tax depends on state/locality; configure a tax provider before charging it.')
ON CONFLICT (country_code) DO NOTHING;

-- 3. Setting definitions -----------------------------------------------------------
INSERT INTO public.system_setting_definitions (key, description, value_type, security_class) VALUES
  ('shipping.shippo_enabled', 'Cotiza y compra etiquetas con Shippo cuando la ruta lo permite', 'BOOLEAN', 'PUBLIC'),
  ('payments.bank_transfer',  'Datos para pagos por transferencia bancaria',                    'OBJECT',  'PUBLIC'),
  ('marketplace.default_country', 'País por defecto para nuevas direcciones (ISO 3166-1 alfa-2)', 'STRING', 'PUBLIC')
ON CONFLICT (key) DO NOTHING;
UPDATE public.system_setting_definitions SET description = 'Tarifas fijas del marketplace (respaldo cuando Shippo no cubre la ruta)'
 WHERE key = 'shipping.rates';
UPDATE public.system_setting_definitions SET description = 'Obsoleto: los impuestos se configuran por país (marketplace_tax_rates)'
 WHERE key = 'tax.itbis_rate';

-- 4. Setting values (new versions; previous versions kept as SUPERSEDED) ---------
CREATE OR REPLACE FUNCTION pg_temp.nx_set(p_key text, p_value jsonb, p_only_if jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_current jsonb;
  v_id uuid;
  v_actor uuid;
BEGIN
  SELECT value INTO v_current FROM public.system_setting_values
   WHERE setting_key = p_key AND scope_type = 'GLOBAL' AND status = 'ACTIVE'
   ORDER BY version_number DESC LIMIT 1;
  IF v_current IS NOT NULL AND (v_current = p_value OR (p_only_if IS NOT NULL AND v_current <> p_only_if)) THEN
    RETURN; -- unchanged, or customised by an operator: keep it
  END IF;
  SELECT u.id INTO v_actor FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.id JOIN public.roles r ON r.id = ur.role_id
   WHERE r.code IN ('SUPER_ADMIN', 'ADMIN') ORDER BY u.created_at LIMIT 1;
  INSERT INTO public.system_setting_values (setting_key, version_number, scope_type, value, checksum, status, created_by_user_id)
  VALUES (p_key, COALESCE((SELECT max(version_number) FROM public.system_setting_values WHERE setting_key = p_key), 0) + 1,
          'GLOBAL', p_value, extensions.digest(p_value::text, 'sha256'), 'DRAFT', v_actor)
  RETURNING id INTO v_id;
  IF v_actor IS NOT NULL THEN
    PERFORM public.activate_system_setting_value(v_id, v_actor, now());
  ELSE
    UPDATE public.system_setting_values SET status = 'SUPERSEDED', superseded_at = now()
     WHERE setting_key = p_key AND scope_type = 'GLOBAL' AND status = 'ACTIVE';
    UPDATE public.system_setting_values SET status = 'ACTIVE', effective_at = now(), activated_at = now() WHERE id = v_id;
    INSERT INTO public.system_setting_history (setting_value_id, event_type, reason) VALUES (v_id, 'ACTIVATED', 'NEXOVAX international configuration');
  END IF;
END $$;

SELECT pg_temp.nx_set('marketplace.name', '"NEXOVAX"', '"RD Marketplace Multivendedor"');
SELECT pg_temp.nx_set('marketplace.support_email', '"soporte@nexovax.com"', '"soporte@rdmarketplace.do"');
SELECT pg_temp.nx_set('marketplace.currency', '"USD"', '"DOP"');
SELECT pg_temp.nx_set('marketplace.locale', '"es"', '"es-DO"');
SELECT pg_temp.nx_set('marketplace.default_country', '"US"');
SELECT pg_temp.nx_set('shipping.shippo_enabled', 'true');
SELECT pg_temp.nx_set('shipping.rates', '[
  {"code":"STANDARD","name":"Envío estándar","description":"Entrega en 3 a 7 días hábiles","amount":6.99,"estimated_days":7,"requires_address":true},
  {"code":"EXPRESS","name":"Envío express","description":"Entrega en 1 a 3 días hábiles","amount":14.99,"estimated_days":3,"requires_address":true},
  {"code":"PICKUP","name":"Retiro en tienda","description":"Recoge tu pedido en la tienda del vendedor","amount":0,"estimated_days":1,"requires_address":false}
]'::jsonb, (SELECT value FROM public.system_setting_values WHERE setting_key = 'shipping.rates' AND status = 'ACTIVE' AND value @> '[{"code":"STANDARD","amount":150}]' LIMIT 1));
SELECT pg_temp.nx_set('payments.bank_transfer', '{
  "enabled": true,
  "bank_name": "NEXOVAX Demo Bank",
  "account_holder": "NEXOVAX LLC",
  "account_number": "000123456789",
  "routing_or_swift": "NXVXUS33",
  "iban": null,
  "instructions": "Transfiere el monto exacto e incluye la referencia. Tu pedido se confirmará cuando validemos el pago (máx. 72 h)."
}'::jsonb);

-- 5. USD payout policy -----------------------------------------------------------------
DO $payout$
DECLARE
  v_group uuid;
  v_version uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.business_rule_groups WHERE rule_type_code = 'PAYOUT_POLICY' AND code = 'NX-GLOBAL-PAYOUT-USD') THEN
    INSERT INTO public.business_rule_groups (rule_type_code, code, name, description, scope_type_code, priority, application_mode)
    VALUES ('PAYOUT_POLICY', 'NX-GLOBAL-PAYOUT-USD', 'Política de retiros USD',
            'Libera fondos al entregar el pedido; retiros bajo demanda con aprobación manual.', 'GLOBAL', 0, 'EXCLUSIVE')
    RETURNING id INTO v_group;
    v_version := (public.create_business_rule_version(v_group, NULL, '{}'::jsonb, 'Política USD', 'SYSTEM',
                  'NEXOVAX international configuration', NULL)).id;
    INSERT INTO public.payout_policy_definitions (
      rule_version_id, currency_code, release_trigger_code, hold_period_seconds, reserve_rate,
      reserve_hold_seconds, minimum_payout_amount, maximum_payout_amount, approval_mode,
      approval_threshold_amount, require_distinct_approver, schedule_mode, automatic_submission,
      require_seller_active, block_open_return, block_open_dispute, provider_fee_funding_source_code)
    VALUES (v_version, 'USD', 'DELIVERED', 0, 0, 0, 25, NULL, 'MANUAL', NULL, false,
            'ON_DEMAND', false, true, true, true, 'PLATFORM');
    PERFORM public.publish_business_rule_version(v_version, NULL, now(), 'SYSTEM', 'NEXOVAX international configuration', NULL);
  END IF;
END
$payout$;

-- 6. Addresses are international: the DO city catalog becomes optional ---------------
ALTER TABLE public.addresses ALTER COLUMN city_id DROP NOT NULL;
ALTER TABLE public.seller_ship_from_addresses ALTER COLUMN city_id DROP NOT NULL;
