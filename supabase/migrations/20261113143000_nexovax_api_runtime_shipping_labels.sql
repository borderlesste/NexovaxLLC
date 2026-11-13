-- Shippo label purchase through the domain functions.
GRANT EXECUTE ON FUNCTION public.request_shipping_label(uuid, text, text, text, uuid, uuid) TO nexovax_api_runtime;
GRANT EXECUTE ON FUNCTION public.mark_shipping_label_purchased(uuid, text, text, numeric, character varying, text, text, text, text, text, text, text, uuid, text, timestamp with time zone) TO nexovax_api_runtime;
GRANT INSERT, UPDATE ON public.shipping_labels TO nexovax_api_runtime;
GRANT INSERT ON public.shipment_cost_events TO nexovax_api_runtime;
