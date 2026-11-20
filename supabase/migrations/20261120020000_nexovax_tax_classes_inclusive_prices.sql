-- Market-standard tax options:
--  * reduced_rate: per-country reduced rate for products in the REDUCED tax class.
--  * prices_include_tax: listed prices already include the tax for buyers in that country
--    (EU/UK/most of Latin America); the tax is extracted instead of added on top.
--  * applies_to_shipping (already existed, now used): the shipping charge is taxed too.
--  * tax_class on categories (default) and products (override; null = category's class).
alter table public.marketplace_tax_rates
  add column if not exists reduced_rate numeric(7,6),
  add column if not exists prices_include_tax boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_marketplace_tax_rates_reduced') then
    alter table public.marketplace_tax_rates
      add constraint chk_marketplace_tax_rates_reduced check (reduced_rate is null or (reduced_rate >= 0 and reduced_rate <= rate));
  end if;
end $$;

alter table public.categories add column if not exists tax_class text not null default 'STANDARD';
alter table public.products add column if not exists tax_class text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_categories_tax_class') then
    alter table public.categories add constraint chk_categories_tax_class check (tax_class in ('STANDARD','REDUCED','EXEMPT'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_products_tax_class') then
    alter table public.products add constraint chk_products_tax_class check (tax_class is null or tax_class in ('STANDARD','REDUCED','EXEMPT'));
  end if;
end $$;

comment on column public.marketplace_tax_rates.reduced_rate is 'Rate for products in the REDUCED tax class; null = standard rate.';
comment on column public.marketplace_tax_rates.prices_include_tax is 'Listed prices include this tax for buyers in the country (tax extracted, not added).';
comment on column public.categories.tax_class is 'Default tax class of products in the category: STANDARD, REDUCED or EXEMPT.';
comment on column public.products.tax_class is 'Tax class override (STANDARD, REDUCED, EXEMPT); null = the category''s class.';
