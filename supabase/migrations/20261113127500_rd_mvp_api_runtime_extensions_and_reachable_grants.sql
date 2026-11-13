-- Consolidated grants (also applied manually via SQL Editor while the MCP connector was unavailable).
GRANT USAGE ON SCHEMA extensions TO nexovax_api_runtime;
GRANT EXECUTE ON FUNCTION extensions.digest(text, text), extensions.digest(bytea, text) TO nexovax_api_runtime;
GRANT EXECUTE ON FUNCTION
  public.apply_shipment_delivered_quantities(uuid),
  public.publish_business_rule_version(uuid, uuid, timestamptz),
  public.seller_order_pending_ledger_balance(uuid),
  public.shipment_status_from_tracking(text),
  public.tracking_status_rank(text)
TO nexovax_api_runtime;
GRANT UPDATE ON public.seller_balance_projections, public.system_setting_values TO nexovax_api_runtime;
GRANT INSERT ON public.system_setting_history TO nexovax_api_runtime;
GRANT SELECT ON public.conversation_message_counters TO nexovax_api_runtime;
