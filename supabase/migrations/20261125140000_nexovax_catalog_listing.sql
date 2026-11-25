-- Catalog listings (Admin → Configuración → General → Catálogo): products per page in /catalogo,
-- category pages and search. Until an admin saves, the API uses its default (12, settings.service.ts),
-- so pagination works before this migration runs; the row is only needed to save the setting.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('catalog.listing', 'Catálogo público: productos por página en /catalogo, categorías y búsqueda.', 'OBJECT', '["GLOBAL"]', 'PUBLIC', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;
