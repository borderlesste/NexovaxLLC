-- Transactional e-mail delivery log (Resend). One row per logical e-mail;
-- `dedupe_key` makes every business event send at most once even if the API
-- retries. Server-only table: RLS on, no policies, accessed by the API role.
create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  template_code text not null,
  dedupe_key text not null,
  to_email text not null,
  user_id uuid references public.users(id) on delete set null,
  entity_type text,
  entity_id uuid,
  subject text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED', 'SKIPPED')),
  provider_code text not null default 'RESEND',
  provider_message_id text,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_email_deliveries_dedupe unique (dedupe_key)
);

create index if not exists idx_email_deliveries_user on public.email_deliveries (user_id, created_at desc);
create index if not exists idx_email_deliveries_status on public.email_deliveries (status, created_at) where status in ('PENDING', 'FAILED');

alter table public.email_deliveries enable row level security;
revoke all on public.email_deliveries from anon, authenticated;
grant select, insert, update on public.email_deliveries to nexovax_api_runtime;
