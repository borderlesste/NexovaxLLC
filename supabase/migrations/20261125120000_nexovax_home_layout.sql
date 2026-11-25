-- Home page sections (Admin → Configuración → Portada): which sections the home page shows, their order,
-- titles (es/en/fr/ht), item counts and per-section options (sales window, flash-campaign end, price
-- thresholds, categories with a row...). Every section starts enabled: until an admin saves, the API uses
-- its defaults (backend/src/catalog/home-layout.ts), so the home page works before this migration runs.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('home.layout', 'Secciones de la portada: orden, activación, títulos, cantidad de productos y opciones de cada sección.', 'OBJECT', '["GLOBAL"]', 'PUBLIC', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;
