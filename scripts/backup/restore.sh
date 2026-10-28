#!/usr/bin/env bash
set -euo pipefail

# Restores a full backup from scripts/backup/backup.sh onto this machine
# (.docs/self-hosting.md "Restoring a full backup"). Works on the machine the
# backup came from and on a new one with nothing installed but Docker.
#
# Usage:
#   ./scripts/backup/restore.sh <backup> [--only database,files,config] [--yes] [--no-build]
#   ./scripts/backup/restore.sh <backup> --info             show what is in it
#   ./scripts/backup/restore.sh <backup> --check            verify it, change nothing
#   ./scripts/backup/restore.sh <backup> --unpack-source <dir>
#                                         unpack the Rooftap source it holds
#
# <backup> is a rooftap-backup-<time>.tar or .tar.enc file. For a .tar.enc
# set BACKUP_PASSPHRASE_FILE or BACKUP_PASSPHRASE, or type the passphrase
# when asked.
#
# A restore puts back, in this order:
#   config     .env and docker-compose.override.yml. A different .env here is
#              kept as .env.before-restore-<time>.
#   files      replaces the uploaded files in the storage volume.
#   database   through scripts/restore-backup.sh: deletes the database volume,
#              rebuilds the schema from this checkout's migrations and loads
#              the backup's rows, then starts the stack. Run it from the
#              Rooftap version the backup was taken with; the script checks.
# The old .env keeps the old signing keys, so phones and browsers stay signed
# in. Anything written after the backup is lost.

cd "$(dirname "$0")/../.."
export MSYS_NO_PATHCONV=1
umask 077

backup=""
parts="database,files,config"
action="restore"
unpack_dir=""
confirmed=0
build_flag=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) parts="$2"; shift 2 ;;
    --info) action="info"; shift ;;
    --check) action="check"; shift ;;
    --unpack-source)
      [ $# -ge 2 ] || { echo "error: --unpack-source needs a folder" >&2; exit 1; }
      action="unpack"; unpack_dir="$2"; shift 2 ;;
    --yes) confirmed=1; shift ;;
    --no-build) build_flag="--no-build"; shift ;;
    -h|--help) sed -n '4,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "error: unknown option $1 (see --help)" >&2; exit 1 ;;
    *) backup="$1"; shift ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
has_part() { case ",$parts," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
for p in ${parts//,/ }; do
  case "$p" in database|files|config) ;; *) die "unknown part '$p' (use database, files, config)" ;; esac
done

[ -n "$backup" ] && [ -f "$backup" ] || die "usage: $0 <rooftap-backup-<time>.tar[.enc]> [options] (see --help)"
command -v openssl > /dev/null || die "openssl is not installed"

sha256_check() {
  if command -v sha256sum > /dev/null; then sha256sum -c --quiet SHA256SUMS
  else shasum -a 256 -c --quiet SHA256SUMS; fi
}
# A value as Docker Compose reads it: surrounding quotes removed.
unquote() {
  local v="$1"
  case "$v" in
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
  esac
  printf '%s' "$v"
}
env_value() { [ -f "$1" ] && unquote "$(grep -E "^$2=" "$1" | tail -1 | cut -d= -f2-)" || true; }
json_field() { sed -n "s/.*\"$1\": *\"\\([^\"]*\\)\".*/\\1/p" "$2" | head -1; }

# Unpack next to the backup's usual folder, not /tmp: the parts can be large
# and /tmp is often small. Removed on exit.
mkdir -p backups 2> /dev/null || true
scratch_parent="backups"
[ -w "$scratch_parent" ] || scratch_parent="${TMPDIR:-/tmp}"
work="$(mktemp -d "$scratch_parent/.restore.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if [ -f "$backup.sha256" ]; then
  want="$(cut -d' ' -f1 < "$backup.sha256")"
  if command -v sha256sum > /dev/null; then got="$(sha256sum "$backup" | cut -d' ' -f1)"
  else got="$(shasum -a 256 "$backup" | cut -d' ' -f1)"; fi
  [ "$want" = "$got" ] || die "$backup does not match $backup.sha256; the file is damaged or incomplete"
fi

