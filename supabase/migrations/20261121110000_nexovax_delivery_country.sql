-- NX-GEO-001 phase 1: delivery-country context.
-- 1) The buyer's saved delivery destination (only the country, never the IP).
alter table public.users add column if not exists delivery_country varchar(2) references public.countries (alpha2);
comment on column public.users.delivery_country is 'Delivery country the buyer chose for browsing (ISO 3166-1 alpha-2). Not an address; checkout uses the confirmed address.';

-- 2) Admin settings for the destination selector (Admin → Configuración → General).
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values ('geo.delivery', 'País de entrega sugerido: detección por IP (país estimado por la infraestructura), selector en el encabezado y destinos ofrecidos.', 'OBJECT', '["GLOBAL"]', 'PUBLIC', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;

do $geo$
declare
  v jsonb := jsonb_build_object('ipDetection', true, 'showSelector', true, 'countries', '[]'::jsonb);
  v_id uuid;
begin
  if not exists (select 1 from public.system_setting_values where setting_key = 'geo.delivery' and scope_type = 'GLOBAL' and status = 'ACTIVE') then
    insert into public.system_setting_values (setting_key, version_number, scope_type, value, checksum, status, effective_at, activated_at)
    values ('geo.delivery', coalesce((select max(version_number) from public.system_setting_values where setting_key = 'geo.delivery'), 0) + 1,
            'GLOBAL', v, extensions.digest(v::text, 'sha256'), 'ACTIVE', now(), now())
    returning id into v_id;
    insert into public.system_setting_history (setting_value_id, event_type, reason) values (v_id, 'ACTIVATED', 'Configuración inicial del país de entrega');
  end if;
end
$geo$;
