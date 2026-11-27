-- One bounded, private portrait per owner. Keeping it with the crop makes replacement atomic.
create table public.nx_welcome_badges (
  user_id uuid primary key references public.users(id) on delete cascade,
  public_name text not null check (char_length(btrim(public_name)) between 1 and 64),
  zoom double precision not null check (zoom between 1 and 3),
  x double precision not null check (x between -1 and 1),
  y double precision not null check (y between -1 and 1),
  photo bytea not null check (octet_length(photo) between 1 and 2097152)
);

alter table public.nx_welcome_badges enable row level security;
revoke all on public.nx_welcome_badges from public, anon, authenticated;
grant select, insert, update on public.nx_welcome_badges to nexovax_api_runtime;
create policy nx_welcome_badge_api on public.nx_welcome_badges to nexovax_api_runtime using (true) with check (true);

-- Account deletion can retain an anonymized user row for financial history.
create function public.nx_clear_closed_welcome_badge() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  delete from public.nx_welcome_badges where user_id = new.id;
  return new;
end;
$$;

create trigger nx_clear_closed_welcome_badge
after update of status on public.users
for each row when (new.status = 'CLOSED' and new.status is distinct from old.status)
execute function public.nx_clear_closed_welcome_badge();

revoke execute on function public.nx_clear_closed_welcome_badge() from public, anon, authenticated;
