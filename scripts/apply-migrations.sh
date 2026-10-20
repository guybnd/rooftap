#!/usr/bin/env bash
set -euo pipefail

# Applies every supabase/migrations/*.sql file against the self-hosted `db`
# service, in order, tracking what's already applied in
# supabase_migrations.schema_migrations (same table name/shape the Supabase
# CLI's own `db push` uses) so re-running `docker compose up` after the
# Postgres volume already has data is a no-op instead of re-running
# non-idempotent CREATE TABLE statements. Runs as the one-shot `migrate`
# service in docker-compose.yml (FLUX-1561), after `db` reports healthy.
#
# Expects PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD in the environment
# (standard libpq vars — see the `migrate` service in docker-compose.yml) and
# the migrations directory bind-mounted at MIGRATIONS_DIR (default /migrations).

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

psql -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  inserted_at timestamptz NOT NULL DEFAULT now()
);
SQL

shopt -s nullglob
files=("$MIGRATIONS_DIR"/*.sql)
if [ "${#files[@]}" -eq 0 ]; then
  echo "No migrations found in $MIGRATIONS_DIR — nothing to do."
  exit 0
fi

# Migration filenames come from our own repo (not user input), but escape
# embedded single quotes anyway before splicing into SQL. `-v`/`:'var'`
# interpolation is NOT applied when SQL is passed via `-c` (only via -f /
# interactive) — confirmed empirically, hence building the literal here
# instead of relying on that.
sql_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
}

pending=()
skipped=0
for file in $(printf '%s\n' "${files[@]}" | sort); do
  version="$(basename "$file" .sql)"
  already="$(psql -tA -v ON_ERROR_STOP=1 \
    -c "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$(sql_literal "$version")'")"
  if [ "$already" = "1" ]; then
    skipped=$((skipped + 1))
  else
    pending+=("$file")
  fi
done

# Pre-upgrade backup: when an install that already has data (some migrations
# recorded) is about to apply new ones, dump the database first, so a
# migration that goes wrong on someone's real data can be rolled back from
# the dump. First boot (nothing recorded yet) has nothing to protect and is
# skipped. A failed dump stops the upgrade rather than migrating without a
# safety net. Opt out with MIGRATE_BACKUP=off in .env; the newest
# MIGRATE_BACKUP_KEEP dumps (default 5) are kept, older ones are deleted.
BACKUP_DIR="${BACKUP_DIR:-/backups}"
if [ "${#pending[@]}" -gt 0 ] && [ "$skipped" -gt 0 ] && [ "${MIGRATE_BACKUP:-on}" != "off" ]; then
  mkdir -p "$BACKUP_DIR"
  backup="$BACKUP_DIR/pre-migrate-$(date -u +%Y%m%dT%H%M%SZ).dump"
  echo "${#pending[@]} new migration(s) to apply; backing up the database to ${backup#"$BACKUP_DIR"/} first ..."
  if ! pg_dump --format=custom --file="$backup.partial"; then
    rm -f "$backup.partial"
    echo "error: pre-migration backup failed, so no migrations were applied. Fix the error above, or set MIGRATE_BACKUP=off in .env to upgrade without a backup." >&2
    exit 1
  fi
  mv "$backup.partial" "$backup"
  keep="${MIGRATE_BACKUP_KEEP:-5}"
  ls -1t "$BACKUP_DIR"/pre-migrate-*.dump 2>/dev/null | tail -n +"$((keep + 1))" | xargs -r rm -f
  echo "backup written: backups/${backup#"$BACKUP_DIR"/}"
fi

# Each file and its tracking row commit together in one transaction
# (--single-transaction wraps every -f/-c in a single BEGIN/COMMIT). A
# statement that fails partway rolls the whole file back, so the next `up`
# retries it from a clean slate instead of tripping over half-created
# tables. No migration may therefore contain its own BEGIN/COMMIT or
# statements that refuse to run in a transaction (CREATE INDEX
# CONCURRENTLY, VACUUM).
applied=0
for file in "${pending[@]}"; do
  version="$(basename "$file" .sql)"
  echo "applying migration: $version"
  if ! psql -v ON_ERROR_STOP=1 --single-transaction -f "$file" \
    -c "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('$(sql_literal "$version")')"; then
    echo "error: migration $version failed and was rolled back; nothing from it was applied. $applied migration(s) before it were applied and stay applied." >&2
    exit 1
  fi
  applied=$((applied + 1))
done

echo "migrations complete: $applied applied, $skipped already up to date (of ${#files[@]} total)."

# Vault auto-seed (HOUP-309): public.notify_edge_function (see the
# push-notification-triggers migration) reads project_url/service_role_key
# from Supabase Vault via pg_net, from inside this `db` container — seeding
# the browser-facing SUPABASE_PUBLIC_URL here instead of SEED_PROJECT_URL
# would point Postgres at itself. Delivered via -f/heredoc with explicit -v
# bindings: psql does not interpolate inside quoted literals (a dollar-quoted
# `do $$ ... $$` body would receive the literal text ":url"), and -v/:'var'
# interpolation is not applied via -c either (see the `already=` lookup
# above). Delete-then-create on every run, so the Vault copies always match
# .env and are encrypted with the current pgsodium key: a stack that lost its
# key (no db-config volume) or rotated SERVICE_ROLE_KEY heals on the next `up`
# instead of every push trigger failing silently. Not vault.update_secret:
# it decrypts the old value first and errors on a lost key. Only these two
# names are touched, and readers look them up by name, so new ids are fine.
# A seed failure warns and lets `migrate` exit 0, matching the rest of this
# script's warn-and-continue posture.
if [ -n "${SEED_PROJECT_URL:-}" ] && [ -n "${SERVICE_ROLE_KEY:-}" ]; then
  psql -v ON_ERROR_STOP=1 -v url="$SEED_PROJECT_URL" -v key="$SERVICE_ROLE_KEY" -f - <<'SQL' \
    && echo "vault secrets seeded: project_url, service_role_key" \
    || echo "warn: vault seed failed — push reminders no-op until you run the vault.create_secret statements in supabase/functions/README.md by hand" >&2
create extension if not exists supabase_vault;
begin;
delete from vault.secrets where name in ('project_url', 'service_role_key');
select vault.create_secret(:'url', 'project_url');
select vault.create_secret(:'key', 'service_role_key');
commit;
SQL
else
  echo "warn: SEED_PROJECT_URL/SERVICE_ROLE_KEY not set — skipping vault seed. Push reminders will no-op until you run the vault.create_secret statements in supabase/functions/README.md by hand." >&2
fi
