#!/usr/bin/env bash
set -euo pipefail

# End-to-end test of the self-hosted stack (docker-compose.yml).
#
# Boots the real stack from a scratch copy of this checkout, the way an
# operator does with scripts/self-host-init.sh, and checks that it works:
#
#   fresh    A new install: migrations apply, /api/public-config reports the
#            newest migration, the first account is made through the app and
#            then sign-up is closed, a household is made for that account,
#            the app works in a browser opened by the network address over
#            plain http (when Node and Playwright are installed),
#            row level security keeps a second account out of it, files
#            upload to storage, the edge functions answer and realtime
#            accepts a WebSocket.
#   upgrade  An install of the newest release tag with older migrations (or
#            --from <ref>) with data in it is upgraded to this checkout:
#            only the new migrations run, a backup is written first, the
#            data survives, and scripts/restore-backup.sh rolls it back in.
#   backup   An install with data and an upload takes an encrypted full
#            backup (scripts/backup/backup.sh). Then the install is deleted,
#            and a new folder with only the backup file restores it
#            (scripts/backup/restore.sh): accounts stay signed in, and the
#            rows and the file come back.
#   updater  One-click updates (scripts/updater/): an install of this
#            checkout, made a git repo that calls itself 9.0.0, is updated
#            by updater.sh to a 9.0.1 with a new migration. Then a broken
#            9.0.2 (the app never starts) is rolled back to 9.0.1 with the
#            data written in between kept. A stand-in answers for the GitHub
#            release check; the tags come from a local git remote.
#
# Usage: scripts/self-host-e2e.sh [fresh|upgrade|backup|updater|all] [--from <git ref>] [--keep]
#
# Needs bash, git, curl, openssl and Docker with the compose plugin on Linux
# (the app container uses host networking). Every run uses its own compose
# project, its own .env and the ports below, so it never touches a real
# install's data. It cannot run beside a real install on the same machine:
# the realtime container has a fixed name in docker-compose.yml.
#
# Ports: E2E_KONG_PORT (18000), E2E_APP_PORT (13737), E2E_PG_PORT (15432).
# E2E_PREPARE names a script run inside each stack copy before it boots,
# for machine-specific setup such as a proxy or a docker-compose.override.yml.
# --keep leaves the last stack running for a look around.

repo="$(cd "$(dirname "$0")/.." && pwd)"
mode="all"
from=""
keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    fresh | upgrade | backup | updater | all) mode="$1" ;;
    --from) from="${2:?--from needs a git ref}"; shift ;;
    --keep) keep=1 ;;
    -h | --help) sed -n '4,44p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

kong_port="${E2E_KONG_PORT:-18000}"
app_port="${E2E_APP_PORT:-13737}"
pg_port="${E2E_PG_PORT:-15432}"
kong="http://localhost:$kong_port"
app="http://localhost:$app_port"
project_prefix="${E2E_PROJECT:-rooftap-e2e}"

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/rooftap-e2e.XXXXXX")"
projects=()
failures=0

