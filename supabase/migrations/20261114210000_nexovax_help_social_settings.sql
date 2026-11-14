-- Help center content and social links, editable from Admin → Configuración → Ayuda y redes.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values
  ('help.faq', 'Preguntas frecuentes del centro de ayuda (es/en).', 'ARRAY', '["GLOBAL"]', 'PUBLIC', true, true),
  ('help.sellers', 'Ayuda para vendedores: secciones del centro de ayuda (es/en).', 'OBJECT', '["GLOBAL"]', 'PUBLIC', true, true),
  ('help.commissions', 'Texto de comisiones y pagos a vendedores (es/en); la tasa y el retiro mínimo se muestran automáticamente.', 'OBJECT', '["GLOBAL"]', 'PUBLIC', true, true),
  ('social.links', 'Redes sociales del pie de página.', 'ARRAY', '["GLOBAL"]', 'PUBLIC', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;
