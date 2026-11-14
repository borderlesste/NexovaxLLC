-- Configurable return policies (marketplace + per store), prepaid return labels and
-- attachments on support internal notes.

-- New return policy versions are created by the API (admin / store settings).
grant insert on public.return_policy_rule_definitions to nexovax_api_runtime;

-- Prepaid return label bought through Shippo for an approved return.
create table if not exists public.nx_return_labels (
  return_request_id uuid primary key references public.return_requests(id) on delete restrict,
  provider_code text not null check (provider_code ~ '^[A-Z][A-Z0-9_]*$'),
  provider_transaction_id text not null unique,
  carrier text not null,
  service text,
  tracking_number text not null,
  tracking_url text,
  label_url text not null,
  cost_amount numeric(20,2) not null check (cost_amount >= 0),
  currency_code varchar(3) not null references public.currencies(code),
  payer text not null check (payer in ('STORE', 'MARKETPLACE')),
  ledger_batch_id uuid references public.ledger_batches(id),
  test_mode boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.nx_return_labels enable row level security;
grant select, insert on public.nx_return_labels to nexovax_api_runtime;

-- Internal notes can carry files (screenshots, documents) visible only to staff.
grant select, insert on public.support_internal_note_attachments to nexovax_api_runtime;