case "$backup" in
  *.enc)
    pass_file="${BACKUP_PASSPHRASE_FILE:-$(env_value .env BACKUP_PASSPHRASE_FILE)}"
    pass="${BACKUP_PASSPHRASE:-$(env_value .env BACKUP_PASSPHRASE)}"
    if [ -n "$pass_file" ]; then pass_arg="file:$pass_file"
    else
      if [ -z "$pass" ]; then
        read -r -s -p "Passphrase for $(basename "$backup"): " pass
        echo
      fi
      export ROOFTAP_BACKUP_PASS="$pass"
      pass_arg="env:ROOFTAP_BACKUP_PASS"
    fi
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass "$pass_arg" -in "$backup" \
      | tar -xf - -C "$work" 2> /dev/null \
      || die "couldn't decrypt $backup. Is the passphrase right?"
    unset ROOFTAP_BACKUP_PASS
    ;;
  *) tar -xf "$backup" -C "$work" || die "couldn't unpack $backup" ;;
esac

src="$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'rooftap-backup-*' | head -1)"
[ -n "$src" ] && [ -f "$src/manifest.json" ] || die "$backup is not a Rooftap full backup (no manifest.json)"
manifest="$src/manifest.json"
format_version="$(sed -n 's/.*"formatVersion": *\([0-9]*\).*/\1/p' "$manifest" | head -1)"
[ "$format_version" = "1" ] || die "backup format $format_version is newer than this script knows; use a newer Rooftap checkout to restore it"

(cd "$src" && sha256_check) || die "a part of the backup does not match its checksum; the backup is damaged"

migration="$(json_field databaseMigration "$manifest")"
commit="$(json_field commit "$manifest")"
describe="$(json_field describe "$manifest")"

if [ "$action" = "info" ]; then
  echo "Backup:     $(basename "$backup")"
  echo "Taken:      $(json_field createdAt "$manifest") on $(json_field host "$manifest")"
  echo "Rooftap:    ${describe:-unknown} (app $(json_field appVersion "$manifest"), commit ${commit:-unknown})"
  echo "Database:   migration ${migration:-not in this backup}, Postgres $(json_field postgres "$manifest")"
  echo "Parts:"
  sed 's/^[0-9a-f]*  /  /' "$src/SHA256SUMS"
  echo "Checksums:  all parts match"
  exit 0
fi

if [ "$action" = "unpack" ]; then
  [ -n "$unpack_dir" ] || die "--unpack-source needs a folder"
  [ -f "$src/server/source.tar.gz" ] || die "this backup has no server source (it was taken with --only)"
  mkdir -p "$unpack_dir"
  [ -z "$(ls -A "$unpack_dir")" ] || die "$unpack_dir is not empty"
  tar -xzf "$src/server/source.tar.gz" -C "$unpack_dir"
  echo "Unpacked Rooftap ${describe:-} into $unpack_dir."
  echo "Restore from there: cd $unpack_dir && ./scripts/backup/restore.sh $(cd "$(dirname "$backup")" && pwd)/$(basename "$backup")"
  exit 0
fi

command -v docker > /dev/null || die "docker is not installed"

if [ "$action" = "check" ]; then
  if [ -f "$src/database/database.dump" ]; then
    docker run --rm -i postgres:17 pg_restore -l < "$src/database/database.dump" > "$work/dump.list" \
      || die "pg_restore can't read the database dump"
    echo "Database dump readable: $(grep -c ' TABLE DATA ' "$work/dump.list") tables"
  fi
  if [ -f "$src/files/storage.tar.gz" ]; then
    tar -tzf "$src/files/storage.tar.gz" > "$work/files.list" || die "the files archive is damaged"
    echo "Files archive readable: $(grep -vc '/$' "$work/files.list") entries"
  fi
  [ -f "$src/config/env" ] && echo "Config: .env with $(grep -cE '^[A-Z_]+=' "$src/config/env") settings"
  echo "Backup $(basename "$backup") is good (checksums match)."
  exit 0
fi

# Only the parts this backup has.
want_db=0; want_files=0; want_config=0
has_part database && [ -f "$src/database/database.dump" ] && want_db=1
has_part files && [ -f "$src/files/storage.tar.gz" ] && want_files=1
has_part config && [ -f "$src/config/env" ] && want_config=1
[ $((want_db + want_files + want_config)) -gt 0 ] || die "nothing to restore: the backup has none of the parts asked for ($parts)"

