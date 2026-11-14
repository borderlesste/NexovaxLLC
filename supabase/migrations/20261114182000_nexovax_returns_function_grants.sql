-- Return receipt, inspection and refund processing are called by the API role.
grant execute on function public.record_return_item_receipt(uuid, bigint) to nexovax_api_runtime;
grant execute on function public.complete_return_inspection(uuid, uuid) to nexovax_api_runtime;
grant execute on function public.start_refund_processing(uuid) to nexovax_api_runtime;
