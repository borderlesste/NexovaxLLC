alter table public.payment_disputes drop constraint if exists chk_payment_disputes_external;
alter table public.payment_disputes add constraint chk_payment_disputes_external check (
  (provider_code <> 'PAYPAL' and external_dispute_id ~ '^(du|dp)_[A-Za-z0-9]+$' and external_charge_id ~ '^(ch|py)_[A-Za-z0-9]+$')
  or (provider_code = 'PAYPAL' and external_dispute_id ~ '^PP-[A-Z0-9-]{3,60}$' and external_charge_id ~ '^[A-Z0-9]{8,40}$'));

create table if not exists public.nx_payment_incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('DISPUTE','EXTERNAL_REFUND','PROVIDER_REVERSAL')),
  provider_code text not null check (provider_code in ('STRIPE','PAYPAL')),
  environment text not null check (environment in ('TEST','LIVE')),
  external_id text not null check (btrim(external_id) <> '' and length(external_id) <= 120),
  payment_id uuid not null references public.payments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  dispute_id uuid references public.payment_disputes(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  currency_code varchar(3) not null references public.currencies(code),
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  provider_status text,
  reason text,
  due_by timestamptz,
  outcome text check (outcome is null or outcome in ('WON','LOST','INQUIRY_CLOSED','ORDER_CANCELLED','REVIEWED')),
  last_error text,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 500),
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_code, environment, kind, external_id),
  check ((status = 'RESOLVED') = (resolved_at is not null and outcome is not null))
);
create index if not exists idx_nx_payment_incidents_open on public.nx_payment_incidents (status, created_at desc);
create index if not exists idx_nx_payment_incidents_order on public.nx_payment_incidents (order_id) where status = 'OPEN';
alter table public.nx_payment_incidents enable row level security;
grant select, insert, update on public.nx_payment_incidents to nexovax_api_runtime;

