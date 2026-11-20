-- Product search that ignores accents and case and tolerates typos (pg_trgm is already installed).
create extension if not exists unaccent with schema extensions;

-- Immutable wrapper so it can be used in indexes: lower-case text without accents.
create or replace function public.nx_search_norm(v text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(v, ''))) $$;

comment on function public.nx_search_norm(text) is 'Search key: lower case without accents (used by the catalog search and its trigram indexes).';

create index if not exists idx_products_title_search_trgm on public.products using gin (public.nx_search_norm(title) extensions.gin_trgm_ops);
create index if not exists idx_products_short_description_search_trgm on public.products using gin (public.nx_search_norm(short_description) extensions.gin_trgm_ops);

grant execute on function public.nx_search_norm(text) to nexovax_api_runtime;
