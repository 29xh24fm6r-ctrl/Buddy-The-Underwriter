#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
DEAL_ID="${DEAL_ID:?set DEAL_ID}"
SNAPSHOT_ID="${SNAPSHOT_ID:?set SNAPSHOT_ID}"

ENDPOINT="/api/deals/$DEAL_ID/decision/$SNAPSHOT_ID/regulator-zip"

mkdir -p /tmp/buddy_packet
hdr="/tmp/buddy_packet/headers.txt"
zip="/tmp/buddy_packet/regulator.zip"

echo "GET $BASE$ENDPOINT"
curl -sS -D "$hdr" -o "$zip" "$BASE$ENDPOINT"

echo
echo "== Content-Type =="
rg -i "content-type:" "$hdr" || true

echo
echo "== ZIP contents (top 200 lines) =="
unzip -l "$zip" | sed -n '1,200p'

echo
echo "== Verify pricing appendix present =="
APP_LINE="$(unzip -l "$zip" | rg -n "appendix_pricing_memo_.*\.pdf" || true)"
if [ -z "$APP_LINE" ]; then
  echo "ERROR: pricing appendix pdf not found in zip."
  exit 1
fi
echo "$APP_LINE"

echo
echo "== Extract appendix + verify PDF signature =="
APP_PATH="$(unzip -Z1 "$zip" | rg "appendix_pricing_memo_.*\.pdf" | head -n 1)"
unzip -p "$zip" "$APP_PATH" > /tmp/buddy_packet/pricing_appendix.pdf
head -c 8 /tmp/buddy_packet/pricing_appendix.pdf | cat
echo
if ! head -c 8 /tmp/buddy_packet/pricing_appendix.pdf | rg -q "%PDF"; then
  echo "ERROR: appendix is not a valid PDF."
  exit 1
fi
echo "OK: appendix PDF signature verified."

echo
echo "== Verify manifest metadata (if present) =="
MANIFEST="$(unzip -Z1 "$zip" | rg -i "manifest.*\.json" | head -n 1 || true)"
if [ -n "$MANIFEST" ]; then
  echo "Found manifest: $MANIFEST"
  unzip -p "$zip" "$MANIFEST" | jq '.appendices? // .attachments? // .files? // .' | head -n 80
else
  echo "No manifest json found (ok if your zip uses a different metadata file)."
fi

echo
echo "DONE: regulator zip contains pricing appendix."
