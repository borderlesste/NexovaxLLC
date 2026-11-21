-- SEO defaults (site name, default title/description, canonical base URL, Open Graph image,
-- Twitter/X card and handle, search-engine verification), editable from Admin → Configuración → SEO.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('seo.defaults', 'Metadatos SEO predeterminados del sitio: título, descripción, URL canónica, imagen Open Graph y Twitter/X (por idioma).', 'OBJECT', '["GLOBAL"]', 'PUBLIC', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;

-- First version: the texts the site used until now, so nothing changes until an admin edits them.
do $seo$
declare
  v jsonb := jsonb_build_object(
    'siteName', coalesce((select value #>> '{}' from public.system_setting_values where setting_key = 'marketplace.name' and status = 'ACTIVE' order by version_number desc limit 1), ''),
    'title', 'Marketplace multivendedor',
    'titleEn', 'Multi-vendor marketplace',
    'titleTemplate', '',
    'description', 'Compra en tiendas de todo el mundo con un solo carrito. Miles de productos, múltiples vendedores y una plataforma segura.',
    'descriptionEn', 'Shop from stores around the world with a single cart. Thousands of products, multiple sellers and a secure platform.',
    'keywords', '',
    'canonicalUrl', coalesce(rtrim((select value #>> '{}' from public.system_setting_values where setting_key = 'marketplace.base_url' and status = 'ACTIVE' and value #>> '{}' like 'https://%' order by version_number desc limit 1), '/'), ''),
    'ogImage', '',
    'ogImageAlt', '',
    'twitterHandle', '',
    'twitterCard', 'summary_large_image',
    'googleVerification', '',
    'bingVerification', '',
    'noindex', false);
  v_id uuid;
begin
  if not exists (select 1 from public.system_setting_values where setting_key = 'seo.defaults' and scope_type = 'GLOBAL' and status = 'ACTIVE') then
    insert into public.system_setting_values (setting_key, version_number, scope_type, value, checksum, status, effective_at, activated_at)
    values ('seo.defaults', coalesce((select max(version_number) from public.system_setting_values where setting_key = 'seo.defaults'), 0) + 1,
            'GLOBAL', v, extensions.digest(v::text, 'sha256'), 'ACTIVE', now(), now())
    returning id into v_id;
    insert into public.system_setting_history (setting_value_id, event_type, reason) values (v_id, 'ACTIVATED', 'Configuración SEO inicial');
  end if;
end
$seo$;