CREATE OR REPLACE FUNCTION public.record_payment_dispute_evidence(p_evidence jsonb, p_correlation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_provider TEXT := p_evidence->>'provider'; v_env TEXT := p_evidence->>'environment';
    v_external TEXT := p_evidence->>'disputeId'; v_charge TEXT := p_evidence->>'chargeId';
    v_provider_status TEXT := p_evidence->>'status'; v_currency TEXT := p_evidence->>'currencyCode';
    v_status TEXT; ch RECORD; p public.payments%ROWTYPE; d public.payment_disputes%ROWTYPE; v_dp INTEGER; v_amount NUMERIC;
    t JSONB; v_txn TEXT; v_kind TEXT; v_principal NUMERIC; v_fee NUMERIC; v_treatment TEXT; v_batch UUID; v_resolved BOOLEAN;
    v_pw NUMERIC; v_pr NUMERIC; v_fw NUMERIC; v_fr NUMERIC; v_holding TEXT; v_meta JSONB; v_recorded INTEGER := 0;
    v_prior public.payment_dispute_balance_transactions%ROWTYPE;
BEGIN
    IF p_correlation IS NULL THEN RAISE EXCEPTION 'CHARGEBACK_CORRELATION_REQUIRED' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR COALESCE(v_provider, '') NOT IN ('STRIPE', 'PAYPAL') OR v_env NOT IN ('TEST', 'LIVE')
       OR (v_provider = 'STRIPE' AND (v_external !~ '^(du|dp)_[A-Za-z0-9]+$' OR v_charge !~ '^(ch|py)_[A-Za-z0-9]+$'))
       OR (v_provider = 'PAYPAL' AND (v_external !~ '^PP-[A-Z0-9-]{3,60}$' OR v_charge !~ '^[A-Z0-9]{8,40}$')) OR v_currency !~ '^[A-Z]{3}$'
       OR (p_evidence->>'amountMinor') !~ '^[1-9][0-9]{0,17}$' OR jsonb_typeof(p_evidence->'balanceTransactions') IS DISTINCT FROM 'array'
       OR (p_evidence->>'reason' IS NOT NULL AND p_evidence->>'reason' !~ '^[a-z][a-z0-9_]{0,63}$') THEN
        RAISE EXCEPTION 'CHARGEBACK_EVIDENCE_INVALID' USING ERRCODE = '22023';
    END IF;
    v_status := CASE v_provider_status
        WHEN 'warning_needs_response' THEN 'INQUIRY_OPEN' WHEN 'warning_under_review' THEN 'INQUIRY_OPEN'
        WHEN 'warning_closed' THEN 'INQUIRY_CLOSED' WHEN 'needs_response' THEN 'OPEN' WHEN 'under_review' THEN 'UNDER_REVIEW'
        WHEN 'won' THEN 'WON' WHEN 'lost' THEN 'LOST' END;
    IF v_status IS NULL THEN RAISE EXCEPTION 'CHARGEBACK_PROVIDER_STATUS_UNSUPPORTED' USING ERRCODE = '22023'; END IF;
    SELECT c.id, c.payment_id INTO ch FROM public.payment_charges c
     WHERE c.provider_code = v_provider AND c.environment = v_env AND c.external_charge_id = v_charge;
    IF NOT FOUND THEN RAISE EXCEPTION 'CHARGEBACK_PAYMENT_NOT_FOUND' USING ERRCODE = '40001'; END IF;
    SELECT * INTO p FROM public.payments WHERE id = ch.payment_id;
    IF p.order_id IS NULL THEN RAISE EXCEPTION 'CHARGEBACK_PAYMENT_NOT_FOUND' USING ERRCODE = '40001'; END IF;
    PERFORM public.lock_referral_financial_orders(ARRAY[p.order_id]);
    SELECT * INTO p FROM public.payments WHERE id = ch.payment_id;
    SELECT decimal_places INTO v_dp FROM public.currencies WHERE code = p.currency_code FOR SHARE;
    IF p.provider_code <> v_provider OR p.environment <> v_env THEN
        RAISE EXCEPTION 'CHARGEBACK_EVIDENCE_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    -- OD (currency): no implicit FX between payment, dispute and balance transaction currencies.
    IF v_currency <> p.currency_code THEN RAISE EXCEPTION 'CHARGEBACK_CURRENCY_MISMATCH' USING ERRCODE = '23514'; END IF;
    v_amount := public.chargeback_major((p_evidence->>'amountMinor')::NUMERIC, v_dp);
    IF v_amount > p.captured_amount THEN RAISE EXCEPTION 'CHARGEBACK_AMOUNT_EXCEEDS_CAPTURED' USING ERRCODE = '23514'; END IF;

    SELECT * INTO d FROM public.payment_disputes
     WHERE provider_code = v_provider AND environment = v_env AND external_dispute_id = v_external FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO public.payment_disputes (payment_id, order_id, payment_charge_id, provider_code, environment, external_dispute_id,
            external_charge_id, currency_code, disputed_amount, reason_code, provider_status, status, provider_created_at, correlation_id)
        VALUES (p.id, p.order_id, ch.id, v_provider, v_env, v_external, v_charge, v_currency, v_amount, p_evidence->>'reason',
            v_provider_status, v_status, (p_evidence->>'createdAt')::TIMESTAMPTZ, p_correlation)
        RETURNING * INTO d;
    ELSE
        IF d.payment_id <> p.id OR d.external_charge_id <> v_charge OR d.currency_code <> v_currency OR d.disputed_amount <> v_amount THEN
            RAISE EXCEPTION 'CHARGEBACK_DISPUTE_IDENTITY_CHANGED' USING ERRCODE = '23514';
        END IF;
        -- #39 (OD-9): once the economic outcome is posted the header outcome is final; the provider status (e.g. a lost
        -- dispute the provider later reverses) is still recorded and its movements go to OD-8 suspense.
        IF EXISTS (SELECT 1 FROM public.payment_dispute_resolutions WHERE dispute_id = d.id) THEN v_status := d.status; END IF;
        IF d.status <> v_status OR d.provider_status <> v_provider_status THEN
            UPDATE public.payment_disputes SET status = v_status, provider_status = v_provider_status, correlation_id = p_correlation,
                   updated_at = CURRENT_TIMESTAMP WHERE id = d.id RETURNING * INTO d;
        END IF;
    END IF;
    v_resolved := EXISTS (SELECT 1 FROM public.payment_dispute_resolutions WHERE dispute_id = d.id);
    PERFORM public.lock_referral_ledger_accounts(jsonb_build_array(
        jsonb_build_object('code', 'PROCESSOR_CLEARING', 'currency', p.currency_code),
        jsonb_build_object('code', 'CHARGEBACK_DISPUTE_RECEIVABLE', 'currency', p.currency_code),
        jsonb_build_object('code', 'CHARGEBACK_RECONCILIATION_REQUIRED', 'currency', p.currency_code)));

    FOR t IN SELECT x FROM jsonb_array_elements(p_evidence->'balanceTransactions') x
              ORDER BY x->>'createdAt' NULLS FIRST, x->>'kind' = 'FUNDS_REINSTATED', x->>'id' LOOP
        v_txn := t->>'id'; v_kind := t->>'kind';
        IF v_txn !~ '^txn_[A-Za-z0-9]+$' OR v_kind NOT IN ('FUNDS_WITHDRAWN', 'FUNDS_REINSTATED')
           OR (t->>'principalMinor') !~ '^(0|[1-9][0-9]{0,17})$' OR (t->>'feeMinor') !~ '^(0|[1-9][0-9]{0,17})$'
           OR (t->>'currencyCode') !~ '^[A-Z]{3}$' THEN
            RAISE EXCEPTION 'CHARGEBACK_EVIDENCE_INVALID' USING ERRCODE = '22023';
        END IF;
        IF t->>'currencyCode' <> p.currency_code THEN RAISE EXCEPTION 'CHARGEBACK_CURRENCY_MISMATCH' USING ERRCODE = '23514'; END IF;
        v_principal := public.chargeback_major((t->>'principalMinor')::NUMERIC, v_dp);
        v_fee := public.chargeback_major((t->>'feeMinor')::NUMERIC, v_dp);
        IF v_principal + v_fee <= 0 THEN RAISE EXCEPTION 'CHARGEBACK_EVIDENCE_INVALID' USING ERRCODE = '22023'; END IF;
        SELECT * INTO v_prior FROM public.payment_dispute_balance_transactions
         WHERE provider_code = v_provider AND environment = v_env AND external_balance_transaction_id = v_txn;
        IF FOUND THEN
            -- Provider identity, not time: the same movement produces exactly one economic effect.
            IF v_prior.dispute_id <> d.id OR v_prior.movement_type <> v_kind OR v_prior.principal_amount <> v_principal
               OR v_prior.fee_amount <> v_fee THEN
                RAISE EXCEPTION 'CHARGEBACK_EVIDENCE_CHANGED' USING ERRCODE = '23514';
            END IF;
            CONTINUE;
        END IF;
        v_treatment := CASE WHEN v_resolved THEN 'RECONCILIATION_REQUIRED' ELSE 'PROVISIONAL' END;
        IF v_kind = 'FUNDS_REINSTATED' AND v_treatment = 'PROVISIONAL' THEN
            SELECT COALESCE(sum(principal_amount) FILTER (WHERE movement_type = 'FUNDS_WITHDRAWN'), 0),
                   COALESCE(sum(principal_amount) FILTER (WHERE movement_type = 'FUNDS_REINSTATED'), 0),
                   COALESCE(sum(fee_amount) FILTER (WHERE movement_type = 'FUNDS_WITHDRAWN'), 0),
                   COALESCE(sum(fee_amount) FILTER (WHERE movement_type = 'FUNDS_REINSTATED'), 0)
              INTO v_pw, v_pr, v_fw, v_fr
              FROM public.payment_dispute_balance_transactions WHERE dispute_id = d.id AND accounting_treatment = 'PROVISIONAL';
            IF v_pr + v_principal > v_pw OR v_fr + v_fee > v_fw THEN
                RAISE EXCEPTION 'CHARGEBACK_REINSTATEMENT_EXCEEDS_WITHDRAWAL' USING ERRCODE = '23514';
            END IF;
        END IF;
        v_holding := CASE WHEN v_treatment = 'PROVISIONAL' THEN 'CHARGEBACK_DISPUTE_RECEIVABLE' ELSE 'CHARGEBACK_RECONCILIATION_REQUIRED' END;
        v_meta := jsonb_build_object('contract', 'CHARGEBACK_ACCOUNTING_1', 'authority', 'OWNER_DECISION_CHARGEBACK_ACCOUNTING_2026_10_08',
            'disputeId', d.id, 'externalDisputeId', d.external_dispute_id, 'externalBalanceTransactionId', v_txn,
            'movement', v_kind, 'treatment', v_treatment, 'principal', v_principal, 'fee', v_fee);
        INSERT INTO public.ledger_batches (batch_type, currency_code, source_type, source_id, idempotency_key, payment_id, order_id,
            correlation_id, description, metadata)
        VALUES (CASE v_kind WHEN 'FUNDS_WITHDRAWN' THEN 'CHARGEBACK_FUNDS_WITHDRAWN' ELSE 'CHARGEBACK_FUNDS_REINSTATED' END,
            p.currency_code, 'PAYMENT_DISPUTE', d.id, 'CHARGEBACK_' || v_kind || ':' || v_provider || ':' || v_env || ':' || v_txn,
            p.id, p.order_id, p_correlation,
            CASE v_kind WHEN 'FUNDS_WITHDRAWN' THEN 'Provider dispute debit held provisionally' ELSE 'Provider dispute credit' END, v_meta)
        RETURNING id INTO v_batch;
        IF v_kind = 'FUNDS_WITHDRAWN' THEN
            IF v_principal > 0 THEN
                PERFORM public.chargeback_add_entry(v_batch, v_holding, p.currency_code, NULL, 'DEBIT', v_principal, 'dispute_principal',
                    NULL, 'Disputed principal withdrawn by the provider', v_meta || jsonb_build_object('component', 'CHARGEBACK_PRINCIPAL'));
            END IF;
            IF v_fee > 0 THEN
                PERFORM public.chargeback_add_entry(v_batch, v_holding, p.currency_code, NULL, 'DEBIT', v_fee, 'dispute_fee',
                    NULL, 'Dispute fee withdrawn by the provider', v_meta || jsonb_build_object('component', 'CHARGEBACK_FEE'));
            END IF;
            PERFORM public.chargeback_add_entry(v_batch, 'PROCESSOR_CLEARING', p.currency_code, NULL, 'CREDIT', v_principal + v_fee,
                'provider_dispute_debit', NULL, 'Provider balance debited for the dispute', v_meta);
        ELSE
            PERFORM public.chargeback_add_entry(v_batch, 'PROCESSOR_CLEARING', p.currency_code, NULL, 'DEBIT', v_principal + v_fee,
                'provider_dispute_credit', NULL, 'Provider balance credited for the dispute', v_meta);
            IF v_principal > 0 THEN
                PERFORM public.chargeback_add_entry(v_batch, v_holding, p.currency_code, NULL, 'CREDIT', v_principal, 'dispute_principal',
                    NULL, 'Disputed principal reinstated by the provider', v_meta || jsonb_build_object('component', 'CHARGEBACK_PRINCIPAL'));
            END IF;
            IF v_fee > 0 THEN
                PERFORM public.chargeback_add_entry(v_batch, v_holding, p.currency_code, NULL, 'CREDIT', v_fee, 'dispute_fee',
                    NULL, 'Dispute fee returned by the provider', v_meta || jsonb_build_object('component', 'CHARGEBACK_FEE'));
            END IF;
        END IF;
        PERFORM public.post_ledger_batch(v_batch);
        INSERT INTO public.payment_dispute_balance_transactions (dispute_id, payment_id, provider_code, environment,
            external_balance_transaction_id, movement_type, principal_amount, fee_amount, currency_code, accounting_treatment,
            ledger_batch_id, provider_created_at, evidence, correlation_id)
        VALUES (d.id, p.id, v_provider, v_env, v_txn, v_kind, v_principal, v_fee, p.currency_code, v_treatment, v_batch,
            (t->>'createdAt')::TIMESTAMPTZ, jsonb_build_object('principalMinor', t->>'principalMinor', 'feeMinor', t->>'feeMinor',
            'currencyCode', t->>'currencyCode', 'reportingCategory', t->>'reportingCategory'), p_correlation);
        v_recorded := v_recorded + 1;
    END LOOP;
    PERFORM public.chargeback_sync_operational_status(d.id);
    RETURN jsonb_build_object('disputeId', d.id, 'paymentId', p.id, 'orderId', p.order_id, 'status', d.status,
        'recorded', v_recorded, 'resolved', v_resolved, 'final', d.status IN ('WON', 'LOST'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_payout_eligibility(p_eligibility_record_id uuid, p_as_of timestamp with time zone DEFAULT CURRENT_TIMESTAMP)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_rec public.payout_eligibility_records%ROWTYPE;
    v_so public.seller_orders%ROWTYPE;
    v_seller_status TEXT;
    v_policy public.payout_policy_definitions%ROWTYPE;
    v_delivered_at TIMESTAMPTZ;
    v_trigger_at TIMESTAMPTZ;
    v_hold_until TIMESTAMPTZ;
    v_status TEXT;
    v_block_reason TEXT;
BEGIN
    SELECT * INTO v_rec
      FROM public.payout_eligibility_records
     WHERE id = p_eligibility_record_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PAYOUT_ELIGIBILITY_RECORD_NOT_FOUND'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_rec.status IN ('RELEASED','CANCELLED') THEN
        RETURN v_rec.status;
    END IF;

    SELECT * INTO v_so
      FROM public.seller_orders
     WHERE id = v_rec.seller_order_id
     FOR SHARE;

    SELECT status INTO v_seller_status
      FROM public.sellers
     WHERE id = v_rec.seller_id;

    SELECT * INTO v_policy
      FROM public.payout_policy_definitions
     WHERE rule_version_id = v_rec.payout_policy_rule_version_id;

    v_trigger_at := v_rec.trigger_occurred_at;

    IF v_trigger_at IS NULL AND v_rec.release_trigger_code = 'DELIVERED' THEN
        SELECT max(delivered_at)
          INTO v_delivered_at
          FROM public.shipments
         WHERE seller_order_id = v_so.id
           AND status = 'DELIVERED';

        IF v_so.fulfillment_status IN ('DELIVERED','PARTIALLY_RETURNED','RETURNED')
           AND v_delivered_at IS NOT NULL THEN
            v_trigger_at := v_delivered_at;
        END IF;
    ELSIF v_trigger_at IS NULL AND v_rec.release_trigger_code = 'SELLER_ORDER_COMPLETED' THEN
        IF v_so.lifecycle_status IN ('COMPLETED','CLOSED') THEN
            v_trigger_at := COALESCE(v_so.completed_at, v_so.closed_at, v_so.updated_at);
        END IF;
    END IF;

    IF v_trigger_at IS NULL THEN
        v_status := 'PENDING_TRIGGER';
        v_hold_until := NULL;
        v_block_reason := NULL;
    ELSE
        v_hold_until := v_trigger_at + make_interval(secs => v_policy.hold_period_seconds::DOUBLE PRECISION);

        IF v_policy.require_seller_active AND v_seller_status <> 'ACTIVE' THEN
            v_status := 'BLOCKED';
            v_block_reason := 'SELLER_NOT_ACTIVE';
        ELSIF v_policy.block_open_return AND v_so.return_status <> 'NONE' THEN
            v_status := 'BLOCKED';
            v_block_reason := 'OPEN_RETURN';
        ELSIF v_policy.block_open_dispute AND v_so.dispute_status IN ('OPEN','ACTION_REQUIRED','UNDER_REVIEW') THEN
            v_status := 'BLOCKED';
            v_block_reason := 'OPEN_DISPUTE';
        ELSIF EXISTS (SELECT 1 FROM public.nx_payment_incidents i WHERE i.order_id = v_so.order_id AND i.status = 'OPEN') THEN
            -- NEXOVAX: a dispute or a refund made outside NEXOVAX is waiting for an admin.
            v_status := 'BLOCKED';
            v_block_reason := 'PAYMENT_INCIDENT';
        ELSIF v_hold_until > p_as_of THEN
            v_status := 'HOLDING';
            v_block_reason := NULL;
        ELSE
            v_status := 'ELIGIBLE';
            v_block_reason := NULL;
        END IF;
    END IF;

    UPDATE public.payout_eligibility_records
       SET trigger_occurred_at = v_trigger_at,
           hold_until = v_hold_until,
           status = v_status,
           block_reason_code = v_block_reason,
           evaluated_at = p_as_of
     WHERE id = v_rec.id;

    RETURN v_status;
END;
$function$;
