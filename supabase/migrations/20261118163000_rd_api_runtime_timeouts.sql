-- The API logs in as rd_api_runtime, which inherits its privileges from the NOLOGIN group role
-- nexovax_api_runtime. Role settings (ALTER ROLE ... SET) are not inherited through membership,
-- so the limits of 20261118132319 must be set on the login role to take effect.
-- Revert with: alter role rd_api_runtime reset <setting>;
alter role rd_api_runtime set statement_timeout = '15s';
alter role rd_api_runtime set idle_in_transaction_session_timeout = '30s';
alter role rd_api_runtime set lock_timeout = '10s';
