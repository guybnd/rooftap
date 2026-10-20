-- Verbatim from supabase/supabase docker/volumes/db/jwt.sql (self-hosting
-- reference compose, FLUX-1561). Exposes JWT_SECRET/JWT_EXP as Postgres GUCs
-- so RLS policies and functions using auth.jwt()/request headers can read them.
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
