-- RD Marketplace MVP: typed platform settings, engagement tables and API runtime access.

-- 0. Fix pre-existing bug: pgcrypto lives in schema "extensions" but these
--    functions call digest() unqualified with search_path=pg_catalog,public.
ALTER FUNCTION public.validate_system_setting_value() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.prepare_admin_change_request() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.feature_flag_bucket(text, text, text) SET search_path = pg_catalog, public, extensions;

-- 1. Typed setting definitions ------------------------------------------------
INSERT INTO public.system_setting_definitions (key, description, value_type, security_class)
VALUES
  ('marketplace.name',            'Nombre público del marketplace',                     'STRING',  'PUBLIC'),
  ('marketplace.base_url',        'URL base pública del marketplace',                   'STRING',  'PUBLIC'),
  ('marketplace.support_email',   'Correo de soporte',                                  'STRING',  'PUBLIC'),
  ('marketplace.currency',        'Moneda principal del marketplace (ISO 4217)',        'STRING',  'PUBLIC'),
  ('marketplace.locale',          'Idioma principal (BCP 47)',                          'STRING',  'PUBLIC'),
  ('tax.itbis_rate',              'Tasa de ITBIS aplicada a productos (0-1)',           'NUMERIC', 'PUBLIC'),
  ('shipping.rates',              'Tarifas de envío nacionales del proveedor RD_LOCAL', 'ARRAY',   'PUBLIC'),
  ('features.featured_products',  'Permite marcar productos destacados',                'BOOLEAN', 'PUBLIC'),
  ('features.seller_registration','Permite el registro de nuevos vendedores',          'BOOLEAN', 'PUBLIC'),
  ('features.mandatory_moderation','Exige moderación antes de publicar productos',     'BOOLEAN', 'PUBLIC'),
  ('features.email_notifications','Envía notificaciones automáticas por correo',       'BOOLEAN', 'PUBLIC')
ON CONFLICT (key) DO NOTHING;

DO $settings$
DECLARE
  r record;
  v_id uuid;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('marketplace.name',             '"RD Marketplace Multivendedor"'::jsonb),
    ('marketplace.base_url',         '"http://localhost:3000"'::jsonb),
    ('marketplace.support_email',    '"soporte@rdmarketplace.do"'::jsonb),
    ('marketplace.currency',         '"DOP"'::jsonb),
    ('marketplace.locale',           '"es-DO"'::jsonb),
    ('tax.itbis_rate',               '0.18'::jsonb),
    ('shipping.rates', '[
       {"code":"STANDARD","name":"Envío estándar","description":"Entrega en 2 a 5 días hábiles","amount":150,"estimated_days":5,"requires_address":true},
       {"code":"EXPRESS","name":"Envío express","description":"Entrega en 24 a 48 horas","amount":250,"estimated_days":2,"requires_address":true},
       {"code":"PICKUP","name":"Retiro en tienda","description":"Recoge tu pedido en la tienda del vendedor","amount":0,"estimated_days":1,"requires_address":false}
     ]'::jsonb),
    ('features.featured_products',   'true'::jsonb),
    ('features.seller_registration', 'true'::jsonb),
    ('features.mandatory_moderation','true'::jsonb),
    ('features.email_notifications', 'true'::jsonb)
  ) AS t(k, v)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.system_setting_values
                   WHERE setting_key = r.k AND scope_type = 'GLOBAL' AND status = 'ACTIVE') THEN
      -- Initial seed has no human actor (activate_system_setting_value audits a
      -- USER actor), so the first version is inserted ACTIVE with history.
      INSERT INTO public.system_setting_values (setting_key, version_number, scope_type, value,
                                                checksum, status, effective_at, activated_at)
      VALUES (r.k,
              COALESCE((SELECT max(version_number) FROM public.system_setting_values WHERE setting_key = r.k), 0) + 1,
              'GLOBAL', r.v, extensions.digest(r.v::text, 'sha256'), 'ACTIVE', now(), now())
      RETURNING id INTO v_id;
      INSERT INTO public.system_setting_history (setting_value_id, event_type, reason)
      VALUES (v_id, 'ACTIVATED', 'Initial MVP configuration');
    END IF;
  END LOOP;
END
$settings$;

-- 2. Engagement tables ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_favorites (
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_favorites_product ON public.customer_favorites(product_id);
COMMENT ON TABLE public.customer_favorites IS 'Buyer wishlist. Pure preference data; never used for pricing or authorization.';

CREATE TABLE IF NOT EXISTS public.seller_followers (
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  seller_id  uuid NOT NULL REFERENCES public.sellers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, seller_id)
);
CREATE INDEX IF NOT EXISTS idx_seller_followers_seller ON public.seller_followers(seller_id);

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  seller_id     uuid NOT NULL REFERENCES public.sellers(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL UNIQUE REFERENCES public.order_items(id) ON DELETE RESTRICT,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         text CHECK (title IS NULL OR btrim(title) <> ''),
  body          text CHECK (body IS NULL OR length(body) <= 2000),
  status        text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','HIDDEN')),
  created_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON public.product_reviews(product_id) WHERE status = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS idx_product_reviews_seller ON public.product_reviews(seller_id) WHERE status = 'PUBLISHED';
COMMENT ON TABLE public.product_reviews IS 'Verified-purchase reviews: one per delivered order item.';

ALTER TABLE public.customer_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_followers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_reviews   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_favorites, public.seller_followers, public.product_reviews FROM anon, authenticated;

-- 3. API runtime access (Nest owns authorization; no browser grants) ----------------
GRANT SELECT, INSERT, DELETE ON public.customer_favorites, public.seller_followers TO nexovax_api_runtime;
GRANT SELECT, INSERT, UPDATE ON public.product_reviews TO nexovax_api_runtime;
GRANT SELECT ON public.system_setting_definitions, public.system_setting_values,
                public.system_setting_history TO nexovax_api_runtime;
GRANT INSERT ON public.system_setting_values TO nexovax_api_runtime;
GRANT EXECUTE ON FUNCTION public.activate_system_setting_value(uuid, uuid, timestamptz) TO nexovax_api_runtime;
GRANT EXECUTE ON FUNCTION public.get_system_setting_candidates(text, uuid, varchar, varchar, timestamptz) TO nexovax_api_runtime;
GRANT SELECT ON public.calculation_bases, public.funding_sources, public.cost_component_types,
                public.notifications, public.notification_categories, public.platform_metadata
             TO nexovax_api_runtime;
