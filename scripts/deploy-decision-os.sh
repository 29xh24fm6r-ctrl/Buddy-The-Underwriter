#!/usr/bin/env bash
# ============================================================
# DECISION OS: PRODUCTION DEPLOYMENT RUNBOOK
# Run this after merging to main and deploying to Vercel
# ============================================================
set -euo pipefail

echo "🚀 Decision OS Production Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ------------------------------------------------------------
# STEP 1: RUN MIGRATIONS IN SUPABASE
# ------------------------------------------------------------
echo "STEP 1: Database Migrations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Open Supabase SQL Editor: https://supabase.com/dashboard/project/YOUR_PROJECT/sql"
echo ""
echo "2. Run migration #1 - Core tables:"
echo "   File: supabase/migrations/20251229_decision_os_safe.sql"
echo "   Creates: decision_snapshots, decision_overrides, policy_chunk_versions"
echo ""
cat /workspaces/Buddy-The-Underwriter/supabase/migrations/20251229_decision_os_safe.sql
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "3. Run migration #2 - Hardening (RECOMMENDED):"
echo "   File: supabase/migrations/20251229_decision_os_hardening.sql"
echo "   Adds: immutability triggers, audit protection"
echo ""
cat /workspaces/Buddy-The-Underwriter/supabase/migrations/20251229_decision_os_hardening.sql
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Press ENTER after running migrations in Supabase..."

# ------------------------------------------------------------
# STEP 2: VERIFY TABLES CREATED
# ------------------------------------------------------------
echo ""
echo "STEP 2: Verify Tables"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Run this query in Supabase SQL Editor:"
echo ""
cat <<'SQL'
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('decision_snapshots', 'decision_overrides', 'policy_chunk_versions')
ORDER BY table_name;
SQL
echo ""
echo "Expected: 3 rows (decision_snapshots, decision_overrides, policy_chunk_versions)"
echo ""
read -p "Press ENTER after verifying..."

# ------------------------------------------------------------
# STEP 3: UPDATE RLS POLICIES (PRODUCTION)
# ------------------------------------------------------------
echo ""
echo "STEP 3: Production RLS Policies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Run this query to replace temporary authenticated policies with tenant-scoped:"
echo ""
cat <<'SQL'
-- decision_snapshots: tenant isolation via deals.bank_id
DROP POLICY IF EXISTS "Allow authenticated users" ON decision_snapshots;
CREATE POLICY "Tenant isolation" ON decision_snapshots
  FOR ALL USING (
    deal_id IN (
      SELECT id FROM deals WHERE bank_id = (current_setting('app.bank_id', true))::uuid
    )
  );

-- decision_overrides: same pattern
DROP POLICY IF EXISTS "Allow authenticated users" ON decision_overrides;
CREATE POLICY "Tenant isolation" ON decision_overrides
  FOR ALL USING (
    deal_id IN (
      SELECT id FROM deals WHERE bank_id = (current_setting('app.bank_id', true))::uuid
    )
  );

-- policy_chunk_versions: direct bank_id check
DROP POLICY IF EXISTS "Allow authenticated users" ON policy_chunk_versions;
CREATE POLICY "Tenant isolation" ON policy_chunk_versions
  FOR ALL USING (
    bank_id = (current_setting('app.bank_id', true))::uuid
  );
SQL
echo ""
echo "⚠️  IMPORTANT: Only run this if your app sets app.bank_id in session config"
echo ""
read -p "Press ENTER after updating RLS policies (or SKIP if not using RLS)..."

# ------------------------------------------------------------
# STEP 4: SMOKE TEST PRODUCTION APIs
# ------------------------------------------------------------
echo ""
echo "STEP 4: Production Smoke Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Enter a real deal_id from your production database:"
read -p "DEAL_ID: " DEAL_ID
echo ""
echo "Enter your production domain (e.g., buddy.vercel.app):"
read -p "DOMAIN: " DOMAIN
echo ""

BASE_URL="https://${DOMAIN}"

