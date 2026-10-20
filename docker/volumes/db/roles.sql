-- Verbatim from supabase/supabase docker/volumes/db/roles.sql (self-hosting
-- reference compose, FLUX-1561). The supabase/postgres image ships these
-- roles pre-created; this just points their passwords at our POSTGRES_PASSWORD
-- so auth/rest/functions/storage (which connect as these roles) can log in.
-- NOTE: change to your own passwords for production environments
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
