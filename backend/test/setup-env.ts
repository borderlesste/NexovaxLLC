// auth.ts builds the Supabase JWKS URL at import time; tests never contact it.
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
