-- Verbatim from supabase/supabase docker/volumes/db/realtime.sql (self-hosting
-- reference compose, FLUX-1561). Creates the schema Realtime's Postgres
-- replication publication lives in.
\set pguser `echo "$POSTGRES_USER"`

create schema if not exists _realtime;
alter schema _realtime owner to :pguser;
