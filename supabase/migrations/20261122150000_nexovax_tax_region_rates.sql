-- Sales tax by state / province of the shipping address (first-level division).
-- A region row overrides the rate of its country row (marketplace_tax_rates) for buyers whose
-- address is in that region. The country row still decides whether tax is charged at all
-- (is_active), whether prices include tax and the provider (STRIPE_TAX ignores region rows).
-- Seed: US statewide base rates (50 states + DC + PR) checked 2026-11-22. They are general
-- statewide rates only: city/county/district taxes and product exemptions are NOT included.
-- Every seeded row starts INACTIVE: only activate a state where NEXOVAX LLC is registered to
-- collect sales tax (physical presence in PA, or economic nexus / marketplace-facilitator rules).
create table if not exists public.marketplace_tax_region_rates (
  country_code        varchar(2) not null references public.marketplace_tax_rates(country_code) on delete cascade,
  region_code         text not null,
  region_name         text not null check (btrim(region_name) <> ''),
  tax_name            text not null check (btrim(tax_name) <> ''),
  rate                numeric(7,6) not null check (rate >= 0 and rate < 1),
  reduced_rate        numeric(7,6) check (reduced_rate is null or (reduced_rate >= 0 and reduced_rate <= rate)),
  applies_to_shipping boolean not null default false,
  is_active           boolean not null default false,
  notes               text,
  updated_by_user_id  uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (country_code, region_code),
  constraint chk_marketplace_tax_region_code check (region_code ~ '^[A-Z0-9]{1,6}$')
);
comment on table public.marketplace_tax_region_rates is
  'Tax rate by first-level division of the shipping address (US state, etc.). Overrides the country rate when active. Seeded US rates are statewide base rates only (no local taxes); confirm with a tax advisor.';
alter table public.marketplace_tax_region_rates enable row level security;
revoke all on public.marketplace_tax_region_rates from anon, authenticated;
grant select, insert, update, delete on public.marketplace_tax_region_rates to nexovax_api_runtime;

-- The US country row must exist for its states to apply (rate 0 = states without a row pay nothing).
insert into public.marketplace_tax_rates (country_code, tax_name, rate, notes)
values ('US', 'Sales tax', 0, 'US sales tax by state: see the state table. States without an active row pay 0.')
on conflict (country_code) do nothing;
update public.marketplace_tax_rates
   set notes = 'US sales tax by state: see the state table. States without an active row pay 0.'
 where country_code = 'US' and notes like 'US sales tax depends on state/locality%';

