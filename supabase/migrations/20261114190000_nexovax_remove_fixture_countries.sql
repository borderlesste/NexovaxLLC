-- Synthetic countries left by old schema fixtures (never shown to users, unreferenced).
delete from public.geo_postal_codes where country_code in ('QB','QF','QH','QP','QT','QZ','ZZ');
delete from public.geo_regions where country_code in ('QB','QF','QH','QP','QT','QZ','ZZ');
delete from public.city_references where country_code in ('QB','QF','QH','QP','QT','QZ','ZZ');
delete from public.countries where alpha2 in ('QB','QF','QH','QP','QT','QZ','ZZ')
  and (name ilike '%test%' or name ilike '%fixture%');
