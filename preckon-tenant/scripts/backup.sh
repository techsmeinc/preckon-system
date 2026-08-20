#!/bin/sh
# Database backup, with the restore actually tested.
#
#   sh scripts/backup.sh              take a backup, verify it restores
#   sh scripts/backup.sh --no-verify  take a backup only (faster, weaker)
#   sh scripts/backup.sh --restore <file> <target-db>   restore somewhere
#
# The verify step is the point of this file. An untested backup is not a
# backup, it is a file — and the failure mode is not "the backup is missing",
# it is "the backup exists, everybody relaxed, and it does not restore". So
# every backup is restored into a scratch database and counted before it is
# kept, and the run fails loudly if the restore does not produce the same
# tables.
#
# Runs from the compose directory, using the database container's own client,
# for the same reason migrate.sh does: it is the only thing guaranteed to be
# on the host.
set -eu

SERVICE=${DB_SERVICE:-db}
USER=${DB_USER:-root}
PASS=${DB_PASS:-preckon}
NAME=${DB_NAME:-preckon_tenant}
DIR=${BACKUP_DIR:-/opt/preckon-backups}
KEEP=${BACKUP_KEEP:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DIR/${NAME}-${STAMP}.sql.gz"

mysql_in() { docker compose exec -T "$SERVICE" mysql -u"$USER" -p"$PASS" "$@"; }

# ── restore mode ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--restore" ]; then
  FILE=${2:?"usage: backup.sh --restore <file> <target-db>"}
  TARGET=${3:?"usage: backup.sh --restore <file> <target-db>"}
  echo "==> Restoring $FILE into $TARGET"
  mysql_in -e "DROP DATABASE IF EXISTS \`$TARGET\`; CREATE DATABASE \`$TARGET\`;"
  gunzip -c "$FILE" | docker compose exec -T "$SERVICE" mysql -u"$USER" -p"$PASS" "$TARGET"
  echo "==> Restored."
  exit 0
fi

mkdir -p "$DIR"

echo "==> Dumping $NAME"
# --single-transaction so the dump is consistent without locking the app out;
# routines and triggers because the audit chain lives in a stored procedure and
# a backup without it restores a database that cannot append to its own chain.
docker compose exec -T "$SERVICE" mysqldump \
  -u"$USER" -p"$PASS" \
  --single-transaction --quick --routines --triggers --events \
  --default-character-set=utf8mb4 \
  "$NAME" | gzip -9 > "$OUT"

SIZE=$(wc -c < "$OUT")
if [ "$SIZE" -lt 10240 ]; then
  echo "!! Dump is only $SIZE bytes. That is not a database." >&2
  exit 1
fi
echo "    $OUT  ($SIZE bytes)"

if [ "${1:-}" = "--no-verify" ]; then
  echo "==> Skipping verification (--no-verify). This is a file, not yet a backup."
else
  SCRATCH="${NAME}_restore_check"
  echo "==> Verifying by restoring into $SCRATCH"
  mysql_in -e "DROP DATABASE IF EXISTS \`$SCRATCH\`; CREATE DATABASE \`$SCRATCH\`;"
  gunzip -c "$OUT" | docker compose exec -T "$SERVICE" mysql -u"$USER" -p"$PASS" "$SCRATCH"

  SRC_TABLES=$(mysql_in -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$NAME';" | tr -d '\r')
  DST_TABLES=$(mysql_in -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$SCRATCH';" | tr -d '\r')

  # Row counts on the tables whose loss would be unrecoverable, rather than on
  # everything: a mismatch anywhere is a failure, and these are the ones worth
  # naming in the output when it happens.
  for T in audit_event artifact project document_register ai_usage_ledger; do
    S=$(mysql_in -N -e "SELECT COUNT(*) FROM \`$NAME\`.\`$T\`;" 2>/dev/null | tr -d '\r' || echo skip)
    D=$(mysql_in -N -e "SELECT COUNT(*) FROM \`$SCRATCH\`.\`$T\`;" 2>/dev/null | tr -d '\r' || echo skip)
    [ "$S" = "skip" ] && continue
    if [ "$S" != "$D" ]; then
      echo "!! $T: $S rows in the live database, $D in the restore." >&2
      mysql_in -e "DROP DATABASE IF EXISTS \`$SCRATCH\`;"
      exit 1
    fi
    echo "    $T: $S rows restored"
  done

  mysql_in -e "DROP DATABASE IF EXISTS \`$SCRATCH\`;"

  if [ "$SRC_TABLES" != "$DST_TABLES" ]; then
    echo "!! $SRC_TABLES tables live, $DST_TABLES restored." >&2
    exit 1
  fi
  echo "==> Verified: $DST_TABLES tables restored and row counts match."
fi

# ── retention ────────────────────────────────────────────────────────────────
# Keep the newest N. Deleting oldest-first by name works because the stamp is
# ISO-ordered, which is the whole reason it is in the filename.
COUNT=$(ls -1 "$DIR"/${NAME}-*.sql.gz 2>/dev/null | wc -l)
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1 "$DIR"/${NAME}-*.sql.gz | head -n $((COUNT - KEEP)) | while read -r old; do
    echo "    pruning $(basename "$old")"
    rm -f "$old"
  done
fi

echo "==> Done. $(ls -1 "$DIR"/${NAME}-*.sql.gz | wc -l) backup(s) retained in $DIR."
