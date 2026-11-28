-- Business-logic abuse (2026-11-28): limit coupon-code guessing per buyer.
-- Each distinct non-existent code a buyer types is remembered for an hour; past the limit set in
-- Admin → Configuración → Seguridad («Cupones inexistentes por hora») coupons are refused for an hour.
-- Idempotent: safe to run more than once.
create table if not exists public.nx_coupon_failed_attempts (
  user_id uuid not null references public.users(id) on delete cascade,
  code text not null check (char_length(code) between 1 and 40),
  last_attempt_at timestamptz not null default now(),
  primary key (user_id, code)
);
create index if not exists ix_nx_coupon_failed_attempts_recent on public.nx_coupon_failed_attempts (user_id, last_attempt_at desc);
alter table public.nx_coupon_failed_attempts enable row level security;
revoke all on public.nx_coupon_failed_attempts from anon, authenticated;
grant select, insert, update, delete on public.nx_coupon_failed_attempts to nexovax_api_runtime;

-- Describe the new control in the existing security.controls setting.
update public.system_setting_definitions
   set description = 'Seguridad: retención de fondos tras la entrega, reservas por transferencia, límites anti-abuso (recuperación de contraseña, cupones inexistentes) y retención de documentos.'
 where key = 'security.controls';
