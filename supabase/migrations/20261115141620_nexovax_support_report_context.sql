alter table public.support_tickets
  add column if not exists reported_platform text check (reported_platform is null or reported_platform in ('WEB','MOBILE','OTHER')),
  add column if not exists reported_url text check (reported_url is null or length(reported_url) <= 300),
  add column if not exists reported_client text check (reported_client is null or length(reported_client) <= 300);
create index if not exists idx_support_tickets_open_priority on public.support_tickets (status, priority_code, created_at);
