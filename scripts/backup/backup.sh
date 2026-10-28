#!/usr/bin/env bash
set -euo pipefail

# Full backup of a self-hosted Rooftap server (.docs/self-hosting.md
# "Backing up your server"). Writes one file that holds everything needed to
# bring the server back on a new machine:
#
#   database/database.dump   pg_dump of the whole database (custom format)
#   database/migration.txt   the newest migration the database has applied
#   files/storage.tar.gz     the storage-data volume (uploaded files)
#   config/env               .env: every secret and setting
#   config/docker-compose.override.yml   when there is one
#   server/source.tar.gz     the Rooftap source the server runs (git archive)
#   server/images.tar        only with --with-images: every Docker image, so a
#                            restore needs no download
#   manifest.json            versions, image digests, part sizes and checksums
#   SHA256SUMS               the same checksums, for sha256sum -c
#   RESTORE.txt              how to restore by hand, without these scripts
#
# Usage: ./scripts/backup/backup.sh [--only database,files,config,server]
#                                   [--with-images] [--out <dir>] [--quiet]
#
# Settings come from the environment or from .env (the environment wins):
#   BACKUP_DIR               where backups go (default: backups)
#   BACKUP_KEEP              how many full backups to keep (default 7, 0 = all)
#   BACKUP_PASSPHRASE_FILE   a file whose first line is the passphrase; turns
#                            on encryption (AES-256, openssl, PBKDF2)
#   BACKUP_PASSPHRASE        the passphrase itself, if you can't use a file
#   BACKUP_AFTER             a shell command run after each backup, with the
#                            file in $BACKUP_FILE (for example an rclone copy)
#
# The database is dumped before the files are archived, so every file record
# in the dump has its file. The stack keeps running; nothing is stopped.

cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1
umask 077

parts="database,files,config,server"
with_images=0
out_override=""
quiet=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) parts="$2"; shift 2 ;;
    --with-images) with_images=1; shift ;;
    --out) out_override="$2"; shift 2 ;;
    --quiet) quiet=1; shift ;;
    -h|--help) sed -n '4,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown option $1 (see --help)" >&2; exit 1 ;;
  esac
done

say() { [ "$quiet" -eq 1 ] || echo "$@"; }
die() { echo "error: $*" >&2; exit 1; }
has_part() { case ",$parts," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

for p in ${parts//,/ }; do
  case "$p" in database|files|config|server) ;; *) die "unknown part '$p' (use database, files, config, server)" ;; esac
done

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

sha256() {
  if command -v sha256sum > /dev/null; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
size_of() { wc -c < "$1" | tr -d ' '; }
json_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r')"; }

command -v docker > /dev/null || die "docker is not installed"
command -v openssl > /dev/null || die "openssl is not installed"

backup_dir="${out_override:-$(setting BACKUP_DIR backups)}"
keep="$(setting BACKUP_KEEP 7)"
passphrase_file="$(setting BACKUP_PASSPHRASE_FILE)"
passphrase="$(setting BACKUP_PASSPHRASE)"
after="$(setting BACKUP_AFTER)"
[[ "$keep" =~ ^[0-9]+$ ]] || die "BACKUP_KEEP must be a number, not '$keep'"
if [ -n "$passphrase_file" ] && [ ! -r "$passphrase_file" ]; then
  die "BACKUP_PASSPHRASE_FILE is $passphrase_file, but that file can't be read"
fi

mkdir -p "$backup_dir" 2> /dev/null || true
if [ ! -w "$backup_dir" ]; then
  die "can't write to $backup_dir. Docker may have made it as root: run 'sudo chown \"\$USER\" $backup_dir', or set BACKUP_DIR."
fi

# One backup at a time (a scheduled run and a manual run could meet).
if command -v flock > /dev/null; then
  exec 9> "$backup_dir/.backup.lock"
  flock -n 9 || die "another backup is running (lock: $backup_dir/.backup.lock)"
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="rooftap-backup-$stamp"
work="$(mktemp -d "$backup_dir/.$name.XXXXXX")"
stage="$work/$name"
started_db=0
cleanup() {
  rm -rf "$work"
  if [ "$started_db" -eq 1 ]; then docker compose stop db > /dev/null 2>&1 || true; fi
}
trap cleanup EXIT
mkdir -p "$stage"

# Container of a compose service, running or stopped.
container_of() { docker compose ps -a -q "$1" 2> /dev/null | head -1; }
volume_at() {
  docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Name}}{{end}}{{end}}" "$1"
}

