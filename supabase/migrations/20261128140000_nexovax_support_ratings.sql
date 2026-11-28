-- Support improvements (2026-11-28): the customer rates the help when a report is resolved.
-- (Assignment to an agent already uses support_tickets.current_assignee_user_id; response times are
-- computed from support_ticket_status_history, pausing while the team waits for the customer.)
-- The rating window lives in Admin → Configuración → Seguridad («Soporte: días para calificar»).
-- Idempotent: safe to run more than once.
create table if not exists public.nx_support_ticket_ratings (
  ticket_id uuid primary key references public.support_tickets(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  agent_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_nx_support_ticket_ratings_agent on public.nx_support_ticket_ratings (agent_user_id, created_at desc);
alter table public.nx_support_ticket_ratings enable row level security;
revoke all on public.nx_support_ticket_ratings from anon, authenticated;
grant select, insert, update, delete on public.nx_support_ticket_ratings to nexovax_api_runtime;
