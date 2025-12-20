#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   CHAOS_ENABLED=true in env on server
#   then:
#   ./scripts/chaos-upload.sh <URL> <TOKEN> <POINT>
#
# POINT values:
#   pre_link_lookup
#   post_link_validation
#   before_storage_upload
#   after_storage_upload
#   after_db_insert

URL="${1:?missing url (e.g. http://localhost:3000/api/public/upload)}"
TOKEN="${2:?missing token}"
POINT="${3:?missing chaos point}"

TMPFILE="$(mktemp)"
echo "hello" > "$TMPFILE"

curl -sS -X POST "$URL" \
  -H "x-chaos-point: $POINT" \
  -F "token=$TOKEN" \
  -F "idempotencyKey=chaos-test-1" \
  -F "files=@$TMPFILE;type=text/plain" | jq .

rm -f "$TMPFILE"
