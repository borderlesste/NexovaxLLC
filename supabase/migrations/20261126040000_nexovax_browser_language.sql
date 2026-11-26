-- Browser language (Admin → Configuración → General → Opciones del marketplace): on a first visit with no
-- saved language, show the site in the browser's language when it is one of the four supported. Until an
-- admin saves, the API uses its default (on, settings.service.ts); the row is only needed to save the setting.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('features.browser_language', 'Primera visita sin idioma guardado: usar el idioma del navegador si es uno de los admitidos.', 'BOOLEAN', '["GLOBAL"]', 'PUBLIC', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;
