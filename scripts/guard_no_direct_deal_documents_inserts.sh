#!/usr/bin/env bash
set -euo pipefail

# Allowlist: endpoints that can legitimately touch deal_documents directly (read/admin/backfill)
ALLOW_RE='src/app/api/(admin|lender|home)/|src/app/api/deals/\[dealId\]/(checklist|auto-seed|intake|files/signed-url|checklist/doc-summary|checklist/reconcile|files/auto-match-checklist)'

HITS=$(rg -n "from\(\"deal_documents\"\)|\\.from\('deal_documents'\)" src/app/api -S || true)

# Filter out allowlisted
BAD=$(echo "$HITS" | rg -v "$ALLOW_RE" || true)

if [[ -n "${BAD// }" ]]; then
  echo "❌ Found non-allowlisted direct deal_documents usage in API routes:"
  echo "$BAD"
  echo
  echo "All upload writers must call ingestDocument()."
  exit 1
fi

echo "✅ Guard passed: no non-allowlisted direct deal_documents usage."
