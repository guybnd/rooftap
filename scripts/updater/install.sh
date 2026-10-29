#!/usr/bin/env bash
set -euo pipefail

# Turns on one-click updates for this self-hosted Rooftap server
# (.docs/self-hosting.md "One-click updates"). Run it once, as the user that
# runs the stack (the one that can run `docker compose`), in the Rooftap
# folder.
#
# Usage: ./scripts/updater/install.sh            turn on (systemd, or cron when there is no systemd)
#        ./scripts/updater/install.sh --cron     turn on with cron, even when there is systemd
#        ./scripts/updater/install.sh --remove   turn off
#
# What it sets up:
#   updates/inbox   the one folder the app can write to. The Update button
#                   writes a version number here.
#   updates/state   where scripts/updater/updater.sh writes its progress. The
#                   app can only read it.
#   a trigger       a systemd path unit that runs updater.sh when a request
#                   arrives (needs sudo once), or a cron entry that checks
#                   every minute.
#
# Nothing here gives the app Docker or a shell. The updater installs only the
# newest published release, after a full backup, and goes back to the old
# version when the new one fails.

cd "$(dirname "$0")/../.."
repo="$(pwd)"
UNIT="rooftap-updater"
MARK="# rooftap-updater $repo"

die() { echo "error: $*" >&2; exit 1; }
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
has_systemd() { [ -d /run/systemd/system ] && command -v systemctl > /dev/null; }

mode="auto"
case "${1:-}" in
  "") ;;
  --cron) mode="cron" ;;
  --remove) mode="remove" ;;
  -h|--help) sed -n '4,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "unknown option $1 (see --help)" ;;
esac

remove_cron() {
  command -v crontab > /dev/null || return 0
  local current
  current="$(crontab -l 2> /dev/null || true)"
  if printf '%s\n' "$current" | grep -qF "$MARK"; then
    printf '%s\n' "$current" | grep -vF "$MARK" | crontab -
    echo "Removed the cron entry."
  fi
}
remove_systemd() {
  has_systemd || return 0
  [ -f "/etc/systemd/system/$UNIT.path" ] || return 0
  as_root systemctl disable --now "$UNIT.path" > /dev/null 2>&1 || true
  as_root rm -f "/etc/systemd/system/$UNIT.path" "/etc/systemd/system/$UNIT.service"
  as_root systemctl daemon-reload
  echo "Removed the systemd units."
}

if [ "$mode" = "remove" ]; then
  remove_systemd
  remove_cron
  rm -f updates/state/updater.json
  echo "One-click updates are off. The app shows the manual steps again."
  exit 0
fi

[ -f docker-compose.yml ] && [ -f scripts/updater/updater.sh ] || die "run this from the Rooftap folder"
[ "$(id -u)" -ne 0 ] || echo "warning: running as root. The updater will run as root too. Run it as the user that runs the stack instead." >&2
for tool in git curl docker; do command -v "$tool" > /dev/null || die "$tool is not installed"; done
docker compose version > /dev/null 2>&1 || die "this user cannot run 'docker compose'. Add it to the docker group, or run this as the user that runs the stack."
[ -z "$(git status --porcelain --untracked-files=no)" ] || echo "warning: this folder has local changes. The updater will not update it until they are committed or removed." >&2

mkdir -p updates/inbox updates/state
for d in updates/inbox updates/state; do
  [ -O "$d" ] || die "$d belongs to another user (Docker may have made it). Run: sudo chown -R $(id -un) updates"
done
# The app runs as another user, so it needs to drop a file in the inbox. The
# sticky bit stops it from touching anything it did not make, and without
# read permission it cannot list the folder.
chmod 1733 updates/inbox
chmod 755 updates/state

if [ "$mode" = "auto" ] && has_systemd; then
  case "$repo" in *[[:space:]]*) die "the Rooftap folder path has a space, which systemd units cannot watch. Use --cron." ;; esac
  user="$(id -un)"
  group="$(id -gn)"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  cat > "$tmp/$UNIT.service" <<UNIT
[Unit]
Description=Rooftap one-click update ($repo)

[Service]
Type=oneshot
User=$user
Group=$group
WorkingDirectory=$repo
Environment=HOME=$HOME
Environment="PATH=$PATH"
ExecStart=$repo/scripts/updater/updater.sh
TimeoutStartSec=2h
UNIT
  cat > "$tmp/$UNIT.path" <<UNIT
[Unit]
Description=Rooftap one-click update request ($repo)

[Path]
PathExists=$repo/updates/inbox/request
Unit=$UNIT.service

[Install]
WantedBy=multi-user.target
UNIT
  echo "Installing systemd units (this asks for sudo once) ..."
  as_root install -m 644 "$tmp/$UNIT.service" "$tmp/$UNIT.path" /etc/systemd/system/
  as_root systemctl daemon-reload
  as_root systemctl enable --now "$UNIT.path" > /dev/null
  remove_cron
  installed="systemd"
else
  command -v crontab > /dev/null || die "neither systemd nor cron is available. Run scripts/updater/updater.sh yourself (for example from your NAS's task scheduler) every minute."
  remove_cron > /dev/null
  # cron starts with a bare PATH; keep this shell's, so docker is found
  # wherever it is installed (snap, /usr/local/bin).
  { crontab -l 2> /dev/null || true; printf '* * * * * cd "%s" && PATH="%s" ./scripts/updater/updater.sh > /dev/null 2>&1 %s\n' "$repo" "$PATH" "$MARK"; } | crontab -
  installed="cron"
fi

tmpfile="$(mktemp updates/state/.updater.XXXXXX)"
printf '{\n  "installed": true,\n  "mode": "%s",\n  "since": "%s"\n}\n' "$installed" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmpfile"
chmod 644 "$tmpfile"
mv -f "$tmpfile" updates/state/updater.json

echo "One-click updates are on ($installed)."
echo "The people who run this server now see an Update button in Settings > About & updates when a release is out."
echo "If the stack was started before this folder existed, restart it once: ./scripts/self-host-init.sh -d"
echo "To turn it off: ./scripts/updater/install.sh --remove"
