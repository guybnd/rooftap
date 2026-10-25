#!/usr/bin/env bash
set -euo pipefail

# Emergency server swap, step 2 (.docs/server-swap.md): loads a folder from
# export-hosted.sh into this self-hosted stack. It REPLACES every row in the
# stack's public, auth and storage schemas, so run it on a new install, or on
# one whose data you no longer need.
#
# Usage: ./scripts/server-swap/import-to-local.sh server-export/<time> [--yes]
#
# Before you run it:
#   - check out the same Rooftap version that hosted runs, start the stack
#     (./scripts/self-host-init.sh -d) and let `migrate` finish. The script
#     refuses to load data into a schema at another migration.
#   - set HOUSEHOLD_KEYS_SECRET in .env to the hosted value (Vercel env).
#     Saved AI keys, Home Assistant tokens and the operator's keys are
#     encrypted with it. Set it before the first start, or restart `app`.
#
# Accounts keep their passwords and Google sign-ins. Everyone signs in again
# once, because this server signs sessions with its own key.

cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1

src="${1:-}"
if [ -z "$src" ] || [ ! -f "$src/public.dump" ] || [ ! -f "$src/migration.txt" ]; then
  echo "Usage: $0 server-export/<time> [--yes]" >&2
  exit 1
fi

db="$(docker compose ps -q db)"
if [ -z "$db" ]; then
  echo "error: the stack is not running. Start it with ./scripts/self-host-init.sh -d first." >&2
  exit 1
fi

psql_db() {
  docker exec -i "$db" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

# Compared by timestamp: the Supabase CLI records "20261024070000", this
# stack's migrate service "20261024070000_recipes_to_try".
export_version="$(tr -d '[:space:]' < "$src/migration.txt" | cut -d_ -f1)"
local_version="$(psql_db -At -c 'select max(version) from supabase_migrations.schema_migrations' | tr -d '[:space:]' | cut -d_ -f1)"
if [ "$export_version" != "$local_version" ]; then
  echo "error: the export is at migration $export_version, but this stack is at $local_version." >&2
  echo "Check out the Rooftap version whose newest file in supabase/migrations starts with $export_version, run ./scripts/self-host-init.sh -d --build, and try again." >&2
  exit 1
fi

if [ "${2:-}" != "--yes" ]; then
  echo "This replaces every account, household and file record on this server with the export in $src."
  read -r -p "Type 'import' to continue: " answer
  if [ "$answer" != "import" ]; then
    echo "Cancelled; nothing changed."
    exit 1
  fi
fi

# Nothing may write while the rows are swapped. The services running now
# start again afterwards.
running="$(docker compose ps --services --status running | grep -vx db || true)"
if [ -n "$running" ]; then
  # shellcheck disable=SC2086
  docker compose stop $running
fi

docker exec "$db" rm -rf /tmp/swap
docker exec "$db" mkdir -p /tmp/swap
for file in public.dump auth.users.jsonl auth.identities.jsonl storage.buckets.jsonl; do
  docker cp "$src/$file" "$db:/tmp/swap/$file"
done
cp scripts/server-swap/load.sql "$src/.load.sql"
docker cp "$src/.load.sql" "$db:/tmp/swap/load.sql"
rm -f "$src/.load.sql"

echo "Loading the data ..."
# Table data and sequence positions for the public tables this stack has,
# after load.sql empties the schemas and loads accounts and buckets, all in one
# transaction. supabase_admin, because session_replication_role (no triggers
# or foreign-key checks while loading) needs a superuser.
docker exec "$db" sh -c '
  set -e
  cd /tmp/swap
  psql -U supabase_admin -d postgres -At -c "select tablename from pg_tables where schemaname = '"'"'public'"'"'" > tables.txt
  pg_restore -l public.dump | grep -E " (TABLE DATA|SEQUENCE SET) public " > all.list || true
  awk "NR==FNR { have[\$1] = 1; next } \$4 == \"TABLE\" && !(\$7 in have) { print \"skipped, not in this schema: \" \$7 > \"/dev/stderr\"; next } { print }" tables.txt all.list > restore.list
  pg_restore -L restore.list -f data.sql public.dump
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --single-transaction -q -f load.sql -f data.sql > /dev/null
  cd / && rm -rf /tmp/swap
'

echo "Data loaded. Starting the services again ..."
# shellcheck disable=SC2086
docker compose up -d --wait $running storage kong >/dev/null

if [ -f "$src/storage/files.json" ]; then
  env_value() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
  kong_port="$(env_value KONG_HTTP_PORT)"
  SUPABASE_URL="http://localhost:${kong_port:-8000}" SERVICE_ROLE_KEY="$(env_value SERVICE_ROLE_KEY)" \
    node scripts/server-swap/storage-files.mjs import "$src/storage"
else
  echo "The export has no uploaded files; skipped."
fi

echo "Imported $src at migration $export_version."
