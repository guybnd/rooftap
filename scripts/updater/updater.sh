#!/usr/bin/env bash
set -euo pipefail

# One-click updates for a self-hosted Rooftap server (.docs/self-hosting.md
# "One-click updates"). Runs on the host, never in a container, and only
# after the operator turns it on with scripts/updater/install.sh.
#
# The app asks for an update by writing one version number to
# updates/inbox/request (the only folder the app container can write to).
# This script reads that number and nothing else. It updates only when the
# number is the newest published release, newer than the running one. Then:
#
#   1. backup    scripts/backup/backup.sh into backups/updater (a failed
#                backup stops here)
#   2. download  fetches the release tag and moves the checkout to it
#   3. build     docker compose build app (the old app keeps serving)
#   4. restart   scripts/self-host-init.sh -d, which runs new migrations
#                (the migrate service dumps the database just before)
#   5. health    waits for /api/public-config to report the new version
#
# If step 3 or later fails, it goes back to the old checkout. If the
# restart has already happened, it rebuilds and restarts the old version too,
# and when new migrations ran it restores the database from the dump the
# migrate service made right before them, so writes made during the build are
# kept. It falls back to the step 1 backup when there is no such dump.
# A release that changes the database image is left to the operator: going
# back across a Postgres upgrade is not safe to do unattended.
#
# Progress goes to updates/state/status.json, which the app reads (read-only)
# to show the operator. The full log is updates/state/update.log.
#
# Usage: ./scripts/updater/updater.sh            handle a waiting request
#        ./scripts/updater/updater.sh --status   print status.json
#
# Settings come from the environment or from .env (the environment wins):
#   ROOFTAP_SERVER_UPDATES   the GitHub repo whose releases to follow
#                            (default guybnd/rooftap, "off" turns updates off)
#   ROOFTAP_UPDATER_REMOTE   the git URL to fetch release tags from
#                            (default https://github.com/<that repo>.git)
#   ROOFTAP_UPDATER_TIMEOUT  seconds to wait for the new version to answer
#                            (default 600)

# Run from a copy: step 2 rewrites this file in the checkout, and bash reads a
# script as it goes.
if [ "${ROOFTAP_UPDATER_COPY:-}" != 1 ]; then
  repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
  copy="$(mktemp "${TMPDIR:-/tmp}/rooftap-updater.XXXXXX")"
  cp "$0" "$copy"
  ROOFTAP_UPDATER_COPY=1 ROOFTAP_UPDATER_REPO="$repo_dir" exec bash "$copy" "$@"
fi
self_copy="$0"

cd "$ROOFTAP_UPDATER_REPO"
export MSYS_NO_PATHCONV=1

inbox="updates/inbox"
state="updates/state"
request="$inbox/request"
status_file="$state/status.json"
log_file="$state/update.log"
lock_dir="$state/.lock"

# A value as Docker Compose reads it: surrounding quotes removed.
unquote() {
  local v="$1"
  case "$v" in
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
  esac
  printf '%s' "$v"
}
env_value() { [ -f .env ] && unquote "$(grep -E "^$1=" .env | tail -1 | cut -d= -f2-)" || true; }
setting() {
  local name="$1" fallback="${2:-}" value
  value="${!name:-}"
  [ -n "$value" ] || value="$(env_value "$name")"
  printf '%s' "${value:-$fallback}"
}
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
json_str() {
  if [ -z "$1" ]; then printf 'null'; return; fi
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\037')"
}

case "${1:-}" in
  --status) cat "$status_file" 2> /dev/null || echo '{}'; rm -f "$self_copy"; exit 0 ;;
  "") ;;
  *) echo "error: unknown option $1" >&2; rm -f "$self_copy"; exit 1 ;;
esac

[ -d "$state" ] || { rm -f "$self_copy"; echo "One-click updates are off. Run ./scripts/updater/install.sh to turn them on." >&2; exit 1; }

# One update at a time. A lock left by a process that is gone is taken over.
if ! mkdir "$lock_dir" 2> /dev/null; then
  holder="$(cat "$lock_dir/pid" 2> /dev/null || true)"
  if [ -n "$holder" ] && kill -0 "$holder" 2> /dev/null; then rm -f "$self_copy"; exit 0; fi
  rm -rf "$lock_dir"
  mkdir "$lock_dir" || { rm -f "$self_copy"; exit 0; }
fi
echo $$ > "$lock_dir/pid"
trap 'rm -rf "$lock_dir"; rm -f "$self_copy"' EXIT

# Nothing asked: the usual case under cron, which runs this every minute.
[ -e "$request" ] || [ -L "$request" ] || exit 0

# The app can write to the inbox, so read it with care: a plain file, a few
# bytes, one version number. Anything else is dropped.
target=""
if [ -f "$request" ] && [ ! -L "$request" ]; then
  target="$(head -c 64 "$request" | tr -d '[:space:]')"
fi
rm -f "$request" 2> /dev/null || echo "$(now) could not remove the request" >> "$log_file"
VERSION_RE='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'
if ! [[ "$target" =~ $VERSION_RE ]]; then
  echo "$(now) dropped a request that was not a version number" >> "$log_file" 2> /dev/null
  exit 0
