#!/usr/bin/env bash
set -euo pipefail

: "${BASE:?Set BASE to your preview/prod URL, e.g. https://...vercel.app}"

URL="$BASE/api/debug/vertex-probe"

echo "[vertex-probe] GET $URL"
TMP="$(mktemp)"
HDR="$(mktemp)"

# Fetch with headers + body captured
curl -sS -D "$HDR" -o "$TMP" "$URL"

# Basic HTTP checks
STATUS="$(awk 'NR==1{print $2}' "$HDR" | tr -d '\r')"
CT="$(awk -F': ' 'tolower($1)=="content-type"{print $2}' "$HDR" | tail -n 1 | tr -d '\r')"

echo "[vertex-probe] status=$STATUS content-type=${CT:-unknown}"

if [[ "$STATUS" != "200" ]]; then
  echo "[vertex-probe] ERROR: non-200 status"
  echo "---- headers ----"; cat "$HDR"
  echo "---- body ----"; cat "$TMP"
  exit 1
fi

# Validate JSON + required fields
if ! command -v jq >/dev/null 2>&1; then
  echo "[vertex-probe] ERROR: jq is required (install jq)."
  exit 1
fi

if ! jq -e . >/dev/null 2>&1 < "$TMP"; then
  echo "[vertex-probe] ERROR: response is not valid JSON"
  echo "---- body ----"; cat "$TMP"
  exit 1
fi

OK="$(jq -r '.ok // empty' < "$TMP")"
WIF_OK="$(jq -r '.wifAccessTokenOk // empty' < "$TMP")"
MODEL="$(jq -r '.model // empty' < "$TMP")"
LOC="$(jq -r '.location // empty' < "$TMP")"
TEXT="$(jq -r '.text // empty' < "$TMP")"
WIF_ERR="$(jq -r '.wifAccessTokenError // empty' < "$TMP")"
OIDC_HDR="$(jq -r '.hasOidcHeader // empty' < "$TMP")"
OIDC_ENV="$(jq -r '.hasOidcEnv // empty' < "$TMP")"

echo "[vertex-probe] ok=$OK wifAccessTokenOk=$WIF_OK model=${MODEL:-n/a} location=${LOC:-n/a} text=${TEXT:-n/a}"
echo "[vertex-probe] hasOidcHeader=${OIDC_HDR:-n/a} hasOidcEnv=${OIDC_ENV:-n/a} wifAccessTokenError=${WIF_ERR:-n/a}"

# Assertions (tune if your route differs)
[[ "$OK" == "true" ]] || { echo "[vertex-probe] FAIL: .ok != true"; jq . < "$TMP"; exit 1; }
[[ "$WIF_OK" == "true" ]] || { echo "[vertex-probe] FAIL: .wifAccessTokenOk != true"; jq . < "$TMP"; exit 1; }
[[ -n "$MODEL" ]] || { echo "[vertex-probe] FAIL: .model missing"; jq . < "$TMP"; exit 1; }
[[ -n "$LOC" ]] || { echo "[vertex-probe] FAIL: .location missing"; jq . < "$TMP"; exit 1; }

echo "[vertex-probe] PASS ✅"
