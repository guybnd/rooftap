#!/usr/bin/env bash
set -euo pipefail

# Emergency server swap, step 1 (.docs/server-swap.md): copies the household
# data out of hosted Supabase into a folder that import-to-local.sh loads into
# the self-hosted stack. Run it regularly while hosted works, so a copy exists
# when it doesn't.
#
# Usage:
#   HOSTED_DB_URL='postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres' \
#   HOSTED_SUPABASE_URL='https://<ref>.supabase.co' \
#   HOSTED_SERVICE_ROLE_KEY='<service_role key>' \
#   ./scripts/server-swap/export-hosted.sh [folder]
#
# HOSTED_DB_URL is the "Session pooler" string from the Supabase dashboard
# (Connect button). Without the two storage variables the export skips
# uploaded files. The folder defaults to server-export/<UTC time>.
#
# It writes:
#   migration.txt     the newest migration hosted has applied
#   public.dump       every row in the public schema (pg_dump, data only)
#   auth.users.jsonl, auth.identities.jsonl, storage.buckets.jsonl
#                     one JSON row per line. JSON, not pg_dump, because hosted
#                     runs newer auth and storage versions than the stack, and
#                     the loader keeps only the columns both sides have.
#   storage/          the uploaded files (storage-files.mjs)
#
# Postgres tools run in the postgres:17 image, so the host needs only Docker
# and Node. The folder holds every account's password hash and every upload:
# keep it encrypted, like any backup.

cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1

: "${HOSTED_DB_URL:?Set HOSTED_DB_URL to the hosted database connection string (see the top of this script).}"
out="${1:-server-export/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$out"

# The URL goes in as an environment variable, not an argument, so it stays
# out of the process list.
pg() {
  docker run --rm -i --network host -e PGURL="$HOSTED_DB_URL" postgres:17 sh -c "$1"
}

echo "Reading the migration version ..."
pg 'psql "$PGURL" -At -v ON_ERROR_STOP=1 -c "select max(version) from supabase_migrations.schema_migrations"' > "$out/migration.txt"
echo "hosted is at migration $(cat "$out/migration.txt")"

echo "Dumping the public schema ..."
pg 'pg_dump "$PGURL" --data-only --schema=public --format=custom' > "$out/public.dump"

for table in auth.users auth.identities storage.buckets; do
  echo "Copying $table ..."
  pg "psql \"\$PGURL\" -At -v ON_ERROR_STOP=1 -c 'select row_to_json(t) from $table t'" > "$out/$table.jsonl"
done

if [ -n "${HOSTED_SUPABASE_URL:-}" ] && [ -n "${HOSTED_SERVICE_ROLE_KEY:-}" ]; then
  echo "Copying uploaded files ..."
  SUPABASE_URL="$HOSTED_SUPABASE_URL" SERVICE_ROLE_KEY="$HOSTED_SERVICE_ROLE_KEY" \
    node scripts/server-swap/storage-files.mjs export "$out/storage"
else
  echo "warn: HOSTED_SUPABASE_URL or HOSTED_SERVICE_ROLE_KEY not set, so uploaded files were not copied." >&2
fi

echo "Export written to $out ($(wc -l < "$out/auth.users.jsonl") accounts)."
