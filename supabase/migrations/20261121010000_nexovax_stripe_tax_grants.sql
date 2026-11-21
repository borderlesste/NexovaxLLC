-- The API role could not read or write the Stripe Tax ledger ("permission denied for table
-- stripe_tax_transactions"): the 30-minute sync job failed and no tax transaction was recorded.
grant select, insert, update on table public.stripe_tax_transactions to nexovax_api_runtime;