newest_checkout_migration="$(basename "$(ls -1 supabase/migrations/*.sql | sort | tail -1)" .sql)"
db_migration=""
pg_version=""

if has_part database; then
  if [ -z "$(docker compose ps -q db 2> /dev/null)" ]; then
    say "Starting db to dump it ..."
    docker compose up -d --wait db > /dev/null
    started_db=1
  fi
  db="$(docker compose ps -q db)"
  mkdir -p "$stage/database"
  db_migration="$(docker exec "$db" psql -U supabase_admin -d postgres -At \
    -c 'select max(version) from supabase_migrations.schema_migrations' 2> /dev/null | tr -d '[:space:]' || true)"
  [ -n "$db_migration" ] || die "the database has no migration history. Has the stack booted once?"
  pg_version="$(docker exec "$db" psql -U supabase_admin -d postgres -At -c 'show server_version' | tr -d '\r')"
  printf '%s\n' "$db_migration" > "$stage/database/migration.txt"
  say "Dumping the database (migration $db_migration) ..."
  # supabase_admin: the superuser, so every schema is readable. A consistent
  # snapshot, while the app keeps running.
  if ! docker exec "$db" pg_dump -U supabase_admin -d postgres --format=custom > "$stage/database/database.dump"; then
    die "pg_dump failed; no backup was written"
  fi
  if [ "$started_db" -eq 1 ]; then docker compose stop db > /dev/null; started_db=0; fi
fi

if has_part files; then
  storage="$(container_of storage)"
  [ -n "$storage" ] || die "no storage container; start the stack once (./scripts/self-host-init.sh -d) first"
  volume="$(volume_at "$storage" /var/lib/storage)"
  [ -n "$volume" ] || die "couldn't find the storage container's data volume"
  mkdir -p "$stage/files"
  say "Archiving uploaded files (volume $volume) ..."
  # postgres:17 because the migrate service already pulled it, so this needs
  # no new image (and its GNU tar keeps extended attributes: the storage
  # service keeps each file's content type and ETag in them, and answers 500
  # for a file without them). Read-only mount: the backup never changes the
  # volume.
  docker run --rm -v "$volume:/data:ro" postgres:17 \
    tar -C /data --numeric-owner --xattrs --xattrs-include='*' -czf - . > "$stage/files/storage.tar.gz" \
    || die "archiving the storage volume failed; no backup was written"
fi

if has_part config; then
  mkdir -p "$stage/config"
  if [ -f .env ]; then
    cp .env "$stage/config/env"
  else
    say "warning: there is no .env; the backup has no secrets or settings"
  fi
  [ -f docker-compose.override.yml ] && cp docker-compose.override.yml "$stage/config/docker-compose.override.yml"
fi

commit=""
describe=""
dirty=false
if git rev-parse --git-dir > /dev/null 2>&1; then
  commit="$(git rev-parse HEAD)"
  describe="$(git describe --tags --always 2> /dev/null || echo "$commit")"
  [ -z "$(git status --porcelain --untracked-files=no 2> /dev/null)" ] || dirty=true
fi
app_version="$(sed -n "s/^ *version: *['\"]\([^'\"]*\)['\"].*/\1/p" apps/mobile/app.config.ts 2> /dev/null | head -1)"

if has_part server; then
  mkdir -p "$stage/server"
  say "Saving the server source ($describe) ..."
  if [ -n "$commit" ]; then
    # `git stash create` makes a commit of uncommitted changes to tracked
    # files without touching the work tree; empty when there are none.
    tree="$(git stash create 2> /dev/null || true)"
    git archive --format=tar.gz -o "$stage/server/source.tar.gz" "${tree:-HEAD}"
  else
    tar --exclude=./.git --exclude=./node_modules --exclude='./*/node_modules' --exclude='./*/*/node_modules' \
      --exclude=./backups --exclude=./server-export --exclude=./.env --exclude='./*.before-restore-*' \
      -czf "$stage/server/source.tar.gz" .
  fi
fi

# Every service's image, its tag and its digest, so a restore can run the
# exact same images even after a tag moves.
images_json=""
image_refs=()
for svc in $(docker compose config --services 2> /dev/null); do
  cid="$(container_of "$svc")"
  [ -n "$cid" ] || continue
  ref="$(docker inspect -f '{{.Config.Image}}' "$cid")"
  id="$(docker inspect -f '{{.Image}}' "$cid")"
  digest="$(docker image inspect -f '{{join .RepoDigests ","}}' "$id" 2> /dev/null || true)"
  image_refs+=("$ref")
  images_json+="${images_json:+,}
      $(json_str "$svc"): { \"image\": $(json_str "$ref"), \"id\": $(json_str "$id"), \"digests\": $(json_str "$digest") }"
done

if [ "$with_images" -eq 1 ]; then
  [ ${#image_refs[@]} -gt 0 ] || die "--with-images: no containers found; start the stack first"
  mkdir -p "$stage/server"
  say "Saving ${#image_refs[@]} Docker images (this can take a few GB) ..."
  docker save -o "$stage/server/images.tar" $(printf '%s\n' "${image_refs[@]}" | sort -u)
fi

cp scripts/backup/RESTORE.txt "$stage/RESTORE.txt"

parts_json=""
(cd "$stage" && find . -type f ! -name SHA256SUMS ! -name manifest.json ! -name RESTORE.txt | sed 's|^\./||' | sort) > "$work/files.txt"
: > "$stage/SHA256SUMS"
while IFS= read -r path; do
  sum="$(sha256 "$stage/$path")"
  bytes="$(size_of "$stage/$path")"
  printf '%s  %s\n' "$sum" "$path" >> "$stage/SHA256SUMS"
  parts_json+="${parts_json:+,}
    { \"path\": $(json_str "$path"), \"bytes\": $bytes, \"sha256\": \"$sum\" }"
done < "$work/files.txt"

source_matches=true
[ -z "$db_migration" ] || [ "$db_migration" = "$newest_checkout_migration" ] || source_matches=false

cat > "$stage/manifest.json" <<JSON
{
  "format": "rooftap-backup",
  "formatVersion": 1,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": $(json_str "$(hostname 2> /dev/null || echo unknown)"),
  "parts": $(json_str "$parts"),
  "server": {
    "appVersion": $(json_str "$app_version"),
    "commit": $(json_str "$commit"),
    "describe": $(json_str "$describe"),
    "uncommittedChanges": $dirty,
    "databaseMigration": $(json_str "$db_migration"),
    "checkoutMigration": $(json_str "$newest_checkout_migration"),
    "sourceMatchesDatabase": $source_matches,
    "postgres": $(json_str "$pg_version"),
    "images": {${images_json}
    }
  },
  "files": [${parts_json}
  ]
}
JSON

if [ "$source_matches" = false ]; then
  say "warning: the database is at migration $db_migration, but this checkout's newest is $newest_checkout_migration."
  say "         The checkout is not the version the server runs (a 'git pull' without an upgrade?)."
  say "         server/source.tar.gz is this checkout; restore with the version whose newest migration is $db_migration."
fi

final="$backup_dir/$name.tar"
tar -C "$work" -cf "$work/$name.tar" "$name"
if [ -n "$passphrase_file" ] || [ -n "$passphrase" ]; then
  final="$final.enc"
  if [ -n "$passphrase_file" ]; then pass_arg="file:$passphrase_file"
  else export ROOFTAP_BACKUP_PASS="$passphrase"; pass_arg="env:ROOFTAP_BACKUP_PASS"; fi
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt -pass "$pass_arg" \
    -in "$work/$name.tar" -out "$final.partial"
  unset ROOFTAP_BACKUP_PASS
else
  mv "$work/$name.tar" "$final.partial"
fi
mv "$final.partial" "$final"
# A checksum of the file as stored, to check a copy without the passphrase.
printf '%s  %s\n' "$(sha256 "$final")" "$(basename "$final")" > "$final.sha256"

say "Backup written: $final ($(du -h "$final" | cut -f1))"
if [ -z "$passphrase_file" ] && [ -z "$passphrase" ] && has_part config; then
  echo "warning: this backup is NOT encrypted, and it holds .env (database password, signing keys) and every account's password hash." >&2
  echo "         Set BACKUP_PASSPHRASE_FILE to encrypt it, or keep the file on encrypted storage only." >&2
fi

# Retention: only full backups, never the pre-migrate dumps.
if [ "$keep" -gt 0 ]; then
  { ls -1t "$backup_dir"/rooftap-backup-*.tar "$backup_dir"/rooftap-backup-*.tar.enc 2> /dev/null || true; } \
    | tail -n +"$((keep + 1))" | while IFS= read -r old; do
      rm -f "$old" "$old.sha256"
      say "Removed old backup $(basename "$old")"
    done
fi

if [ -n "$after" ]; then
  say "Running BACKUP_AFTER ..."
  BACKUP_FILE="$final" bash -c "$after" || die "BACKUP_AFTER failed (the backup itself is fine: $final)"
fi
