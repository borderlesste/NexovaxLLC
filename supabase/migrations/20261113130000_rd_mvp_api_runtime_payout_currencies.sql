-- Sellers enable currencies on their payout destinations (request_seller_payout requires it).
GRANT INSERT, UPDATE ON public.seller_payout_account_currencies TO nexovax_api_runtime;