log() { printf '\n[e2e] %s\n' "$*"; }
pass() { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*" >&2; failures=$((failures + 1)); }
die() { printf '[e2e] error: %s\n' "$*" >&2; exit 1; }

for tool in git curl openssl docker; do
  command -v "$tool" > /dev/null || die "$tool is not installed"
done
docker compose version > /dev/null 2>&1 || die "the docker compose plugin is not installed"
if [ -n "$(docker ps -aq --filter name=^realtime-dev.supabase-realtime$)" ]; then
  die "a container named realtime-dev.supabase-realtime already exists (a real install or an earlier --keep run). Stop it first."
fi

# Compose in a stack folder ($1) under a project name ($2).
dc() {
  local dir="$1" name="$2"
  shift 2
  (cd "$dir" && COMPOSE_PROJECT_NAME="$name" docker compose "$@")
}

cleanup() {
  local status=$?
  if [ "$keep" -eq 1 ] && [ ${#projects[@]} -gt 0 ]; then
    local last="${projects[${#projects[@]}-1]}"
    echo "[e2e] --keep: left project ${last#*=} running in ${last%%=*}"
    echo "[e2e] remove it with: cd ${last%%=*} && COMPOSE_PROJECT_NAME=${last#*=} docker compose down -v"
    return "$status"
  fi
  for entry in "${projects[@]}"; do
    dc "${entry%%=*}" "${entry#*=}" down -v --remove-orphans > /dev/null 2>&1 || true
  done
  # Containers write backups/ as root, so remove the folder from a container.
  docker run --rm -v "$work:/work" alpine:3.22 sh -c 'rm -rf /work/*' > /dev/null 2>&1 || true
  rm -rf "$work" 2> /dev/null || true
  return "$status"
}
trap cleanup EXIT

# Copy a ref ($1, or "worktree" for the checkout as it is, uncommitted
# changes included) into folder $2.
export_tree() {
  mkdir -p "$2"
  if [ "$1" = "worktree" ]; then
    # Files deleted but not yet committed are still listed; skip them.
    (cd "$repo" && git ls-files -z --cached --others --exclude-standard \
      | tar --null -T - --ignore-failed-read -cf - 2> /dev/null) | tar -xf - -C "$2"
  else
    git -C "$repo" archive "$1" | tar -xf - -C "$2"
  fi
  if [ -n "${E2E_PREPARE:-}" ]; then
    (cd "$2" && bash "$E2E_PREPARE") || die "E2E_PREPARE failed in $2"
  fi
}

# Write the stack's .env with this run's ports. self-host-init.sh fills in
# the secrets on first boot.
write_env() {
  local dir="$1"
  cp "$dir/.env.example" "$dir/.env"
  set_env "$dir" NEXT_PUBLIC_SUPABASE_URL "$kong"
  set_env "$dir" SUPABASE_PUBLIC_URL "$kong"
  set_env "$dir" SITE_URL "$app"
  set_env "$dir" KONG_HTTP_PORT "$kong_port"
  set_env "$dir" APP_PORT "$app_port"
  set_env "$dir" POSTGRES_PORT "$pg_port"
  set_env "$dir" KONG_BIND 127.0.0.1
  set_env "$dir" APP_BIND 127.0.0.1
}

set_env() {
  local file="$1/.env"
  if grep -qE "^$2=" "$file"; then
    sed -i.bak -E "s|^$2=.*|$2=$3|" "$file" && rm -f "$file.bak"
  else
    printf '%s=%s\n' "$2" "$3" >> "$file"
  fi
}

get_env() { grep -E "^$2=" "$1/.env" | head -1 | cut -d= -f2-; }

# Boot the stack in $1 as project $2; extra args are services (default: all).
boot() {
  local dir="$1" name="$2"
  shift 2
  projects+=("$dir=$name")
  (cd "$dir" && COMPOSE_PROJECT_NAME="$name" ./scripts/self-host-init.sh -d --build "$@") \
    || die "docker compose up failed in $dir"
}

# Wait for the one-shot migrate container and check that it exited 0.
wait_migrate() {
  local dir="$1" name="$2" id code
  id="$(dc "$dir" "$name" ps -aq migrate)"
  [ -n "$id" ] || die "no migrate container"
  code="$(docker wait "$id")"
  if [ "$code" != "0" ]; then
    dc "$dir" "$name" logs migrate | tail -40 >&2
    die "migrate exited with $code"
  fi
  pass "migrations applied (migrate exited 0)"
}

# Poll $1 until it answers with HTTP status $2 (default 200), up to $3 s.
wait_http() {
  local url="$1" want="${2:-200}" limit="${3:-300}" waited=0 got
  while :; do
    got="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    [ "$got" = "$want" ] && return 0
    [ "$waited" -ge "$limit" ] && { echo "  $url answered $got after ${limit}s, wanted $want" >&2; return 1; }
    sleep 3
    waited=$((waited + 3))
  done
}

# HTTP helper: req METHOD URL [BODY] [header...]. Prints the body and leaves
# the status in $work/code, so it survives a $(...) subshell.
req() {
  local method="$1" url="$2" body="${3:-}"
  shift 3 || shift $#
  local args=(-s -o "$work/body" -w '%{http_code}' -X "$method" "$url" -H 'Content-Type: application/json')
  for h in "$@"; do args+=(-H "$h"); done
  [ -n "$body" ] && args+=(--data "$body")
  curl "${args[@]}" > "$work/code" || true
  cat "$work/body" 2> /dev/null || true
}

# Pull a top-level string field out of a JSON body without needing jq.
json_field() { sed -n "s/.*\"$1\" *: *\"\\([^\"]*\\)\".*/\\1/p" | head -1; }

expect_status() {
  local what="$1" want="$2" status
  status="$(cat "$work/code" 2> /dev/null)"
  if [[ "$status" =~ ^($want)$ ]]; then pass "$what ($status)"; else fail "$what: got HTTP $status, wanted $want: $(head -c 300 "$work/body")"; fi
}

sql() { dc "$1" "$2" exec -T db psql -U postgres -d postgres -tAX -c "$3"; }

newest_migration() { basename "$(ls -1 "$1"/supabase/migrations/*.sql | sort | tail -1)" .sql; }
migration_count() { ls -1 "$1"/supabase/migrations/*.sql | wc -l | tr -d ' '; }

sign_in() {
  local dir="$1" email="$2" password="$3" anon
  anon="$(get_env "$dir" ANON_KEY)"
  req POST "$kong/auth/v1/token?grant_type=password" "{\"email\":\"$email\",\"password\":\"$password\"}" "apikey: $anon" | json_field access_token
}

# Make an account through GoTrue's admin API (sign-up is closed after the
# first account, so this is how an operator adds people too).
admin_user() {
  local dir="$1" email="$2" password="$3" service
  service="$(get_env "$dir" SERVICE_ROLE_KEY)"
  req POST "$kong/auth/v1/admin/users" "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true}" \
    "apikey: $service" "Authorization: Bearer $service" > /dev/null
}

# The household the new-user trigger made for the signed-in account.
household_of() {
  local dir="$1" token="$2" anon
  anon="$(get_env "$dir" ANON_KEY)"
  req GET "$kong/rest/v1/group_members?select=group_id&limit=1" "" "apikey: $anon" "Authorization: Bearer $token" | json_field group_id
}

add_grocery() {
  local dir="$1" token="$2" group="$3" name="$4" anon
  anon="$(get_env "$dir" ANON_KEY)"
  req POST "$kong/rest/v1/grocery_items" "{\"group_id\":\"$group\",\"name\":\"$name\"}" \
    "apikey: $anon" "Authorization: Bearer $token" "Prefer: return=minimal" > /dev/null
}

groceries_named() {
  local dir="$1" token="$2" name="$3" anon
  anon="$(get_env "$dir" ANON_KEY)"
  req GET "$kong/rest/v1/grocery_items?select=id&name=eq.$name" "" "apikey: $anon" "Authorization: Bearer $token" \
    | grep -o '"id"' | wc -l | tr -d ' '
}

check_public_config() {
  local dir="$1" body version
  body="$(req GET "$app/api/public-config" "")"
  expect_status "GET /api/public-config" 200
  version="$(printf '%s' "$body" | json_field schemaVersion)"
  if [ "$version" = "$(newest_migration "$dir")" ]; then
    pass "public-config schemaVersion is the newest migration ($version)"
  else
    fail "public-config schemaVersion is '$version', newest migration is $(newest_migration "$dir")"
  fi
  if printf '%s' "$body" | grep -qiE 'service_role|SERVICE_ROLE_KEY|JWT_SECRET'; then
    fail "public-config leaks a secret: $body"
  fi
}

check_migration_rows() {
  local dir="$1" name="$2" rows
  rows="$(sql "$dir" "$name" "select count(*) from supabase_migrations.schema_migrations")"
  if [ "$rows" = "$(migration_count "$dir")" ]; then
    pass "all $rows migrations recorded"
  else
    fail "$rows migrations recorded, $(migration_count "$dir") files in supabase/migrations"
  fi
}

# ---------------------------------------------------------------------------

# Opens the app in a browser by this machine's network address over plain
# http, the way a home install is opened (scripts/self-host-e2e-browser.mjs).
# Skipped when Node or Playwright is missing.
check_browser() {
  local host
  host="$(hostname -I 2> /dev/null | awk '{print $1}')"
  if [ -z "$host" ] || ! command -v node > /dev/null || ! node -e "require.resolve('playwright')" > /dev/null 2>&1; then
    printf '  skip  browser check (needs node, Playwright and a network address)\n'
    return
  fi
  if node "$repo/scripts/self-host-e2e-browser.mjs" "http://$host:$app_port"; then
    pass "the app works in a browser over plain http on $host"
  else
    fail "the app fails in a browser over plain http on $host"
  fi
}

run_fresh() {
  local dir="$work/fresh" name="$project_prefix-fresh" anon service token1 token2 group1 group2
  log "fresh install from this checkout"
  export_tree worktree "$dir"
  write_env "$dir"
  boot "$dir" "$name"
  wait_migrate "$dir" "$name"
  wait_http "$app/api/public-config" 200 300 || die "the app never came up"
  anon="$(get_env "$dir" ANON_KEY)"
  service="$(get_env "$dir" SERVICE_ROLE_KEY)"

  check_migration_rows "$dir" "$name"
  check_public_config "$dir"

  req GET "$app/login" "" > /dev/null
  expect_status "GET /login" 200

  req POST "$kong/auth/v1/signup" '{"email":"stranger@e2e.test","password":"stranger-pass-1"}' "apikey: $anon" > /dev/null
  expect_status "GoTrue sign-up is closed" '4[0-9][0-9]'

  req POST "$app/api/setup/first-user" '{"identifier":"owner@e2e.test","password":"owner-pass-1","displayName":"Owner"}' > /dev/null
  expect_status "first account through /api/setup/first-user" 201
  req POST "$app/api/setup/first-user" '{"identifier":"second@e2e.test","password":"second-pass-1"}' > /dev/null
  expect_status "a second first-user call is refused" 409

  token1="$(sign_in "$dir" owner@e2e.test owner-pass-1)"
  [ -n "$token1" ] && pass "owner signs in" || fail "owner could not sign in: $(head -c 300 "$work/body")"
  group1="$(household_of "$dir" "$token1")"
  [ -n "$group1" ] && pass "new-user trigger made a household" || fail "owner has no household"

  add_grocery "$dir" "$token1" "$group1" e2e-milk
  expect_status "owner adds a grocery item" 201
  [ "$(groceries_named "$dir" "$token1" e2e-milk)" = "1" ] && pass "owner reads it back" || fail "owner cannot read the item back"

  check_browser

  admin_user "$dir" other@e2e.test other-pass-1
  expect_status "operator adds a second account" 200
  token2="$(sign_in "$dir" other@e2e.test other-pass-1)"
  group2="$(household_of "$dir" "$token2")"
  if [ -n "$group2" ] && [ "$group2" != "$group1" ]; then pass "second account has its own household"; else fail "second account household: '$group2'"; fi
  [ "$(groceries_named "$dir" "$token2" e2e-milk)" = "0" ] && pass "RLS hides the owner's items from the second account" || fail "the second account can see the owner's items"
  add_grocery "$dir" "$token2" "$group1" e2e-intruder
  expect_status "RLS refuses a write into another household" '401|403'
  [ "$(groceries_named "$dir" "$anon" e2e-milk)" = "0" ] && pass "the anon key sees no items" || fail "the anon key can see items"

  curl -s -o "$work/body" -w '%{http_code}' -X POST "$kong/storage/v1/object/documents/$group1/e2e/note.pdf" \
    -H "apikey: $anon" -H "Authorization: Bearer $token1" -H 'Content-Type: application/pdf' \
    --data-binary '%PDF-1.4 e2e' > "$work/code" || true
  expect_status "owner uploads a document to storage" 200
  curl -s -o "$work/body" -w '%{http_code}' "$kong/storage/v1/object/documents/$group1/e2e/note.pdf" \
    -H "apikey: $anon" -H "Authorization: Bearer $token1" > "$work/code" || true
  expect_status "owner downloads it again" 200

  req POST "$kong/functions/v1/notify-due-tasks" "{}" "apikey: $anon" "Authorization: Bearer $anon" > /dev/null
  expect_status "edge functions run and refuse the anon key" '401|403'

  # A WebSocket handshake through Kong, the way the apps subscribe.
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$kong/realtime/v1/websocket?apikey=$anon&vsn=1.0.0" \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: ZTJlLXJlYWx0aW1lLWtleQ==' > "$work/code" || true
  expect_status "realtime accepts a WebSocket" 101

  local down
  down="$(dc "$dir" "$name" ps --format '{{.Service}} {{.State}}' | awk '$2 != "running" {print $1}' | tr '\n' ' ')"
  [ -z "$down" ] && pass "every service is running" || fail "not running: $down"

  if [ "$failures" -gt 0 ]; then
    dc "$dir" "$name" logs --tail 30 app auth rest storage edge-runtime >&2 || true
  fi
  [ "$keep" -eq 1 ] && [ "$mode" = "fresh" ] || dc "$dir" "$name" down -v --remove-orphans > /dev/null 2>&1
}

run_upgrade() {
  local base="$work/base" head="$work/head" name="$project_prefix-upgrade" token group before backups dump
  if [ -z "$from" ]; then
    # The newest release whose migrations are older than this checkout's, so
    # the upgrade has migrations to run and the backup gets tested. A release
    # with the same migrations would skip both.
    local tag head_newest
    head_newest="$(newest_migration "$repo")"
    for tag in $(git -C "$repo" tag --list 'v*' --sort=-version:refname); do
      if [[ "$(git -C "$repo" ls-tree --name-only "$tag" supabase/migrations/ | sort | tail -1)" < "supabase/migrations/$head_newest.sql" ]]; then
        from="$tag"
        break
      fi
    done
    [ -n "$from" ] || die "no v* release tag with older migrations found; fetch tags (git fetch --tags) or pass --from <ref>"
  fi
  log "upgrade from $from to this checkout"
  export_tree "$from" "$base"
  export_tree worktree "$head"
  write_env "$base"

  # The old version only needs its database side; its app image isn't used.
  boot "$base" "$name" db migrate auth rest storage kong
  wait_migrate "$base" "$name"
  wait_http "$kong/auth/v1/health?apikey=$(get_env "$base" ANON_KEY)" 200 120 || die "auth never came up on $from"
  admin_user "$base" keeper@e2e.test keeper-pass-1
  expect_status "account made on $from" 200
  token="$(sign_in "$base" keeper@e2e.test keeper-pass-1)"
  group="$(household_of "$base" "$token")"
  add_grocery "$base" "$token" "$group" e2e-bread
  expect_status "grocery item added on $from" 201
  before="$(sql "$base" "$name" "select count(*) from supabase_migrations.schema_migrations")"
  dc "$base" "$name" down > /dev/null 2>&1

  # The operator's upgrade: new code, same .env, same volumes.
  cp "$base/.env" "$head/.env"
  boot "$head" "$name"
  wait_migrate "$head" "$name"
  wait_http "$app/api/public-config" 200 300 || die "the app never came up after the upgrade"
  check_migration_rows "$head" "$name"
  check_public_config "$head"

  backups="$(ls -1 "$head"/backups/pre-migrate-*.dump 2> /dev/null || true)"
  if [ "$before" = "$(migration_count "$head")" ]; then
    pass "no new migrations since $from, so no backup was needed"
  elif [ -n "$backups" ]; then
    pass "pre-upgrade backup written ($(basename "$(echo "$backups" | tail -1)"))"
  else
    fail "$(( $(migration_count "$head") - before )) migrations ran but no backup was written"
  fi

  token="$(sign_in "$head" keeper@e2e.test keeper-pass-1)"
  [ -n "$token" ] && pass "the old account still signs in" || fail "the old account cannot sign in after the upgrade"
  [ "$(groceries_named "$head" "$token" e2e-bread)" = "1" ] && pass "the old data survived" || fail "the grocery item from $from is gone"
  add_grocery "$head" "$token" "$group" e2e-after-upgrade
  expect_status "a write after the upgrade" 201

  # Roll back: the old checkout restores its backup over the same project.
  if [ -n "$backups" ]; then
    dump="$(echo "$backups" | tail -1)"
    log "restore $(basename "$dump") with $from's restore-backup.sh"
    dc "$head" "$name" down > /dev/null 2>&1
    mkdir -p "$base/backups"
    docker run --rm -v "$head/backups:/from" -v "$base/backups:/to" alpine:3.22 cp "/from/$(basename "$dump")" /to/ > /dev/null
    cp "$head/.env" "$base/.env"
    if [ -f "$base/scripts/restore-backup.sh" ] && (cd "$base" && echo restore | COMPOSE_PROJECT_NAME="$name" ./scripts/restore-backup.sh "backups/$(basename "$dump")"); then
      pass "restore-backup.sh finished"
      wait_http "$kong/auth/v1/health?apikey=$(get_env "$base" ANON_KEY)" 200 120 || true
      token="$(sign_in "$base" keeper@e2e.test keeper-pass-1)"
      [ "$(groceries_named "$base" "$token" e2e-bread)" = "1" ] && pass "restored data has the item from before the upgrade" || fail "restored data lacks the item from before the upgrade"
      [ "$(groceries_named "$base" "$token" e2e-after-upgrade)" = "0" ] && pass "restored data drops what came after the backup" || fail "restored data still has the post-upgrade item"
      [ "$(sql "$base" "$name" "select count(*) from supabase_migrations.schema_migrations")" = "$before" ] \
        && pass "restored install is back at $from's migrations" || fail "restored install has the wrong migration history"
    else
      fail "restore-backup.sh failed"
    fi
  fi
}

run_backup() {
  local dir="$work/backup-old" fresh="$work/backup-new" name="$project_prefix-backup"
  local token group file pass_file="$work/backup-pass" anon
  log "full backup, then a restore onto a new machine"
  export_tree worktree "$dir"
  write_env "$dir"
  boot "$dir" "$name"
  wait_migrate "$dir" "$name"
  wait_http "$app/api/public-config" 200 300 || die "the app never came up"
  anon="$(get_env "$dir" ANON_KEY)"

  admin_user "$dir" saver@e2e.test saver-pass-1
  token="$(sign_in "$dir" saver@e2e.test saver-pass-1)"
  group="$(household_of "$dir" "$token")"
  add_grocery "$dir" "$token" "$group" e2e-backed-up
  expect_status "grocery item added before the backup" 201
  curl -s -o "$work/body" -w '%{http_code}' -X POST "$kong/storage/v1/object/documents/$group/e2e/kept.pdf" \
    -H "apikey: $anon" -H "Authorization: Bearer $token" -H 'Content-Type: application/pdf' \
    --data-binary '%PDF-1.4 e2e kept' > "$work/code" || true
  expect_status "file uploaded before the backup" 200

  printf 'e2e passphrase\n' > "$pass_file"
  if (cd "$dir" && COMPOSE_PROJECT_NAME="$name" BACKUP_PASSPHRASE_FILE="$pass_file" ./scripts/backup/backup.sh); then
    pass "backup.sh finished"
  else
    fail "backup.sh failed"
    return
  fi
  file="$(ls -1 "$dir"/backups/rooftap-backup-*.tar.enc 2> /dev/null | tail -1)"
  [ -n "$file" ] && pass "encrypted backup written ($(basename "$file"))" || { fail "no .tar.enc backup"; return; }
  if (cd "$dir" && BACKUP_PASSPHRASE_FILE="$pass_file" ./scripts/backup/restore.sh "$file" --check); then
    pass "restore.sh --check accepts it"
  else
    fail "restore.sh --check refused the backup"
  fi
  if printf 'wrong\n' > "$work/wrong-pass" && (cd "$dir" && BACKUP_PASSPHRASE_FILE="$work/wrong-pass" ./scripts/backup/restore.sh "$file" --check > /dev/null 2>&1); then
    fail "restore.sh --check accepted a wrong passphrase"
  else
    pass "a wrong passphrase is refused"
  fi
  add_grocery "$dir" "$token" "$group" e2e-after-backup
  expect_status "a write after the backup" 201

  # The machine is lost: containers, volumes and the folder all go. Only the
  # backup file is left.
  mkdir -p "$work/offsite"
  cp "$file" "$file.sha256" "$work/offsite/"
  file="$work/offsite/$(basename "$file")"
  dc "$dir" "$name" down -v --remove-orphans > /dev/null 2>&1
  docker run --rm -v "$work:/work" alpine:3.22 rm -rf /work/backup-old > /dev/null

  # A new machine: the Rooftap source comes out of the backup by hand, the
  # way RESTORE.txt says, then restore.sh puts back the rest.
  log "restore $(basename "$file") into a new folder"
  mkdir -p "$fresh"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass "file:$pass_file" -in "$file" \
    | tar -xOf - --wildcards '*/server/source.tar.gz' | tar -xzf - -C "$fresh" \
    || { fail "couldn't unpack the source from the backup by hand"; return; }
  [ ! -f "$fresh/.env" ] && pass "the new folder has no .env yet" || fail "the source archive holds a .env"
  projects+=("$fresh=$name")
  if (cd "$fresh" && COMPOSE_PROJECT_NAME="$name" BACKUP_PASSPHRASE_FILE="$pass_file" ./scripts/backup/restore.sh "$file" --yes); then
    pass "restore.sh finished"
  else
    fail "restore.sh failed"
    return
  fi
  wait_http "$app/api/public-config" 200 300 || fail "the app never came up after the restore"
  [ "$(get_env "$fresh" JWT_SECRET)" != "" ] && pass ".env came back" || fail ".env is missing after the restore"
  [ "$(groceries_named "$fresh" "$token" e2e-backed-up)" = "1" ] \
    && pass "a session from before the backup still works and sees its data" || fail "the old session or its data is gone"
  [ "$(groceries_named "$fresh" "$token" e2e-after-backup)" = "0" ] \
    && pass "what came after the backup is not there" || fail "a row from after the backup came back"
  token="$(sign_in "$fresh" saver@e2e.test saver-pass-1)"
  [ -n "$token" ] && pass "the account signs in with its password" || fail "the account can't sign in after the restore"
  # Storage can still be starting; give it a minute.
  local tries=0
  while :; do
    curl -s -o "$work/body" -w '%{http_code}' "$kong/storage/v1/object/documents/$group/e2e/kept.pdf" \
      -H "apikey: $anon" -H "Authorization: Bearer $token" > "$work/code" || true
    [ "$(cat "$work/code")" = "200" ] || [ "$tries" -ge 20 ] && break
    tries=$((tries + 1))
    sleep 3
  done
  expect_status "the uploaded file downloads after the restore" 200
  grep -q 'e2e kept' "$work/body" && pass "the file's content came back" || fail "the file's content differs"
  check_migration_rows "$fresh" "$name"
}

run_updater() {
  local dir="$work/updater" remote="$work/updater-remote.git" name="$project_prefix-updater" shim="$work/updater-bin"
  local token group status version
  log "one-click update to a new release, then a rollback from a broken one"
  export_tree worktree "$dir"

  # The install is a git checkout of 9.0.0. 9.0.1 adds a migration; 9.0.2
  # adds another and its app exits at once (a last CMD in the Dockerfile), so
  # its health check fails.
  (
    cd "$dir"
    git init -q -b main
    git config user.email e2e@e2e.test
    git config user.name e2e
    sed -i -E "s/^( *version: *')[^']*'/\19.0.0'/" apps/mobile/app.config.ts
    git add -A && git commit -qm "9.0.0"
    git init -q --bare "$remote"
    sed -i -E "s/^( *version: *')[^']*'/\19.0.1'/" apps/mobile/app.config.ts
    printf 'create table if not exists public.e2e_updater_one (id int);\ngrant select on public.e2e_updater_one to anon, authenticated, service_role;\n' \
      > supabase/migrations/29990101000000_e2e_updater_one.sql
    git add -A && git commit -qm "9.0.1" && git tag v9.0.1
    sed -i -E "s/^( *version: *')[^']*'/\19.0.2'/" apps/mobile/app.config.ts
    printf 'create table if not exists public.e2e_updater_two (id int);\ngrant select on public.e2e_updater_two to anon, authenticated, service_role;\n' \
      > supabase/migrations/29990101000001_e2e_updater_two.sql
    printf '\nCMD ["sh", "-c", "exit 1"]\n' >> Dockerfile
    git add -A && git commit -qm "9.0.2" && git tag v9.0.2
    git push -q "$remote" v9.0.1 v9.0.2
    git reset -q --hard HEAD~2 && git tag -d v9.0.1 v9.0.2 > /dev/null
  ) || die "could not make the test releases"

  # GitHub's release check answers from a file; every other call is real curl.
  mkdir -p "$shim"
  cat > "$shim/curl" << SHIM
#!/usr/bin/env bash
case "\$*" in
  *api.github.com*) printf '{"tag_name": "v%s"}\\n' "\$(cat "$work/updater-latest")" ;;
  *) exec "$(command -v curl)" "\$@" ;;
esac
SHIM
  # The installer's cron path, without touching this machine's crontab.
  printf '#!/usr/bin/env bash\nif [ "$1" = "-l" ]; then cat "%s" 2> /dev/null; else cat > "%s"; fi\n' "$work/crontab" "$work/crontab" > "$shim/crontab"
  chmod +x "$shim/curl" "$shim/crontab"

  write_env "$dir"
  set_env "$dir" ROOFTAP_UPDATER_REMOTE "$remote"
  set_env "$dir" ROOFTAP_UPDATER_TIMEOUT 120
  boot "$dir" "$name"
  wait_migrate "$dir" "$name"
  wait_http "$app/api/public-config" 200 300 || die "the app never came up"
  admin_user "$dir" updater@e2e.test updater-pass-1
  token="$(sign_in "$dir" updater@e2e.test updater-pass-1)"
  group="$(household_of "$dir" "$token")"
  add_grocery "$dir" "$token" "$group" e2e-before-update
  expect_status "grocery item added on 9.0.0" 201

  (cd "$dir" && PATH="$shim:$PATH" ./scripts/updater/install.sh --cron) > /dev/null || die "install.sh failed"
  grep -q 'scripts/updater/updater.sh' "$work/crontab" && pass "install.sh added the cron entry" || fail "install.sh added no cron entry"
  [ "$(stat -c %a "$dir/updates/inbox")" = "1733" ] && pass "the inbox is write-only for the app" || fail "inbox mode is $(stat -c %a "$dir/updates/inbox")"
  dc "$dir" "$name" up -d app > /dev/null 2>&1

  # What the Update button leaves, then what cron runs.
  update_to() {
    echo "$1" > "$work/updater-latest"
    echo "$1" > "$dir/updates/inbox/request"
    req GET "$app/api/server-update" "" "Authorization: Bearer $token" > /dev/null
    grep -q '"pending":true' "$work/body" && pass "the app sees the waiting request for $1" || fail "the app does not see the request: $(head -c 300 "$work/body")"
    (cd "$dir" && COMPOSE_PROJECT_NAME="$name" PATH="$shim:$PATH" ./scripts/updater/updater.sh) || fail "updater.sh exited with an error"
    status="$(sed -n 's/.*"state": *"\([^"]*\)".*/\1/p' "$dir/updates/state/status.json")"
    version="$(req GET "$app/api/public-config" "" | json_field version)"
  }

  update_to 9.0.1
  [ "$status" = "done" ] && pass "the update to 9.0.1 finished" || { fail "update status is $status"; tail -30 "$dir/updates/state/update.log" >&2; }
  [ "$version" = "9.0.1" ] && pass "the app reports 9.0.1" || fail "the app reports '$version' after the update"
  [ "$(sql "$dir" "$name" "select count(*) from information_schema.tables where table_name = 'e2e_updater_one'")" = "1" ] \
    && pass "9.0.1's migration ran" || fail "9.0.1's migration did not run"
  ls "$dir"/backups/updater/rooftap-backup-*.tar > /dev/null 2>&1 && pass "a full backup came first" || fail "no backup in backups/updater"
  token="$(sign_in "$dir" updater@e2e.test updater-pass-1)"
  [ "$(groceries_named "$dir" "$token" e2e-before-update)" = "1" ] && pass "the data survived the update" || fail "the item from 9.0.0 is gone"
  req GET "$app/api/server-update" "" "Authorization: Bearer $token" > /dev/null
  grep -q '"state":"done"' "$work/body" && pass "the app shows the finished update" || fail "the app shows no finished update: $(head -c 300 "$work/body")"
  add_grocery "$dir" "$token" "$group" e2e-after-update
  expect_status "a write on 9.0.1" 201

  update_to 9.0.2
  [ "$status" = "rolled-back" ] && pass "the broken 9.0.2 was rolled back" || { fail "rollback status is $status"; tail -40 "$dir/updates/state/update.log" >&2; }
  grep -q '"dataRestored": true' "$dir/updates/state/status.json" && pass "the database was restored" || fail "the database was not restored"
  [ "$version" = "9.0.1" ] && pass "the app is back on 9.0.1" || fail "the app reports '$version' after the rollback"
  [ "$(sql "$dir" "$name" "select count(*) from information_schema.tables where table_name = 'e2e_updater_two'")" = "0" ] \
    && pass "9.0.2's migration was undone" || fail "9.0.2's table is still there"
  token="$(sign_in "$dir" updater@e2e.test updater-pass-1)"
  [ "$(groceries_named "$dir" "$token" e2e-after-update)" = "1" ] && pass "the write made on 9.0.1 survived the rollback" || fail "the rollback lost the write made on 9.0.1"
  [ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ] && [ "$(git -C "$dir" describe --tags --exact-match 2> /dev/null)" = "v9.0.1" ] \
    && pass "the checkout is back on v9.0.1" || fail "the checkout is at $(git -C "$dir" describe --tags --always)"
}

case "$mode" in
  fresh) run_fresh ;;
  upgrade) run_upgrade ;;
  backup) run_backup ;;
  updater) run_updater ;;
  all) run_fresh; run_upgrade; run_backup; run_updater ;;
esac

echo
if [ "$failures" -gt 0 ]; then
  echo "[e2e] $failures check(s) failed"
  exit 1
fi
echo "[e2e] all checks passed"
