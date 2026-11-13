-- RD Marketplace MVP: reviewed domain functions (pricing rule-set hash, audit
-- record hashes, citext emails) reference objects in schema "extensions".
-- SECURITY INVOKER functions need the caller to have USAGE on that schema.
GRANT USAGE ON SCHEMA extensions TO nexovax_api_runtime;
GRANT EXECUTE ON FUNCTION extensions.digest(text, text), extensions.digest(bytea, text) TO nexovax_api_runtime;
