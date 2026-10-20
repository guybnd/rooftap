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

applied=0
skipped=0
for file in $(printf '%s\n' "${files[@]}" | sort); do
  version="$(basename "$file" .sql)"
  # Migration filenames come from our own repo (not user input), but escape
  # embedded single quotes anyway before splicing into SQL. `-v`/`:'var'`
  # interpolation is NOT applied when SQL is passed via `-c` (only via -f /
  # interactive) — confirmed empirically, hence building the literal here
  # instead of relying on that.
  escaped_version="$(printf '%s' "$version" | sed "s/'/''/g")"
  already="$(psql -tA -v ON_ERROR_STOP=1 \
    -c "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${escaped_version}'")"
  if [ "$already" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "applying migration: $version"
  psql -v ON_ERROR_STOP=1 -f "$file"
  psql -v ON_ERROR_STOP=1 \
    -c "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('${escaped_version}')"
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
