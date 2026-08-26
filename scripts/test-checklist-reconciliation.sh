#!/bin/bash
# ============================================================
# CHECKLIST RECONCILIATION - VERIFICATION SCRIPT
# ============================================================

set -e

PREVIEW_URL="${PREVIEW_URL:?Set PREVIEW_URL to the deployment under test}"
DEAL_ID="${DEAL_ID:?Set DEAL_ID to an authorized QA deal}"
ADMIN_DEBUG_TOKEN="${ADMIN_DEBUG_TOKEN:?Set ADMIN_DEBUG_TOKEN in the shell environment}"

echo "============================================================"
echo "✅ CHECKLIST RECONCILIATION VERIFICATION"
echo "============================================================"
echo "Preview URL: $PREVIEW_URL"
echo "Deal ID: $DEAL_ID"
echo ""

echo "1️⃣ Checking current checklist state..."
curl -sS -H "Authorization: Bearer $ADMIN_DEBUG_TOKEN" \
  "$PREVIEW_URL/api/admin/deals/$DEAL_ID/checklist/debug" | jq '{
  dealId: .dealId,
  total_items: .count,
  received_items: ([.items[] | select(.received_at != null)] | length),
  pending_items: ([.items[] | select(.received_at == null)] | length),
  items_summary: .items | group_by(.received_at != null) | map({
    category: (if .[0].received_at != null then "received" else "pending" end),
    count: length
  })
}'

echo ""
echo "============================================================"
echo ""
echo "2️⃣ Testing reconciliation endpoint (will mark items received if docs exist)..."
echo "   POST $PREVIEW_URL/api/deals/$DEAL_ID/checklist/reconcile"
echo ""
echo "   To test manually, use this curl command:"
echo ""
echo "   curl -X POST '$PREVIEW_URL/api/deals/$DEAL_ID/checklist/reconcile' \\"
echo "     -H 'Cookie: YOUR_CLERK_COOKIE_HERE' | jq"
echo ""
echo "============================================================"
echo ""
echo "3️⃣ After reconciliation, verify items are marked received:"
echo ""
echo "   curl -sS -H 'Authorization: Bearer $ADMIN_DEBUG_TOKEN' \\
     '$PREVIEW_URL/api/admin/deals/$DEAL_ID/checklist/debug' | jq"
echo ""
echo "============================================================"
echo ""
echo "🔥 NEXT STEPS:"
echo ""
echo "1. Run the migration in Supabase SQL Editor:"
echo "   - Open: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new"
echo "   - Paste contents of: supabase/migrations/20251231000000_checklist_docs_reconciliation.sql"
echo "   - Click 'Run'"
echo ""
echo "2. Test in browser:"
echo "   - Go to: $PREVIEW_URL/deals/$DEAL_ID/cockpit"
echo "   - Upload documents (if not already uploaded)"
echo "   - Click 'Save + Auto-Seed Checklist'"
echo "   - Checklist should show received items immediately"
echo ""
echo "3. Verify DB state with this SQL query in Supabase:"
echo ""
cat <<'SQL'
select
  c.checklist_key,
  c.required,
  c.status,
  c.received_at,
  (select count(*) from deal_documents d where d.deal_id=c.deal_id and d.checklist_key=c.checklist_key) as docs_count,
  (select count(*) from deal_files f where f.deal_id=c.deal_id and f.checklist_key=c.checklist_key) as files_count
from deal_checklist_items c
where c.deal_id = 'REPLACE_WITH_YOUR_DEAL_ID'
order by c.checklist_key;
SQL

echo ""
echo "Expected: Items with docs_count > 0 or files_count > 0 should have received_at != null"
echo ""
echo "============================================================"
