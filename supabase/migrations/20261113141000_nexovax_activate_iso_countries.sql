-- NEXOVAX sells internationally: enable every real ISO 3166-1 country.
-- User-assigned / fixture codes (Q*, ZZ, "test"/"fixture" rows) are left untouched.
UPDATE public.countries SET is_active = true, updated_at = now()
 WHERE NOT is_active
   AND alpha2 !~ '^Q' AND alpha2 <> 'ZZ'
   AND name NOT ILIKE '%test%' AND name NOT ILIKE '%fixture%';
