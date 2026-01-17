#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
DEAL_ID="${DEAL_ID:?set DEAL_ID}"
SNAPSHOT_ID="${SNAPSHOT_ID:-}"

if [ -z "$SNAPSHOT_ID" ] && [ -z "${ENDPOINT:-}" ]; then
  echo "ERROR: set SNAPSHOT_ID or provide ENDPOINT explicitly."
  exit 1
fi

ENDPOINT="${ENDPOINT:-/api/deals/$DEAL_ID/decision/$SNAPSHOT_ID/pdf}"

mkdir -p /tmp/buddy_committee
hdr="/tmp/buddy_committee/headers.txt"
out="/tmp/buddy_committee/packet.bin"

echo "GET $BASE$ENDPOINT"
curl -sS -D "$hdr" -o "$out" "$BASE$ENDPOINT"

echo
echo "== Content-Type =="
ct="$(rg -i "content-type:" "$hdr" | head -n 1 || true)"
echo "$ct"

if echo "$ct" | rg -qi "application/zip"; then
  echo "ZIP detected; listing contents..."
  unzip -l "$out" | sed -n '1,200p'
  echo
  echo "Checking for appendix_pricing_memo_*.pdf ..."
  unzip -l "$out" | rg "appendix_pricing_memo_.*\.pdf"
elif echo "$ct" | rg -qi "application/pdf"; then
  echo "PDF detected; verifying signature..."
  head -c 8 "$out" | cat
  echo
  if ! head -c 8 "$out" | rg -q "%PDF"; then
    echo "ERROR: not a valid PDF"
    exit 1
  fi
  echo "OK: PDF signature verified. (Appendix presence requires visual check unless you have a PDF page counter util.)"
else
  echo "Non-zip/pdf response; inspect first 400 bytes:"
  head -c 400 "$out" | cat
  echo
  echo "If this endpoint returns JSON with artifact URLs, print it:"
  cat "$out" | jq . || true
fi

echo
echo "DONE."