checkout_migration="$(basename "$(ls -1 supabase/migrations/*.sql | sort | tail -1)" .sql)"
if [ "$want_db" -eq 1 ] && [ "$migration" != "$checkout_migration" ]; then
  echo "error: the backup's database is at migration $migration, but this checkout's newest is $checkout_migration." >&2
  echo "Restore with the Rooftap version the backup was taken with (${describe:-commit $commit}). Either:" >&2
  [ -n "$commit" ] && echo "  git fetch && git checkout $commit" >&2
  echo "  or unpack the source the backup holds: $0 $backup --unpack-source ../rooftap-restore" >&2
  echo "Then run the restore from that folder. Upgrade to a newer version afterwards, the usual way." >&2
  exit 1
fi

echo "This restores $(basename "$backup") (Rooftap ${describe:-unknown}, taken $(json_field createdAt "$manifest")):"
[ "$want_config" -eq 1 ] && echo "  config:   replaces .env$( [ -f "$src/config/docker-compose.override.yml" ] && echo ' and docker-compose.override.yml')"
[ "$want_db" -eq 1 ] && echo "  database: deletes the database volume and loads the backup's data"
[ "$want_files" -eq 1 ] && echo "  files:    deletes the uploaded files and puts back the backup's"
echo "Everything written on this server since the backup is lost."
if [ "$confirmed" -eq 0 ]; then
  read -r -p "Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "Cancelled; nothing changed."; exit 1; }
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [ "$want_config" -eq 1 ]; then
  for pair in "env:.env" "docker-compose.override.yml:docker-compose.override.yml"; do
    from="$src/config/${pair%%:*}" to="${pair#*:}"
    [ -f "$from" ] || continue
    if [ -f "$to" ] && ! cmp -s "$from" "$to"; then
      cp -p "$to" "$to.before-restore-$stamp"
      echo "Kept the current $to as $to.before-restore-$stamp"
    fi
    # cat, not cp: keeps the file's owner and mode if it exists.
    cat "$from" > "$to"
  done
  chmod 600 .env 2> /dev/null || true
  echo "Restored the config."
fi

if [ "$want_files" -eq 1 ]; then
  storage="$(docker compose ps -a -q storage | head -1)"
  if [ -z "$storage" ]; then
    echo "Creating the stack's containers to find the storage volume ..."
    docker compose up --no-start storage > /dev/null
    storage="$(docker compose ps -a -q storage | head -1)"
  fi
  volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/storage"}}{{.Name}}{{end}}{{end}}' "$storage")"
  [ -n "$volume" ] || die "couldn't find the storage container's data volume"
  was_running="$(docker compose ps -q storage)"
  # Stopped while the files change. With a database restore next, the whole
  # stack starts again after it.
  docker compose stop storage > /dev/null
  echo "Putting back the uploaded files (volume $volume) ..."
  docker run --rm -i -v "$volume:/data" postgres:17 \
    sh -c "find /data -mindepth 1 -delete && tar -C /data --numeric-owner --xattrs --xattrs-include='*' -xzf -" < "$src/files/storage.tar.gz" \
    || die "putting back the files failed"
  if [ -n "$was_running" ] && [ "$want_db" -eq 0 ]; then
    docker compose up -d --wait storage > /dev/null
    # Kong keeps the address of the storage container it saw last; a
    # restarted container can have a new one (502 until Kong looks again).
    docker compose restart kong > /dev/null
  fi
  echo "Restored the files."
fi

if [ "$want_db" -eq 1 ]; then
  [ -f .env ] || die "there is no .env. Restore the config part too, or create .env first."
  mkdir -p backups
  dump="backups/restore-$stamp.dump"
  cp "$src/database/database.dump" "$dump"
  # The same rebuild-then-load as rolling back an upgrade.
  ./scripts/restore-backup.sh "$dump" --yes $build_flag
  rm -f "$dump"
elif [ "$want_config" -eq 1 ] && [ "$want_files" -eq 0 ]; then
  echo "Start the stack with the restored config: ./scripts/self-host-init.sh -d --build"
fi

if [ "$want_db" -eq 1 ]; then
  echo "Restore finished: Rooftap ${describe:-} is back at migration $migration."
else
  echo "Restore finished."
fi