fi

umask 022
started="$(now)"
from=""
step="check"
failed_step=""
message=""
data_restored=false

# status <state>: writes status.json in one rename, so the app never reads half.
status() {
  local s="$1" finished=""
  case "$s" in running) ;; *) finished="$(now)" ;; esac
  local tmp
  # Never let a failed write (a full disk) stop the script mid-update.
  tmp="$(mktemp "$state/.status.XXXXXX" 2> /dev/null)" || return 0
  cat > "$tmp" 2> /dev/null <<JSON
{
  "state": $(json_str "$s"),
  "from": $(json_str "$from"),
  "target": $(json_str "$target"),
  "step": $(json_str "$step"),
  "failedStep": $(json_str "$failed_step"),
  "message": $(json_str "$message"),
  "dataRestored": $data_restored,
  "startedAt": $(json_str "$started"),
  "updatedAt": $(json_str "$(now)"),
  "finishedAt": $(json_str "$finished")
}
JSON
  chmod 644 "$tmp" 2> /dev/null || true
  mv -f "$tmp" "$status_file" 2> /dev/null || rm -f "$tmp"
}
log() { echo "$(now) $*" >> "$log_file" 2> /dev/null || true; }
at() { step="$1"; status running; log "== $1"; }
# Stops before anything changed.
refuse() { failed_step="$step"; message="$1"; log "refused: $1"; status failed; exit 0; }

# Runs a long step while rewriting status.json every minute, so the app can
# tell a slow build (a Raspberry Pi) from an updater that stopped.
beating() {
  # Its sleep is killed with it, and it holds no output open, so a step run
  # inside $(...) returns as soon as it is done.
  (
    trap 'kill "$nap" 2> /dev/null; exit 0' TERM
    while :; do
      sleep 60 & nap=$!
      wait "$nap"
      status running
    done
  ) > /dev/null 2>&1 &
  local beat=$! rc
  "$@"
  rc=$?
  kill "$beat" 2> /dev/null
  wait "$beat" 2> /dev/null
  return "$rc"
}

# Keep the previous run's log, so a second request cannot wipe the reason
# the first one failed.
[ -f "$log_file" ] && mv -f "$log_file" "$log_file.1"
: > "$log_file"
chmod 600 "$log_file"
log "update to $target requested"
status running

# ── Checks: nothing changes until all of these pass ──
from="$(sed -n "s/^[[:space:]]*version: *['\"]\\([^'\"]*\\)['\"].*/\\1/p" apps/mobile/app.config.ts | head -1)"
[ -n "$from" ] || refuse "Could not tell which version this server runs."
repo="$(setting ROOFTAP_SERVER_UPDATES guybnd/rooftap)"
if [[ "$repo" =~ ^(off|false|0|no)$ ]] || ! [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  refuse "Release checks are off on this server (ROOFTAP_SERVER_UPDATES)."
fi
remote="$(setting ROOFTAP_UPDATER_REMOTE "https://github.com/$repo.git")"
timeout="$(setting ROOFTAP_UPDATER_TIMEOUT 600)"
[[ "$timeout" =~ ^[0-9]+$ ]] || timeout=600
port="$(setting APP_PORT 3737)"
# The app listens on APP_BIND; 0.0.0.0 (the default) includes the loopback.
host="$(setting APP_BIND 0.0.0.0)"
case "$host" in 0.0.0.0|"::"|"") host="127.0.0.1" ;; esac
case "$host" in *:*) host="[$host]" ;; esac

for tool in git curl docker; do
  command -v "$tool" > /dev/null || refuse "$tool is not installed on the server."
done
[ -z "$(git status --porcelain --untracked-files=no)" ] || refuse "The Rooftap folder on the server has local changes, so it was not updated. Update it by hand."

latest="$(curl -fsS --max-time 15 -H 'Accept: application/vnd.github+json' -H 'User-Agent: Rooftap-updater' \
  "https://api.github.com/repos/$repo/releases/latest" 2>> "$log_file" \
  | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1 || true)"
[ -n "$latest" ] || refuse "Could not reach GitHub to check the release. Nothing was changed."
[ "$target" = "$latest" ] || refuse "$target is not the newest release ($latest), so it was not installed."
newest="$(printf '%s\n%s\n' "$from" "$target" | sort -V | tail -1)"
if [ "$target" = "$from" ] || [ "$newest" != "$target" ]; then refuse "This server already runs $from."; fi

# Fetching the tag changes nothing the server runs.
git fetch --no-tags "$remote" "refs/tags/v$target:refs/tags/v$target" >> "$log_file" 2>&1 \
  || refuse "Could not get $target from GitHub. Nothing was changed."
db_image() { git show "$1:docker-compose.yml" 2> /dev/null | sed -n 's/^[[:space:]]*image: *\(supabase\/postgres:[^[:space:]]*\).*/\1/p' | head -1; }
if [ "$(db_image HEAD)" != "$(db_image "v$target")" ]; then
  refuse "$target changes the database image ($(db_image "v$target")). Read the release notes and update by hand."