insert into public.marketplace_tax_region_rates (country_code, region_code, region_name, tax_name, rate, notes) values
  ('US', 'AL', 'Alabama', 'Sales tax', 0.04, NULL),
  ('US', 'AK', 'Alaska', 'Sales tax', 0, 'Sin impuesto estatal; algunas localidades cobran el suyo.'),
  ('US', 'AZ', 'Arizona', 'TPT', 0.056, 'TPT (privilegio de transacción); ciudades y condados suman más.'),
  ('US', 'AR', 'Arkansas', 'Sales tax', 0.065, NULL),
  ('US', 'CA', 'California', 'Sales tax', 0.0725, 'Incluye 1,25 % local obligatorio; distritos pueden sumar más.'),
  ('US', 'CO', 'Colorado', 'Sales tax', 0.029, NULL),
  ('US', 'CT', 'Connecticut', 'Sales tax', 0.0635, NULL),
  ('US', 'DE', 'Delaware', 'Sales tax', 0, NULL),
  ('US', 'FL', 'Florida', 'Sales tax', 0.06, NULL),
  ('US', 'GA', 'Georgia', 'Sales tax', 0.04, NULL),
  ('US', 'HI', 'Hawaii', 'GET', 0.04, 'GET (impuesto general al consumo); condados pueden sumar recargo.'),
  ('US', 'ID', 'Idaho', 'Sales tax', 0.06, NULL),
  ('US', 'IL', 'Illinois', 'Sales tax', 0.0625, NULL),
  ('US', 'IN', 'Indiana', 'Sales tax', 0.07, NULL),
  ('US', 'IA', 'Iowa', 'Sales tax', 0.06, NULL),
  ('US', 'KS', 'Kansas', 'Sales tax', 0.065, NULL),
  ('US', 'KY', 'Kentucky', 'Sales tax', 0.06, NULL),
  ('US', 'LA', 'Louisiana', 'Sales tax', 0.05, NULL),
  ('US', 'ME', 'Maine', 'Sales tax', 0.055, NULL),
  ('US', 'MD', 'Maryland', 'Sales tax', 0.06, NULL),
  ('US', 'MA', 'Massachusetts', 'Sales tax', 0.0625, NULL),
  ('US', 'MI', 'Michigan', 'Sales tax', 0.06, NULL),
  ('US', 'MN', 'Minnesota', 'Sales tax', 0.06875, NULL),
  ('US', 'MS', 'Mississippi', 'Sales tax', 0.07, NULL),
  ('US', 'MO', 'Missouri', 'Sales tax', 0.04225, NULL),
  ('US', 'MT', 'Montana', 'Sales tax', 0, NULL),
  ('US', 'NE', 'Nebraska', 'Sales tax', 0.055, NULL),
  ('US', 'NV', 'Nevada', 'Sales tax', 0.0685, 'Incluye componente local obligatorio; condados pueden sumar más.'),
  ('US', 'NH', 'New Hampshire', 'Sales tax', 0, NULL),
  ('US', 'NJ', 'New Jersey', 'Sales tax', 0.06625, NULL),
  ('US', 'NM', 'New Mexico', 'GRT', 0.04875, 'GRT (ingresos brutos); municipios suman más.'),
  ('US', 'NY', 'New York', 'Sales tax', 0.04, NULL),
  ('US', 'NC', 'North Carolina', 'Sales tax', 0.0475, NULL),
  ('US', 'ND', 'North Dakota', 'Sales tax', 0.05, NULL),
  ('US', 'OH', 'Ohio', 'Sales tax', 0.0575, NULL),
  ('US', 'OK', 'Oklahoma', 'Sales tax', 0.045, NULL),
  ('US', 'OR', 'Oregon', 'Sales tax', 0, NULL),
  ('US', 'PA', 'Pennsylvania', 'Sales tax', 0.06, NULL),
  ('US', 'RI', 'Rhode Island', 'Sales tax', 0.07, NULL),
  ('US', 'SC', 'South Carolina', 'Sales tax', 0.06, NULL),
  ('US', 'SD', 'South Dakota', 'Sales tax', 0.042, NULL),
  ('US', 'TN', 'Tennessee', 'Sales tax', 0.07, NULL),
  ('US', 'TX', 'Texas', 'Sales tax', 0.0625, NULL),
  ('US', 'UT', 'Utah', 'Sales tax', 0.061, '4,85 % estatal + 1 % local + 0,25 % condado; puede haber más.'),
  ('US', 'VT', 'Vermont', 'Sales tax', 0.06, NULL),
  ('US', 'VA', 'Virginia', 'Sales tax', 0.053, 'Incluye 1 % local obligatorio; algunas regiones suman más.'),
  ('US', 'WA', 'Washington', 'Sales tax', 0.065, NULL),
  ('US', 'WV', 'West Virginia', 'Sales tax', 0.06, NULL),
  ('US', 'WI', 'Wisconsin', 'Sales tax', 0.05, NULL),
  ('US', 'WY', 'Wyoming', 'Sales tax', 0.04, NULL),
  ('US', 'DC', 'District of Columbia', 'Sales tax', 0.06, 'Sube a 7 % el 1 de octubre de 2027.'),
  ('US', 'PR', 'Puerto Rico', 'IVU', 0.115, 'IVU: 10,5 % estatal + 1 % municipal (para direcciones de PR registradas como EE. UU.).')
on conflict (country_code, region_code) do nothing;
