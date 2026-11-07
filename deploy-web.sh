#!/usr/bin/env bash
#
# Rebuild the web client and publish it to the folder Caddy serves.
# Touches nothing else: no containers, no Caddy config, no database.
#
# Usage:
#   ./deploy-web.sh <domain>            e.g. ./deploy-web.sh stream.example.com
#
# Options (environment variables):
#   WEBROOT=/srv/streambree/web         where Caddy serves the app from
#   KEEP_BACKUPS=3                      how many previous builds to keep for rollback
#
# Each run backs up the current site to <WEBROOT>.bak-<timestamp> first and prints
# the command to roll back.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DOMAIN="${1:-${DOMAIN:-}}"
WEBROOT="${WEBROOT:-/srv/streambree/web}"
KEEP_BACKUPS="${KEEP_BACKUPS:-3}"
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx \033[0m %s\n' "$*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "Usage: ./deploy-web.sh <domain>   (the site the API is served from)"
command -v npm >/dev/null || die "npm not found."

# ---- build --------------------------------------------------------------------
cd "$REPO_DIR/web"
[ -d node_modules ] || { log "Installing dependencies"; npm ci; }
log "Building web client (VITE_SERVER_URL=https://$DOMAIN/api)"
VITE_SERVER_URL="https://$DOMAIN/api" npm run build
[ -f dist/index.html ] || die "Build produced no dist/index.html — not publishing."

# ---- back up, then publish -------------------------------------------------------
BACKUP=""
if [ -d "$WEBROOT" ] && [ -n "$(ls -A "$WEBROOT" 2>/dev/null)" ]; then
  BACKUP="$WEBROOT.bak-$(date +%Y%m%d-%H%M%S)"
  log "Backing up current site to $BACKUP"
  $SUDO cp -a "$WEBROOT" "$BACKUP"
fi

log "Publishing to $WEBROOT"
$SUDO mkdir -p "$WEBROOT"
$SUDO find "$WEBROOT" -mindepth 1 -delete
$SUDO cp -r dist/. "$WEBROOT/"

# ---- prune old backups (newest first, keep KEEP_BACKUPS) --------------------------
mapfile -t backups < <(ls -1d "$WEBROOT".bak-* 2>/dev/null | sort -r)
for old in "${backups[@]:$KEEP_BACKUPS}"; do
  log "Removing old backup $old"
  $SUDO rm -rf -- "$old"
done

log "Done. https://$DOMAIN now serves this build (users may need a hard refresh)."
if [ -n "$BACKUP" ]; then
  P="${SUDO:+$SUDO }"
  printf '    Roll back with:  %sfind %s -mindepth 1 -delete && %scp -a %s/. %s/\n' \
    "$P" "$WEBROOT" "$P" "$BACKUP" "$WEBROOT"
fi
