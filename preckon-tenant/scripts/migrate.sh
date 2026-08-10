#!/bin/sh
# Apply every migration, using the database container's own mysql client.
#
# The Node runner beside this file needs mysql2 and a DATABASE_URL, and the
# tenant's runtime image carries neither: it ships only .next/standalone, so
# there is no scripts/ directory inside it and no npm script to run. On the
# server the only thing guaranteed to exist is the db container and the SQL
# files on disk — so this uses exactly those and nothing else.
#
# Run it from the compose directory (the one with docker-compose.yml):
#
#   sh scripts/migrate.sh
#   sh scripts/migrate.sh --dry
#
# Every migration here is written to be re-runnable — each ALTER is guarded on
# information_schema — so this is safe on every deploy, and safe to run twice.
set -eu

DIR=${MIGRATIONS_DIR:-db/migrations}
SERVICE=${DB_SERVICE:-db}
USER=${DB_USER:-root}
PASS=${DB_PASS:-preckon}
NAME=${DB_NAME:-preckon_tenant}

if [ ! -d "$DIR" ]; then
  echo "No $DIR here. Run this from the directory that holds docker-compose.yml."
  echo "If db/ was never synced to the server, copy it across first."
  exit 1
fi

count=$(ls "$DIR"/*.sql 2>/dev/null | wc -l)
if [ "$count" -eq 0 ]; then echo "No .sql files in $DIR"; exit 0; fi
echo "$count migration(s) in $DIR"

for f in "$DIR"/*.sql; do
  name=$(basename "$f")
  if [ "${1:-}" = "--dry" ]; then
    echo "  would run  $name"
    continue
  fi
  # The status tested here must be mysql's. It used to be the status of a
  # `| grep -v` filtering the password warning — and grep exits 1 when it
  # filters EVERYTHING, which is exactly what happens when a migration succeeds
  # silently. So every clean migration was reported as FAILED, with an empty
  # reason because the filter had eaten the only line there was. Capture first,
  # filter second.
  if out=$(docker compose exec -T "$SERVICE" \
        mysql -u"$USER" -p"$PASS" "$NAME" < "$f" 2>&1); then
    echo "  ok         $name"
  else
    echo "  FAILED     $name"
    echo "$out" | grep -v "Using a password on the command line" | sed 's/^/             /'
    # A half-migrated schema is worse than an unmigrated one.
    echo
    echo "Stopped. Fix that migration and run again — they are all re-runnable."
    exit 1
  fi
done

[ "${1:-}" = "--dry" ] || echo "
Schema is up to date."
