-- Unspecified condition and size guides remain empty for existing listings.
alter table public.products
  add column if not exists item_condition text check (item_condition in ('NEW', 'USED')),
  add column if not exists size_guide text check (char_length(size_guide) <= 3000);
