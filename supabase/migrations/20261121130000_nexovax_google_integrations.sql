-- Google integrations (Admin → Configuración → Google): GA4 measurement ID and the Merchant Center
-- product feed (/feeds/google-merchant.xml). Both start off; the API uses its defaults until an admin saves.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('google.integrations', 'Google Analytics 4 (ID de medición, con consentimiento de cookies) y feed de productos de Google Merchant Center.', 'OBJECT', '["GLOBAL"]', 'PUBLIC', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;
