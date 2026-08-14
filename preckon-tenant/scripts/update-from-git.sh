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

# The canonical source. This used to point at a personal repository, which meant
# the artefact running in production was not the one being reviewed in the org
# repo — a governance gap, not just untidiness. Overridable so a fork or a
# staging box can be pointed elsewhere deliberately.
REPO="${PRECKON_REPO:-https://github.com/techsmeinc/preckon-tenant.git}"
# The tenant repo has the plane at its ROOT; the legacy monorepo nests it under
# Preckon-system/. Detected after cloning rather than assumed.
SUBDIR=""
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

# Where the planes live inside whatever was cloned.
#
# STANDALONE means the repository IS one plane, at its root — which is how the
# per-plane org repos are laid out. WHICH plane it is comes from the repo name,
# and that matters more than it looks: without it, `sync_plane preckon-host`
# would take "$SRC/" as its source and rsync --delete the TENANT over the host
# plane. The default invocation does both planes, so that is one command away
# from destroying the other install.
STANDALONE_PLANE=""
if [ -d "$SRC/Preckon-system/preckon-tenant" ]; then SUBDIR="Preckon-system/"
elif [ -d "$SRC/preckon-tenant" ]; then SUBDIR=""
elif [ -d "$SRC/src" ] && [ -d "$SRC/db/migrations" ]; then
  SUBDIR="STANDALONE"
  STANDALONE_PLANE="$(basename "$REPO" .git)"
  echo "  $REPO holds $STANDALONE_PLANE at its root"
else echo "  ! cannot find the tenant plane in $REPO"; exit 1; fi

sync_plane() {
  local name="$1" to="/opt/$1/" from
  if [ "$SUBDIR" = "STANDALONE" ]; then
    # Only the plane this repository actually holds. Syncing any other from here
    # would copy the wrong source over it, and rsync --delete makes that final.
    [ "$name" = "$STANDALONE_PLANE" ] || { echo "  skip $name — $REPO holds only $STANDALONE_PLANE"; return; }
    from="$SRC/"
  else
    from="$SRC/$SUBDIR$1/"
  fi
  [ -d "$from" ] || { echo "  skip $name — not present in the source repo"; return; }
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
  # Artifact payload schemas live in the DATABASE, registered from the pack at
  # seed time — they are not read from source. Skipping this leaves the server
  # validating against the previous shape, and every agent or editor write that
  # uses a newly added field fails with "Payload invalid for <type>". Idempotent
  # (ON DUPLICATE KEY UPDATE), so it is safe on every deploy.
  echo "→ re-registering the pack catalog (artifact schemas)"
  # Fails the deploy. If the artifact schemas do not match the running code,
  # every agent or editor write touching a newly added field is rejected at
  # runtime — an application that is up and quietly broken, which is worse than
  # one that never came up.
  docker compose --profile tools run --rm seed || {
    echo "  ! catalog seed FAILED — refusing to deploy code whose artifact schemas are not registered."
    exit 1
  }

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
