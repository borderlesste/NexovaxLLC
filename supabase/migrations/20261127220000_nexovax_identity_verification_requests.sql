-- «Identidad verificada» requests (2026-11-27). Run AFTER 20261127200000_nexovax_seller_trust_levels.sql.
-- Idempotent: safe to run more than once.
--
-- Flow: the store owner sends 1–3 files (official ID of the owner, or the business's official registry)
-- from Vendedor → Configuración. Administrators (not moderators or support) review them in
-- Admin → Vendedores → Verificaciones de identidad and approve or reject with a reason.
-- Files live in the PRIVATE bucket nx-identity-documents (not in public.assets, so the generic /media
-- route can never serve them); the API streams them only to administrators and logs every view.
-- Files are deleted N days after the decision (Admin → Configuración → Seguridad, default 30);
-- the decision record (who, when, method, result) is kept.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nx-identity-documents', 'nx-identity-documents', false, 10485760, array['application/pdf','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.nx_identity_verification_requests (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  submitted_by uuid not null,
  document_type text not null check (document_type in ('GOVERNMENT_ID','BUSINESS_REGISTRY')),
  seller_note text check (seller_note is null or length(seller_note) <= 500),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  rejection_reason text check (rejection_reason is null or rejection_reason in ('ILLEGIBLE','EXPIRED','MISMATCH','INCOMPLETE','OTHER')),
  review_note text check (review_note is null or length(review_note) <= 500),
  reviewed_by uuid,
  reviewed_at timestamptz,
  files_purge_after timestamptz,
  files_purged_at timestamptz,
  created_at timestamptz not null default now(),
  constraint nx_ivr_decision_chk check ((status in ('APPROVED','REJECTED')) = (reviewed_at is not null)),
  constraint nx_ivr_reject_chk check ((status = 'REJECTED') = (rejection_reason is not null))
);
create unique index if not exists nx_ivr_one_pending on public.nx_identity_verification_requests (seller_id) where status = 'PENDING';
create index if not exists nx_ivr_seller on public.nx_identity_verification_requests (seller_id, created_at desc);
create index if not exists nx_ivr_purge on public.nx_identity_verification_requests (files_purge_after) where files_purged_at is null and files_purge_after is not null;

create table if not exists public.nx_identity_verification_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.nx_identity_verification_requests(id) on delete cascade,
  storage_key text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/webp')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists nx_ivf_request on public.nx_identity_verification_files (request_id);

-- Who opened which file and every decision (kept after the files are deleted).
create table if not exists public.nx_identity_verification_log (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.nx_identity_verification_requests(id) on delete cascade,
  file_id uuid,
  user_id uuid,
  action text not null check (action in ('SUBMIT','CANCEL','VIEW_FILE','APPROVE','REJECT','PURGE_FILES')),
  created_at timestamptz not null default now()
);
create index if not exists nx_ivl_request on public.nx_identity_verification_log (request_id, created_at);

alter table public.nx_identity_verification_requests enable row level security;
alter table public.nx_identity_verification_files enable row level security;
alter table public.nx_identity_verification_log enable row level security;
revoke all on public.nx_identity_verification_requests, public.nx_identity_verification_files, public.nx_identity_verification_log from anon, authenticated;
grant select, insert, update on public.nx_identity_verification_requests to nexovax_api_runtime;
grant select, insert, update on public.nx_identity_verification_files to nexovax_api_runtime;
grant select, insert on public.nx_identity_verification_log to nexovax_api_runtime;
