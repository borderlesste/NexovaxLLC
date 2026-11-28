-- Chat reports and moderation (2026-11-28).
-- · nx_message_reports: a buyer or a store reports a message of the other side; moderators review
--   them in Admin → Moderación → Mensajes reportados.
-- · nx_message_moderation: messages hidden by a moderator (or automatically after enough reports,
--   pending review). The message stays in the database; the chat shows «Mensaje oculto por moderación».
-- · nx_chat_blocks: a buyer blocks a store, or a store blocks a buyer: no new messages between them.
-- · nx_messaging_restrictions: a moderator stops an account from sending chat messages for some days.
-- Limits live in Admin → Configuración → Seguridad (security.controls).
-- Idempotent: safe to run more than once.

create table if not exists public.nx_message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.conversation_messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  reporter_user_id uuid not null references public.users(id) on delete cascade,
  reported_user_id uuid references public.users(id) on delete set null,
  reason text not null check (reason in ('SPAM','HARASSMENT','FRAUD','OFF_PLATFORM','INAPPROPRIATE','OTHER')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'OPEN' check (status in ('OPEN','DISMISSED','ACTION_TAKEN')),
  resolution text check (resolution is null or resolution in ('NONE','HIDE_MESSAGE','RESTRICT_USER','HIDE_AND_RESTRICT')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, reporter_user_id)
);
create index if not exists ix_nx_message_reports_status on public.nx_message_reports (status, created_at desc);
create index if not exists ix_nx_message_reports_reporter on public.nx_message_reports (reporter_user_id, created_at desc);
create index if not exists ix_nx_message_reports_reported on public.nx_message_reports (reported_user_id);

create table if not exists public.nx_message_moderation (
  message_id uuid primary key references public.conversation_messages(id) on delete cascade,
  hidden boolean not null default true,
  source text not null check (source in ('AUTO_REPORTS','MODERATOR')),
  moderated_by uuid references public.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 1000),
  updated_at timestamptz not null default now()
);

create table if not exists public.nx_chat_blocks (
  seller_id uuid not null references public.sellers(id) on delete cascade,
  customer_user_id uuid not null references public.users(id) on delete cascade,
  blocked_by text not null check (blocked_by in ('CUSTOMER','SELLER')),
  blocked_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (seller_id, customer_user_id, blocked_by)
);
create index if not exists ix_nx_chat_blocks_customer on public.nx_chat_blocks (customer_user_id);

create table if not exists public.nx_messaging_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  report_id uuid references public.nx_message_reports(id) on delete set null,
  ends_at timestamptz not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references public.users(id) on delete set null
);
create index if not exists ix_nx_messaging_restrictions_active on public.nx_messaging_restrictions (user_id, ends_at desc) where lifted_at is null;

do $$
declare t text;
begin
  foreach t in array array['nx_message_reports','nx_message_moderation','nx_chat_blocks','nx_messaging_restrictions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to nexovax_api_runtime', t);
  end loop;
end $$;

update public.system_setting_definitions
   set description = 'Seguridad: retención de fondos tras la entrega, reservas por transferencia, límites anti-abuso (recuperación de contraseña, cupones inexistentes, reportes del chat), Ofertas y retención de documentos.'
 where key = 'security.controls';
