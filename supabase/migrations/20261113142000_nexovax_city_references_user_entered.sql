-- International addresses: cities typed by buyers/sellers are registered in
-- city_references (required by the address FK/trigger) with a NEXOVAX source.
-- Catalog-imported rows keep the countries.dev provenance rule.
ALTER TABLE public.city_references DROP CONSTRAINT IF EXISTS city_references_check;
ALTER TABLE public.city_references ADD CONSTRAINT city_references_check CHECK (
  source_url = ('https://countries.dev/places/'::text || id::text)
  OR source_url = ('nexovax:address-entry/'::text || id::text)
);
