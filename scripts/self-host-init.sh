#!/usr/bin/env bash
set -euo pipefail

# Rooftap self-host first-boot provisioning (FLUX-1561).
#
# PERSISTENCE GUARANTEE: JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY / POSTGRES_PASSWORD /
# SECRET_KEY_BASE / REALTIME_DB_ENC_KEY are generated exactly once into the
# bind-mounted .env file at the repo root. A later `docker compose down && up`
# (or re-running this script) REUSES whatever is already in .env and never
# regenerates — regenerating would issue a new signing key and instantly
# invalidate every existing session cookie, every RLS-signed request already
# in flight, and every live Realtime connection. This script is idempotent:
# run it as many times as you like, it only ever fills in what's missing.
#
# WHY THIS RUNS ON THE HOST, NOT AS A COMPOSE SERVICE: `docker compose up`
# substitutes ${VAR} references in docker-compose.yml exactly once, before any
# container starts. Generating these values from inside a container (e.g. an
# `init` service) would be too late — every other service (auth, rest,
# realtime, storage, kong, edge-runtime) would already have been started with
# the empty values baked in. Run this script INSTEAD of `docker compose up`
# directly; it fixes up .env first, then execs `docker compose up` for you.
#
# Usage: ./scripts/self-host-init.sh [any `docker compose up` args, e.g. -d]

cd "$(dirname "$0")/.."

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example "$ENV_FILE"
    echo "Created $ENV_FILE from .env.example — fill in the operator-supplied values (Mapbox token, etc.) before continuing."
  else
    echo "No $ENV_FILE and no .env.example found; create $ENV_FILE at the repo root first." >&2
    exit 1
  fi
fi

# True (exit 0) if $1 (a var name) is absent from .env, empty, or still a
# copy-pasted placeholder from .env.example.
is_unset() {
  local line value
  line="$(grep -E "^${1}=" "$ENV_FILE" || true)"
  if [ -z "$line" ]; then
    return 0
  fi
  value="${line#*=}"
  case "$value" in
    "" | your-* | REPLACE_ME* | auto-generated-on-first-boot | change-me* ) return 0 ;;
    * ) return 1 ;;
  esac
}

# Set $1=$2 in .env, replacing an existing line for $1 in place or appending
# if absent. Never touches any other line.
upsert_env() {
  if grep -qE "^${1}=" "$ENV_FILE"; then
    sed -i.bak -E "s|^${1}=.*|${1}=${2}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}

base64url() {
  base64 | tr '+/' '-_' | tr -d '=\n'
}

sign_hs256() {
  # $1 = signing input (header.payload), $2 = secret
  printf '%s' "$1" | openssl dgst -sha256 -hmac "$2" -binary | base64url
}

make_jwt() {
  # $1 = role claim ("anon" | "service_role"). Signed with $JWT_SECRET, which
  # must already be set in the caller's environment.
  local role="$1" iat exp header payload signing_input
  iat=$(date +%s)
  exp=$((iat + 315360000)) # +10 years: single-operator install, no key-rotation ceremony.
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | base64url)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$iat" "$exp" | base64url)
  signing_input="${header}.${payload}"
  printf '%s.%s' "$signing_input" "$(sign_hs256 "$signing_input" "$JWT_SECRET")"
}

if is_unset "JWT_SECRET" && is_unset "ANON_KEY" && is_unset "SERVICE_ROLE_KEY"; then
  echo "First boot: generating JWT_SECRET + ANON_KEY + SERVICE_ROLE_KEY into $ENV_FILE ..."
  JWT_SECRET="$(openssl rand -hex 32)"
  ANON_KEY="$(make_jwt anon)"
  SERVICE_ROLE_KEY="$(make_jwt service_role)"
  upsert_env "JWT_SECRET" "$JWT_SECRET"
  upsert_env "ANON_KEY" "$ANON_KEY"
  upsert_env "SERVICE_ROLE_KEY" "$SERVICE_ROLE_KEY"
  echo "Generated. These now live in $ENV_FILE — back it up, and never delete/regenerate them on a running install (see persistence guarantee above)."
elif is_unset "JWT_SECRET" || is_unset "ANON_KEY" || is_unset "SERVICE_ROLE_KEY"; then
  echo "One of JWT_SECRET/ANON_KEY/SERVICE_ROLE_KEY is set in $ENV_FILE but not all three — refusing to guess which to (re)generate. Set all three yourself, or clear all three and re-run this script." >&2
  exit 1
else
  echo "Reusing existing JWT_SECRET/ANON_KEY/SERVICE_ROLE_KEY from $ENV_FILE (not regenerating)."
fi

# Same persistence guarantee as above, for the Postgres superuser password:
# generate once on first boot, reuse forever after (regenerating would lock
# every Supabase-stack role that authenticates against `db` with the old one).
if is_unset "POSTGRES_PASSWORD"; then
  echo "First boot: generating POSTGRES_PASSWORD into $ENV_FILE ..."
  upsert_env "POSTGRES_PASSWORD" "$(openssl rand -hex 24)"
else
  echo "Reusing existing POSTGRES_PASSWORD from $ENV_FILE (not regenerating)."
fi

# Same persistence guarantee as above, for the Realtime (Phoenix) session-signing
# secret: generate once on first boot, reuse forever after (regenerating would
# invalidate every live Realtime connection's signed channel token).
if is_unset "SECRET_KEY_BASE"; then
  echo "First boot: generating SECRET_KEY_BASE into $ENV_FILE ..."
  upsert_env "SECRET_KEY_BASE" "$(openssl rand -base64 48)"
else
  echo "Reusing existing SECRET_KEY_BASE from $ENV_FILE (not regenerating)."
fi

# REALTIME_DB_ENC_KEY must stay exactly 16 characters (Realtime's Erlang crypto
# uses it as a fixed-width AES key) — same generate-once/reuse guarantee.
if is_unset "REALTIME_DB_ENC_KEY"; then
  echo "First boot: generating REALTIME_DB_ENC_KEY into $ENV_FILE ..."
  upsert_env "REALTIME_DB_ENC_KEY" "$(openssl rand -hex 8)"
else
  echo "Reusing existing REALTIME_DB_ENC_KEY from $ENV_FILE (not regenerating)."
fi

# HOUSEHOLD_KEYS_SECRET encrypts the AI keys households save in Settings >
# AI keys (HOUP-436). Generate once, reuse forever: a new secret makes every
# saved key unreadable, and households would have to enter them again.
if is_unset "HOUSEHOLD_KEYS_SECRET"; then
  echo "First boot: generating HOUSEHOLD_KEYS_SECRET into $ENV_FILE ..."
  upsert_env "HOUSEHOLD_KEYS_SECRET" "$(openssl rand -hex 32)"
else
  echo "Reusing existing HOUSEHOLD_KEYS_SECRET from $ENV_FILE (not regenerating)."
fi

exec docker compose up "$@"
