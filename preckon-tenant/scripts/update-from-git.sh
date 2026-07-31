#!/usr/bin/env bash
# Update /opt/preckon-tenant and /opt/preckon-host from GitHub, then rebuild.
#
# Pulls rather than receiving an scp, because the server reaching out works the
# same whichever shell you happen to be in — no local-vs-remote path confusion.
#
# What it deliberately does NOT touch: .env and docker-compose.override.yml.
# Those are not in the repo and hold this box's real secrets, auth origin and
# API key. rsync's --exclude keeps them even though the source has no such file.
#
#   bash update-from-git.sh            # both planes
#   bash update-from-git.sh tenant     # one plane
set -euo pipefail

REPO="https://github.com/divya053/newcomplete.git"
SRC="/opt/_preckon-src"
WHAT="${1:-both}"

if ! command -v rsync >/dev/null; then
  echo "installing rsync…"
  (dnf install -y rsync >/dev/null 2>&1 || apt-get install -y rsync >/dev/null 2>&1) || {
    echo "could not install rsync — install it and re-run"; exit 1; }
fi

want() { [ "$WHAT" = "both" ] || [ "$WHAT" = "$1" ]; }

echo "→ fetching $REPO"
rm -rf "$SRC"
git clone --depth 1 "$REPO" "$SRC" >/dev/null
echo "  $(git -C "$SRC" log --oneline -1)"

sync_plane() {
  local name="$1" from="$SRC/Preckon-system/$1/" to="/opt/$1/"
  [ -d "$to" ] || { echo "  skip $name — $to does not exist"; return; }
  echo "→ syncing $name"
  rsync -a --delete \
    --exclude='.env' --exclude='docker-compose.override.yml' \
    --exclude='node_modules' --exclude='.next' --exclude='.uploads' \
    --exclude='__pycache__' --exclude='test-results' \
    "$from" "$to"
}

want tenant && sync_plane preckon-tenant
want host   && sync_plane preckon-host

if want tenant && [ -d /opt/preckon-tenant ]; then
  cd /opt/preckon-tenant
  echo "→ migrations"
  for m in db/migrations/*.sql; do
    echo "   $m"
    docker compose exec -T db mysql -uroot -ppreckon preckon_tenant < "$m"
  done
  echo "→ building tenant (first cad build compiles LibreDWG — a few minutes)"
  docker compose build app worker cad
  docker compose up -d app worker cad
fi

if want host && [ -d /opt/preckon-host ]; then
  cd /opt/preckon-host
  echo "→ building host"
  docker compose build app
  docker compose up -d app
fi

echo
echo "── checks ──"
docker compose -f /opt/preckon-tenant/docker-compose.yml ps --format '{{.Service}}\t{{.Status}}' 2>/dev/null || true
docker compose -f /opt/preckon-tenant/docker-compose.yml exec -T cad sh -c \
  'echo "cad: dwg2dxf $(dwg2dxf --version 2>&1 | head -1)"' 2>/dev/null || echo "cad: not running"
docker exec preckon-host-app-1 wc -c public/checklist.html 2>/dev/null || true
echo "done."