fi
if git symbolic-ref -q HEAD > /dev/null && ! git merge-base --is-ancestor HEAD "v$target"; then
  refuse "The Rooftap folder has commits that are not in $target, so it was not updated. Update it by hand."
fi
prev="$(git rev-parse HEAD)"
db_migration() {
  local db
  db="$(docker compose ps -q db 2> /dev/null | head -1)"
  [ -n "$db" ] || return 0
  docker exec "$db" psql -U supabase_admin -d postgres -At \
    -c 'select max(version) from supabase_migrations.schema_migrations' 2> /dev/null | tr -d '[:space:]' || true
}
schema_before="$(db_migration)"

# ── 1. Backup ──
at backup
# Its own folder and a short retention, so repeated requests can never rotate
# out the operator's own backups.
backup_out="$(beating env BACKUP_KEEP=2 ./scripts/backup/backup.sh --out backups/updater 2>&1)" || { echo "$backup_out" >> "$log_file"; refuse "The backup failed, so nothing was changed."; }
echo "$backup_out" >> "$log_file"
backup_file="$(printf '%s\n' "$backup_out" | sed -n 's/^Backup written: \(.*\) ([^)]*)$/\1/p' | tail -1)"
[ -n "$backup_file" ] && [ -f "$backup_file" ] || refuse "The backup did not finish, so nothing was changed."

# ── 2. Download ──
at download
if git symbolic-ref -q HEAD > /dev/null; then
  git merge --ff-only "v$target" >> "$log_file" 2>&1 \
    || refuse "The Rooftap folder has commits that are not in $target, so it was not updated. Update it by hand."
else
  git checkout --detach "v$target" >> "$log_file" 2>&1 || refuse "Could not check out $target. Nothing was changed."
fi

# From here on a failure goes back to $prev. Every step below checks its own
# result, and nothing may stop the script before it has gone back.
set +e
reason() {
  if grep -qi 'no space left on device' "$log_file"; then
    printf 'The server ran out of disk space. Free some space, then try again.'
  else
    printf 'The log on the server is updates/state/update.log.'
  fi
}
restarted=false
roll_back() {
  failed_step="$step"
  local why="$1"
  step="rollback"
  status running
  log "== rolling back to $prev: $why"
  local ok=true
  git reset --keep "$prev" >> "$log_file" 2>&1 || ok=false
  if [ "$ok" = true ] && [ "$restarted" = true ]; then
    if [ -n "$schema_before" ] && [ "$(db_migration)" != "$schema_before" ]; then
      # New migrations ran: put the data back as it was just before them.
      # Both restores also rebuild and start the old version.
      local dump
      dump="$(find backups -maxdepth 1 -name 'pre-migrate-*.dump' -newer "$backup_file" 2> /dev/null | sort | tail -1)"
      if [ -n "$dump" ]; then
        beating ./scripts/restore-backup.sh "$dump" --yes >> "$log_file" 2>&1 && data_restored=true || ok=false
      else
        beating ./scripts/backup/restore.sh "$backup_file" --only database --yes >> "$log_file" 2>&1 && data_restored=true || ok=false
      fi
    fi
    if [ "$ok" = true ] && [ "$data_restored" = false ]; then
      beating docker compose build app >> "$log_file" 2>&1 && beating ./scripts/self-host-init.sh -d >> "$log_file" 2>&1 || ok=false
    fi
    [ "$ok" = true ] && beating wait_for_version "$from" || ok=false
  fi
  if [ "$ok" = true ]; then
    message="$why Rooftap is back on $from. $(reason)"
    status rolled-back
  else
    message="$why Going back to $from also failed. The backup from before the update is $backup_file. See updates/state/update.log on the server."
    status failed
  fi
  exit 0
}

wait_for_version() {
  local want="$1" deadline=$(( $(date +%s) + timeout )) got
  while [ "$(date +%s)" -lt "$deadline" ]; do
    got="$(curl -fsS --max-time 5 "http://$host:$port/api/public-config" 2> /dev/null \
      | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1 || true)"
    [ "$got" = "$want" ] && return 0
    sleep 5
  done
  return 1
}

migrate_ok() {
  local c deadline=$(( $(date +%s) + timeout )) st
  c="$(docker compose ps -a -q migrate 2> /dev/null | head -1)"
  [ -n "$c" ] || return 0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    st="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$c" 2> /dev/null || true)"
    case "$st" in
      "exited 0") return 0 ;;
      exited*) return 1 ;;
    esac
    sleep 3
  done
  return 1
}

# ── 3. Build, while the old app keeps serving ──
at build
beating docker compose build app >> "$log_file" 2>&1 || roll_back "$target did not build."

# ── 4. Restart ──
at restart
restarted=true
beating ./scripts/self-host-init.sh -d >> "$log_file" 2>&1 || roll_back "$target did not start."
beating migrate_ok || roll_back "The database update for $target failed."

# ── 5. Health ──
at health
beating wait_for_version "$target" || roll_back "$target did not answer within $(( (timeout + 59) / 60 )) minutes."

step="done"
message=""
status done
log "== updated $from to $target"
