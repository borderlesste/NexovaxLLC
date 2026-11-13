-- RD Marketplace MVP: explicit privileges the API runtime needs to execute the
-- reviewed domain functions for fulfillment, tracking, fund release, payouts and
-- seller catalog editing. Grants are object-specific (no schema-wide defaults);
-- browser roles (anon/authenticated) are unchanged.

-- Catalog editing
GRANT DELETE ON public.variant_option_assignments TO nexovax_api_runtime;
GRANT UPDATE ON public.product_options, public.product_option_values, public.product_seo TO nexovax_api_runtime;

-- Roles administration (revocation is an UPDATE of revoked_at)
GRANT UPDATE ON public.user_roles TO nexovax_api_runtime;

-- Seller payout destinations (ciphertext only)
GRANT INSERT, UPDATE ON public.seller_payout_accounts TO nexovax_api_runtime;

-- Fulfillment and shipping execution
GRANT SELECT, INSERT ON public.fulfillments, public.fulfillment_items, public.shipments,
                        public.shipment_packages, public.shipment_package_items,
                        public.shipment_address_snapshots TO nexovax_api_runtime;
GRANT UPDATE ON public.fulfillment_items TO nexovax_api_runtime;
GRANT SELECT ON public.fulfillment_status_history TO nexovax_api_runtime;
GRANT SELECT, INSERT ON public.tracking_events TO nexovax_api_runtime;
GRANT UPDATE ON public.shipment_trackings TO nexovax_api_runtime;

-- Payout eligibility, release and payout execution evidence
GRANT INSERT, UPDATE ON public.payout_eligibility_records TO nexovax_api_runtime;
GRANT SELECT, INSERT, UPDATE ON public.seller_reserve_release_records TO nexovax_api_runtime;
GRANT INSERT, UPDATE ON public.payout_attempts TO nexovax_api_runtime;
GRANT INSERT ON public.payout_provider_event_records TO nexovax_api_runtime;
GRANT UPDATE ON public.payout_approval_decisions TO nexovax_api_runtime;

-- Payment attempt evidence (failures) and history reads
GRANT INSERT, UPDATE ON public.payment_attempts TO nexovax_api_runtime;
GRANT SELECT ON public.inventory_reservation_history TO nexovax_api_runtime;

-- Notifications (in-app)
GRANT INSERT, UPDATE ON public.notifications TO nexovax_api_runtime;

-- Domain functions
GRANT EXECUTE ON FUNCTION
  public.apply_tracking_event(uuid, text, text, timestamptz, text, text, text, text, text, text, varchar, text, uuid, jsonb),
  public.confirm_fulfillment(uuid),
  public.ensure_payout_eligibility_record(uuid, uuid, timestamptz),
  public.evaluate_payout_eligibility(uuid, timestamptz),
  public.release_eligible_seller_order_funds(uuid, uuid, uuid, timestamptz),
  public.order_display_status(uuid),
  public.seller_available_balance(uuid, varchar),
  public.mark_payment_requires_action(uuid, uuid, uuid),
  public.record_payment_attempt_failure(uuid, uuid, text, text, text, text, boolean, uuid),
  public.cancel_unpaid_payment(uuid, text, uuid, uuid),
  public.begin_payout_processing(uuid, text, uuid, timestamptz),
  public.record_payout_provider_submission(uuid, text, text, jsonb, timestamptz),
  public.confirm_payout_paid(uuid, uuid, uuid, numeric, numeric, numeric, uuid, uuid, timestamptz),
  public.fail_payout_processing(uuid, uuid, text, text, timestamptz),
  public.publish_business_rule_version(uuid, uuid, timestamptz, text, text, uuid)
TO nexovax_api_runtime;
