#!/usr/bin/env bash
# Push the Preckon site to IONOS webspace over SFTP.
#
#   PRECKON_SFTP_HOST=access-xxxxx.webspace-data.io \
#   PRECKON_SFTP_USER=u1234567 \
#   PRECKON_SFTP_PASS='...' \
#   PRECKON_SFTP_ROOT=/ \
#   ./push.sh
#
# Requires lftp.  Credentials come from IONOS -> Hosting -> SFTP/SSH access.
set -euo pipefail

HOST="${PRECKON_SFTP_HOST:?set PRECKON_SFTP_HOST}"
USER="${PRECKON_SFTP_USER:?set PRECKON_SFTP_USER}"
PASS="${PRECKON_SFTP_PASS:?set PRECKON_SFTP_PASS}"
ROOT="${PRECKON_SFTP_ROOT:-/}"
PORT="${PRECKON_SFTP_PORT:-22}"

LOCAL="$(cd "$(dirname "$0")/deploy" && pwd)"

command -v lftp >/dev/null || { echo "lftp not found. Use the File Manager route in DEPLOY.md."; exit 1; }

echo "Pushing $LOCAL -> sftp://$USER@$HOST:$PORT$ROOT"
echo "Dry run first; nothing is deleted remotely."

lftp -c "
set sftp:auto-confirm yes
set net:max-retries 2
open -u '$USER','$PASS' -p $PORT sftp://$HOST
cd '$ROOT'
mirror --reverse --verbose --dry-run --exclude-glob .git* $LOCAL .
"

read -r -p "Proceed with the real upload? [y/N] " ok
[ "$ok" = "y" ] || { echo "aborted"; exit 0; }

lftp -c "
set sftp:auto-confirm yes
open -u '$USER','$PASS' -p $PORT sftp://$HOST
cd '$ROOT'
mirror --reverse --verbose --exclude-glob .git* $LOCAL .
"

echo
echo "Uploaded. Verify:"
echo "  curl -sI https://www.preckon.com/ | head -3"
echo "  curl -sI https://www.preckon.com/platform | head -3"
