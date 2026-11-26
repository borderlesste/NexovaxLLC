-- "Haiti Tracking by Nexovax" (Admin → Configuración → General → Opciones del marketplace): banner with the
-- Haiti Tracking logo and the photo of the Haitian coast on orders shipped to Haiti and on /politica-de-envios.
-- Until an admin saves, the API uses its default (on, settings.service.ts); the row is only needed to save it.
-- The home page banner is a section of home.layout (Portada) and needs no row.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('features.haiti_tracking', 'Banner Haiti Tracking by Nexovax en pedidos con destino Haití y en la política de envíos.', 'BOOLEAN', '["GLOBAL"]', 'PUBLIC', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;
