-- NEXOVAX: answering a dispute from the admin panel (evidence sent to Stripe / PayPal, or the
-- dispute accepted). Files go straight to the processor; only their names and types are kept.
create table if not exists public.nx_dispute_responses (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.nx_payment_incidents(id) on delete cascade,
  action text not null check (action in ('RESPOND','ACCEPT')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array'),
  status text not null check (status in ('SUBMITTED','FAILED')),
  provider_reference text,
  error text,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz not null default now()
);
create index if not exists idx_nx_dispute_responses_incident on public.nx_dispute_responses (incident_id, submitted_at desc);
alter table public.nx_dispute_responses enable row level security;
grant select, insert on public.nx_dispute_responses to nexovax_api_runtime;
