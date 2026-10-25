-- Emergency server swap (.docs/server-swap.md): run by import-to-local.sh in
-- one transaction, before the public data from the export's pg_dump.
-- Empties the public, auth and storage schemas (minus the services' own
-- migration bookkeeping), then loads accounts and buckets from the JSON rows.

SET session_replication_role = replica;

DO $$
DECLARE t text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO t
    FROM pg_tables
   WHERE schemaname IN ('public', 'auth', 'storage')
     AND (schemaname, tablename) NOT IN (('auth', 'schema_migrations'), ('storage', 'migrations'));
  EXECUTE 'TRUNCATE ' || t || ' CASCADE';
END $$;

-- Inserts one JSON row per line of `path` into `target`, using only the
-- columns that both the export and this table have. Hosted runs newer auth
-- and storage versions, so it can have columns this stack lacks, and this
-- stack can have columns hosted lacks (they take their defaults). Generated
-- columns are skipped, since Postgres computes them.
CREATE FUNCTION pg_temp.load_jsonl(target regclass, path text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  cols text;
  sel text;
  n bigint;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS swap_rows (j jsonb);
  TRUNCATE swap_rows;
  -- CSV with quote and delimiter bytes that JSON never holds, so each line
  -- arrives as is (text format would unescape the JSON's backslashes).
  EXECUTE format('COPY swap_rows (j) FROM %L WITH (FORMAT csv, QUOTE E''\x01'', DELIMITER E''\x02'')', path);
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
         string_agg('r.' || quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO cols, sel
    FROM pg_attribute a
   WHERE a.attrelid = target AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND EXISTS (SELECT 1 FROM swap_rows WHERE swap_rows.j ? a.attname);
  IF cols IS NULL THEN
    RETURN 0;
  END IF;
  EXECUTE format(
    'INSERT INTO %s (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM swap_rows, jsonb_populate_record(NULL::%s, swap_rows.j) r',
    target, cols, sel, target);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '% rows into %', n, target;
  RETURN n;
END $$;

SELECT pg_temp.load_jsonl('auth.users', '/tmp/swap/auth.users.jsonl');
SELECT pg_temp.load_jsonl('auth.identities', '/tmp/swap/auth.identities.jsonl');
SELECT pg_temp.load_jsonl('storage.buckets', '/tmp/swap/storage.buckets.jsonl');
