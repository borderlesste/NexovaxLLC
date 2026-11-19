-- Payout release: block only while a return request is still open.
-- Before, any return_status other than NONE (including PARTIALLY_RETURNED after the
-- return was closed and refunded) blocked the rest of the seller order's funds forever.
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
        ELSIF v_policy.block_open_return AND EXISTS (
            SELECT 1 FROM public.return_requests rr
             WHERE rr.seller_order_id = v_so.id
               AND rr.status NOT IN ('REJECTED','CANCELLED','CLOSED')
        ) THEN
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
