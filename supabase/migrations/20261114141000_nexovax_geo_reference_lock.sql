-- After the GeoNames import (scripts/geo-import.mjs): the API only reads reference data.
-- To re-import, re-grant these temporarily (see 20261114140000_nexovax_geo_reference.sql).
revoke insert, update, delete on public.geo_regions, public.geo_postal_codes from nexovax_api_runtime;
revoke usage on sequence public.geo_postal_codes_id_seq from nexovax_api_runtime;
revoke update (phone_prefix, postal_format, postal_regex) on public.countries from nexovax_api_runtime;
revoke update (ascii_name) on public.city_references from nexovax_api_runtime;
