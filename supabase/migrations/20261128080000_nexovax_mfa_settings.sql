-- Two-step verification (Supabase MFA, authenticator app). Admin → Configuración → General → Opciones.
-- Until an admin saves, the API uses its defaults (both on, settings.service.ts); these rows are only
-- needed to save the switches. Also enable TOTP in Supabase → Authentication → Multi-Factor (on by default).
-- Idempotent: safe to run more than once.
insert into public.system_setting_definitions (key, description, value_type, allowed_scopes, security_class, is_runtime_mutable, is_active)
values
  ('features.mfa_staff_required', 'Soporte, moderadores y administradores deben verificar un código de su app de autenticación para usar el panel del equipo.', 'BOOLEAN', '["GLOBAL"]', 'INTERNAL', true, true),
  ('features.mfa_seller_payouts_required', 'Los dueños de tienda deben verificar un código de su app de autenticación para métodos de cobro, datos fiscales y retiros.', 'BOOLEAN', '["GLOBAL"]', 'INTERNAL', true, true)
on conflict (key) do update set description = excluded.description, value_type = excluded.value_type, is_active = true;