echo "Testing: POST ${BASE_URL}/api/deals/${DEAL_ID}/decision"
echo ""
echo "Payload:"
cat <<JSON
{
  "userId": "test-user-id",
  "decision": "approve_with_conditions",
  "decision_summary": "Production smoke test decision",
  "confidence": 0.85,
  "confidence_explanation": "All conditions met with minor exceptions",
  "inputs_json": {"loan_amount": 250000, "term_months": 84},
  "evidence_snapshot_json": {"items": [{"key": "test", "value": "production"}]},
  "policy_snapshot_json": {},
  "policy_eval_json": {"rules_passed": 10, "rules_failed": 0},
  "exceptions_json": [],
  "model_json": {"version": "v1.0", "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
}
JSON
echo ""
echo "Run this curl command to test:"
echo ""
cat <<CURL
curl -X POST "${BASE_URL}/api/deals/${DEAL_ID}/decision" \\
  -H "Content-Type: application/json" \\
  -H "Cookie: YOUR_AUTH_COOKIE" \\
  -d '{
    "userId": "test-user-id",
    "decision": "approve_with_conditions",
    "decision_summary": "Production smoke test decision",
    "confidence": 0.85,
    "confidence_explanation": "All conditions met with minor exceptions",
    "inputs_json": {"loan_amount": 250000, "term_months": 84},
    "evidence_snapshot_json": {"items": [{"key": "test", "value": "production"}]},
    "policy_snapshot_json": {},
    "policy_eval_json": {"rules_passed": 10, "rules_failed": 0},
    "exceptions_json": [],
    "model_json": {"version": "v1.0", "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
  }'
CURL
echo ""
read -p "Press ENTER after running test (or SKIP)..."

# ------------------------------------------------------------
# STEP 5: VERIFY UI PAGES
# ------------------------------------------------------------
echo ""
echo "STEP 5: Verify UI Pages"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Open these URLs in your browser:"
echo ""
echo "  1. Decision One-Pager:"
echo "     ${BASE_URL}/deals/${DEAL_ID}/decision"
echo ""
echo "  2. Decision Replay:"
echo "     ${BASE_URL}/deals/${DEAL_ID}/decision/replay"
echo ""
echo "  3. Overrides Management:"
echo "     ${BASE_URL}/deals/${DEAL_ID}/decision/overrides"
echo ""
echo "Expected: All pages load without 404 or TypeScript errors"
echo ""
read -p "Press ENTER after verifying UI..."

# ------------------------------------------------------------
# STEP 6: CHECK DEAL_EVENTS INTEGRATION
# ------------------------------------------------------------
echo ""
echo "STEP 6: Verify deal_events Integration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Run this query in Supabase to verify events were logged:"
echo ""
cat <<SQL
SELECT 
  kind,
  description,
  metadata->>'actor_role' as actor_role,
  metadata->>'snapshot_id' as snapshot_id,
  created_at
FROM deal_events
WHERE deal_id = '${DEAL_ID}'
  AND kind LIKE 'decision_%'
ORDER BY created_at DESC
LIMIT 5;
SQL
echo ""
echo "Expected: decision_snapshot_created events with metadata populated"
echo ""
read -p "Press ENTER after verifying..."

# ------------------------------------------------------------
# SUMMARY
# ------------------------------------------------------------
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DECISION OS DEPLOYMENT COMPLETE"
echo ""
echo "📊 What You Just Deployed:"
echo "  • 3 new database tables (decision_snapshots, decision_overrides, policy_chunk_versions)"
echo "  • 7 API routes (decision CRUD, overrides, guided portal)"
echo "  • 7 UI pages (one-pager, replay, overrides, guided submission)"
echo "  • Immutability triggers for audit-grade protection"
echo "  • Full integration with existing deal_events timeline"
echo ""
echo "📚 Documentation:"
echo "  • Implementation guide: DECISION_OS_COMPLETE.md"
echo "  • Smoke test script: scripts/smoke-test-decision-os.sh"
echo ""
echo "🎯 Next Actions:"
echo "  1. Wire decision creation into your underwriting flow"
echo "  2. Add \"View Decision\" link to deal command center"
echo "  3. Email borrowers guided portal links after decisions"
echo "  4. Monitor override patterns in decision_overrides table"
echo ""
echo "🚀 Decision OS is LIVE!"
echo ""
