-- Abuse protection: bound how long a single API query (or an idle open transaction) can hold
-- one of the API's few pooled connections. Role-level defaults apply on every server session,
-- including those opened through Supabase's pooler. Revert with: alter role ... reset <setting>;
alter role nexovax_api_runtime set statement_timeout = '15s';
alter role nexovax_api_runtime set idle_in_transaction_session_timeout = '30s';
alter role nexovax_api_runtime set lock_timeout = '10s';
