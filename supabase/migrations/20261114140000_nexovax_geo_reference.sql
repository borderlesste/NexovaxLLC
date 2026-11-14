-- Geographic reference data so country, state, city, postal code and phone agree.
-- Source: GeoNames (https://www.geonames.org, CC BY 4.0). Loaded by scripts/geo-import.mjs.

-- Country: calling code and postal-code format.
alter table public.countries
  add column if not exists phone_prefix text check (phone_prefix is null or phone_prefix ~ '^[0-9]{1,4}$'),
  add column if not exists postal_format text,
  add column if not exists postal_regex text;

-- First-level divisions (states / provinces / departments).
create table if not exists public.geo_regions (
  country_code varchar(2) not null references public.countries(alpha2) on delete cascade,
  code text not null,                      -- GeoNames admin1 code (e.g. FL, 27, 08)
  name text not null,
  ascii_name text not null,
  short_code text,                         -- carrier code when one exists (US FL, CA ON)
  geoname_id bigint,
  primary key (country_code, code)
);
create index if not exists idx_geo_regions_name on public.geo_regions (country_code, lower(ascii_name));

-- Cities: accent-free name for prefix search; GeoNames ids allowed as source.
alter table public.city_references add column if not exists ascii_name text;
alter table public.city_references drop constraint if exists city_references_check;
alter table public.city_references add constraint city_references_check check (
  source_url = 'https://countries.dev/places/' || id::text
  or source_url = 'nexovax:address-entry/' || id::text
  or source_url = 'https://www.geonames.org/' || id::text);
create index if not exists idx_city_references_search on public.city_references (country_code, lower(ascii_name) text_pattern_ops);
create index if not exists idx_city_references_region on public.city_references (country_code, admin1_code, population desc);

-- Postal codes → place, state (suggestions only).
create table if not exists public.geo_postal_codes (
  id bigserial primary key,
  country_code varchar(2) not null references public.countries(alpha2) on delete cascade,
  postal_code text not null,
  place_name text not null,
  region_name text,
  region_code text
);
create index if not exists idx_geo_postal_lookup on public.geo_postal_codes (country_code, postal_code);

alter table public.geo_regions enable row level security;
alter table public.geo_postal_codes enable row level security;

grant select on public.geo_regions, public.geo_postal_codes to nexovax_api_runtime;
-- Temporary, for the one-off import (revoked by 20261114141000_nexovax_geo_reference_lock).
grant insert, update, delete on public.geo_regions, public.geo_postal_codes to nexovax_api_runtime;
grant usage on sequence public.geo_postal_codes_id_seq to nexovax_api_runtime;
grant update (phone_prefix, postal_format, postal_regex) on public.countries to nexovax_api_runtime;
grant update (ascii_name) on public.city_references to nexovax_api_runtime;
