-- Seller reply tools (2026-11-28): saved replies and an automatic reply outside store hours.
-- · nx_seller_saved_replies: short answers a store reuses in the chat (Mensajes → Respuestas).
-- · nx_seller_auto_reply: the store's automatic reply, its hours (in the store's time zone) and mode.
-- · nx_auto_reply_messages: automatic replies already sent, to label them in the chat and send at most
--   one per conversation within the interval set in Admin → Configuración → Seguridad.
-- Idempotent: safe to run more than once.

create table if not exists public.nx_seller_saved_replies (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 2000),
  sort_order int not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_nx_seller_saved_replies_seller on public.nx_seller_saved_replies (seller_id, sort_order, created_at);

create table if not exists public.nx_seller_auto_reply (
  seller_id uuid primary key references public.sellers(id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'OUTSIDE_HOURS' check (mode in ('OUTSIDE_HOURS','ALWAYS')),
  message text not null default '' check (char_length(message) <= 1000),
  hours jsonb not null default '[]'::jsonb check (jsonb_typeof(hours) = 'array'),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nx_auto_reply_messages (
  message_id uuid primary key references public.conversation_messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sent_at timestamptz not null default now()
);
create index if not exists ix_nx_auto_reply_messages_conv on public.nx_auto_reply_messages (conversation_id, sent_at desc);

do $$
declare t text;
begin
  foreach t in array array['nx_seller_saved_replies','nx_seller_auto_reply','nx_auto_reply_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to nexovax_api_runtime', t);
  end loop;
end $$;
