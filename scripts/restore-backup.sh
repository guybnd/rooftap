#!/usr/bin/env bash
set -euo pipefail

# Rolls a self-hosted Rooftap back to a pre-migration backup written by
# scripts/apply-migrations.sh (backups/pre-migrate-<UTC time>.dump).
#
# Usage: ./scripts/restore-backup.sh backups/pre-migrate-<time>.dump [--yes] [--no-build]
#
# --yes skips the confirmation and --no-build boots the images you already
# have; scripts/backup/restore.sh uses both to load a full backup's dump.
#
# Check out the Rooftap version you were running when the backup was taken
# first; the script refuses to run if that version's newest migration doesn't
# match the backup's. It then:
#   1. deletes the Postgres data volume (db-data only; uploaded files, the
#      pgsodium key, TLS certificates and .env are left alone),
#   2. boots the stack, so the checked-out migrations rebuild the schema
#      exactly as it was and auth/storage set up their own tables,
#   3. replaces the rows in the public, auth and storage schemas with the
#      backup's, in one transaction, and starts everything back up.
#
# Why not restore the whole dump over a fresh volume: the Supabase Postgres
# image creates its own roles, extensions and event triggers on first boot,
# and a full dump collides with them. Rebuilding the schema from migrations
# and loading only the data is what `supabase db dump`'s restore does too.

cd "$(dirname "$0")/.."

dump=""
confirmed=0
build="--build"
for arg in "$@"; do
  case "$arg" in
    --yes) confirmed=1 ;;
    --no-build) build="" ;;
    *) dump="$arg" ;;
  esac
done
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "Usage: $0 backups/pre-migrate-<time>.dump [--yes] [--no-build]" >&2
  ls -1t backups/pre-migrate-*.dump 2>/dev/null | sed 's/^/  /' >&2 || true
  exit 1
fi

if [ -z "$(docker compose ps -q db)" ]; then
  echo "Starting db to read the backup ..."
  docker compose up -d --wait db
fi
db="$(docker compose ps -q db)"
docker cp "$dump" "$db:/tmp/restore.dump"

# The newest migration recorded in the backup must be the newest one in this
# checkout, or the data would be loaded into a schema it doesn't match.
backup_version="$(docker exec "$db" sh -c \
  'pg_restore --data-only --schema=supabase_migrations --table=schema_migrations -f - /tmp/restore.dump' \
  | awk '/^COPY /{on=1; next} /^\\\./{on=0} on{print $1}' | sort | tail -1)"
checkout_version="$(basename "$(ls -1 supabase/migrations/*.sql | sort | tail -1)" .sql)"
if [ -z "$backup_version" ]; then
  echo "error: $dump has no migration history; it isn't a backup from apply-migrations.sh." >&2
  exit 1
fi
if [ "$backup_version" != "$checkout_version" ]; then
  echo "error: the backup was taken at migration $backup_version, but this checkout's newest is $checkout_version." >&2
  echo "Check out the Rooftap version you were running before the upgrade (the one whose newest file in supabase/migrations is $backup_version), then run this again." >&2
  exit 1
fi

volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$db")"
if [ -z "$volume" ]; then
  echo "error: couldn't find the db container's data volume." >&2
  exit 1
fi

echo "This deletes the database volume '$volume' and replaces its contents with $dump."
echo "Everything written since that backup is lost. Uploaded files are kept."
if [ "$confirmed" -eq 0 ]; then
  read -r -p "Type 'restore' to continue: " answer
  if [ "$answer" != "restore" ]; then
    echo "Cancelled; nothing changed."
    exit 1
  fi
fi

docker compose down
docker volume rm "$volume"

echo "Rebuilding the schema from this checkout's migrations ..."
./scripts/self-host-init.sh -d $build
migrate="$(docker compose ps -a -q migrate)"
if [ "$(docker wait "$migrate")" != "0" ]; then
  echo "error: migrations failed on the fresh database; see 'docker compose logs migrate'. The backup file is untouched." >&2
  exit 1
fi

# Nothing may write while the rows are swapped.
docker compose stop app auth rest realtime storage edge-runtime kong

db="$(docker compose ps -q db)"
docker cp "$dump" "$db:/tmp/restore.dump"

echo "Loading the backup's data ..."
# Table data and sequence positions for public/auth/storage, minus the
# services' own migration bookkeeping, which the fresh boot just wrote.
# supabase_admin because session_replication_role (skip triggers and
# foreign-key checks while loading) needs a superuser.
prelude="$(mktemp)"
trap 'rm -f "$prelude"' EXIT
cat > "$prelude" <<'SQL'
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
SQL
docker cp "$prelude" "$db:/tmp/restore-prelude.sql"
docker exec "$db" sh -c '
  set -e
  pg_restore -l /tmp/restore.dump \
    | grep -E " (TABLE DATA|SEQUENCE SET) (public|auth|storage) " \
    | grep -vE " (auth schema_migrations|storage migrations) " > /tmp/restore.list
  pg_restore -L /tmp/restore.list -f /tmp/restore-data.sql /tmp/restore.dump
  psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --single-transaction -q \
    -f /tmp/restore-prelude.sql -f /tmp/restore-data.sql > /dev/null
  rm -f /tmp/restore.dump /tmp/restore.list /tmp/restore-prelude.sql /tmp/restore-data.sql
'

docker compose up -d
echo "Restored $dump. Rooftap is back at migration $backup_version."
