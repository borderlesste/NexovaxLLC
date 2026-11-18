-- NEXOVAX: a partial refund made outside NEXOVAX can now be booked against the units it covered
-- (deducted from the store through the refund engine): new incident outcome REFUND_BOOKED.
alter table public.nx_payment_incidents drop constraint if exists nx_payment_incidents_outcome_check;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.nx_payment_incidents'::regclass and pg_get_constraintdef(oid) ilike '%ORDER_CANCELLED%' loop
    execute format('alter table public.nx_payment_incidents drop constraint %I', c);
  end loop;
end $$;
alter table public.nx_payment_incidents add constraint nx_payment_incidents_outcome_check
  check (outcome is null or outcome in ('WON','LOST','INQUIRY_CLOSED','ORDER_CANCELLED','REFUND_BOOKED','REVIEWED'));
