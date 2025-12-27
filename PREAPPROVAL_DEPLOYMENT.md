# Pre-Approval Simulator - Deployment Instructions

## 🚀 Step-by-Step Deployment

### 1. Database Migration

**Apply the migration to Supabase:**

#### Option A: Supabase Dashboard (Recommended)
1. Log in to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to **SQL Editor**
4. Click **New Query**
5. Copy contents of `supabase/migrations/20251227000008_preapproval_simulator.sql`
6. Paste into SQL Editor
7. Click **Run** (or press Ctrl+Enter)
8. Verify success: "Success. No rows returned"

#### Option B: Local Migration (If using Supabase CLI)
```bash
# From project root
supabase db push

# Or apply specific migration
psql $DATABASE_URL -f supabase/migrations/20251227000008_preapproval_simulator.sql
```

#### Verify Migration
```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('preapproval_sim_runs', 'preapproval_sim_results');

-- Expected: 2 rows

-- Check enum exists
SELECT enumlabel 
FROM pg_enum 
WHERE enumtypid = 'sim_status'::regtype;

-- Expected: running, succeeded, failed

-- Check helper functions
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name IN ('get_latest_simulation', 'log_sim_stage');

-- Expected: 2 rows
```

---

### 2. Environment Variables

**No new environment variables required!** Phase 5 reuses existing:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLERK_SECRET_KEY`
- `OPENAI_API_KEY` (optional, for future agent integration)

---

### 3. Code Deployment

#### Next.js Build
```bash
# From project root
npm run build

# Expected: Build succeeded without errors
# Check: "Phase 5 files" should have 0 TypeScript errors
```

#### Deploy to Production
```bash
# If using Vercel
vercel --prod

# If using custom hosting
npm run build
npm run start
```

---

### 4. Verification

#### Run Verification Script
```bash
./scripts/verify-preapproval-simulator.sh

# Expected: "All checks passed! Phase 5 is ready to ship. 🚀"
```

#### Test API (Local)
```bash
# Replace <dealId> with actual deal ID
./scripts/demo-preapproval-simulator.sh <dealId>

# Expected:
# ✓ Simulation started
# ✓ Status: succeeded
# ✓ SBA: PASS (or CONDITIONAL)
# ✓ Conventional: PASS/CONDITIONAL/FAIL
# ✓ X offers generated
# ✓ Y% confidence
```

#### Test UI (Local)
1. Start dev server: `npm run dev`
2. Navigate to: `http://localhost:3000/deals/[dealId]/preapproval`
3. Click "Run Simulator"
4. Verify:
   - Status shows "running" with progress bar
   - Progress: 0% → 25% → 50% → 75% → 100%
   - Stages: S1 → S2 → S3 → S4 → DONE
   - Outcomes display (green PASS, yellow CONDITIONAL, or red FAIL)
   - Offers grid shows 2-3 cards
   - Punchlist shows borrower/banker/system actions
   - Confidence badge shows 0-100%

---

### 5. Production Smoke Test

#### Test API (Production)
```bash
# Replace with production URL and dealId
curl -X POST https://your-domain.com/api/deals/<dealId>/preapproval/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLERK_TOKEN" \
  -d '{"mode": "DUAL"}'

# Expected: {"ok":true,"run_id":"<uuid>"}

# Check status
curl https://your-domain.com/api/deals/<dealId>/preapproval/status?runId=<uuid> \
  -H "Authorization: Bearer $CLERK_TOKEN"

# Expected: {"ok":true,"run":{...},"result":{...}}
```

#### Test UI (Production)
1. Navigate to: `https://your-domain.com/deals/[dealId]/preapproval`
2. Verify page loads without errors
3. Click "Run Simulator"
4. Verify complete flow (5-10 seconds)

---

### 6. Database Health Check

#### Check Simulation Runs
```sql
-- View recent simulations
SELECT 
  id,
  deal_id,
  status,
  progress,
  current_stage,
  (finished_at - created_at) AS duration,
  created_at
FROM preapproval_sim_runs
ORDER BY created_at DESC
LIMIT 10;

-- Expected: See recent runs with status 'succeeded'
```

#### Check Simulation Results
```sql
-- View recent results
SELECT 
  r.id,
  r.deal_id,
  r.confidence,
  r.sba_outcome_json->>'status' AS sba_status,
  r.conventional_outcome_json->>'status' AS conv_status,
  jsonb_array_length(r.offers_json) AS num_offers,
  r.created_at
FROM preapproval_sim_results r
ORDER BY r.created_at DESC
LIMIT 10;

-- Expected: See results with confidence 0-1, sba_status/conv_status, num_offers 0-3
```

#### Check for Errors
```sql
-- View failed simulations
SELECT 
  id,
  deal_id,
  error_json,
  created_at
FROM preapproval_sim_runs
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 10;

-- Expected: Ideally 0 rows, or investigate errors if any
```

---

### 7. Monitoring

#### Key Metrics to Track

**Performance:**
- Simulation duration (target: 5-10 seconds)
- API response time (target: <100ms for status check)
- Database query time (target: <50ms)

**Quality:**
- Success rate (target: >95%)
- Confidence distribution (target: 70%+ for high-quality deals)
- Offer count distribution (target: 2-3 offers for PASS outcomes)

**Usage:**
- Simulations per day
- Unique deals simulated
- Re-run rate (borrowers running multiple times)

#### Monitoring Queries
```sql
-- Success rate (last 7 days)
SELECT 
  status,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS percentage
FROM preapproval_sim_runs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY status;

-- Average duration
SELECT 
  AVG(EXTRACT(EPOCH FROM (finished_at - created_at))) AS avg_duration_seconds
FROM preapproval_sim_runs
WHERE status = 'succeeded'
  AND created_at > NOW() - INTERVAL '7 days';

-- Confidence distribution
SELECT 
  CASE 
    WHEN confidence < 0.5 THEN 'Low (0-50%)'
    WHEN confidence < 0.7 THEN 'Medium (50-70%)'
    ELSE 'High (70-100%)'
  END AS confidence_tier,
  COUNT(*) AS count
FROM preapproval_sim_results
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY confidence_tier;
```

---

### 8. Rollback Plan (If Issues Arise)

#### Option A: Hide UI (Quick Fix)
```typescript
// In src/app/deals/[dealId]/preapproval/page.tsx
export default async function PreapprovalSimulatorPage() {
  return (
    <div className="p-6">
      <p>Pre-approval simulator temporarily unavailable. Check back soon.</p>
    </div>
  );
}
```

#### Option B: Rollback Database Migration
```sql
-- Drop tables (data loss!)
DROP TABLE IF EXISTS preapproval_sim_results CASCADE;
DROP TABLE IF EXISTS preapproval_sim_runs CASCADE;
DROP TYPE IF EXISTS sim_status CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS get_latest_simulation(uuid);
DROP FUNCTION IF EXISTS log_sim_stage(uuid, text, text);
```

#### Option C: Disable API Routes
```typescript
// In src/app/api/deals/[dealId]/preapproval/run/route.ts
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Simulator temporarily disabled" },
    { status: 503 }
  );
}
```

---

### 9. Troubleshooting Common Issues

#### Issue: "Simulation stuck at 'running'"
**Cause:** Async execution failed without error logging  
**Fix:**
```sql
-- Check logs
SELECT logs FROM preapproval_sim_runs WHERE id = '<runId>';

-- Manually mark as failed
UPDATE preapproval_sim_runs 
SET status = 'failed', 
    error_json = '{"error": "Manual intervention - stuck run"}'
WHERE id = '<runId>';
```

#### Issue: "No offers generated"
**Cause:** Both SBA and Conventional outcomes are "fail"  
**Fix:** Review reasons array, ensure deal has minimum viable data

#### Issue: "Low confidence scores (<50%)"
**Cause:** Missing connections, missing documents, missing critical fields  
**Fix:** Guide borrowers to:
1. Connect Plaid, QuickBooks, IRS accounts (+0.25 boost)
2. Upload 10+ documents (+0.15 boost)
3. Fill in NAICS, use_of_proceeds, ownership structure

#### Issue: "TypeScript errors in UI"
**Cause:** API response shape doesn't match type definition  
**Fix:** Ensure `status/route.ts` parses JSONB fields:
```typescript
result: result ? {
  sba_outcome: result.sba_outcome_json,  // Parse JSONB
  conventional_outcome: result.conventional_outcome_json,
  offers: result.offers_json,
  punchlist: result.punchlist_json,
  // ...
} : null
```

---

### 10. Success Criteria

✅ **Database:**
- Tables created: `preapproval_sim_runs`, `preapproval_sim_results`
- Enum created: `sim_status`
- Functions created: `get_latest_simulation()`, `log_sim_stage()`

✅ **API:**
- POST `/run` returns `run_id` in <500ms
- GET `/status` returns status + results in <100ms
- Success rate >95%

✅ **UI:**
- Page loads without errors
- Simulation completes in 5-10 seconds
- Outcomes display correctly (green/yellow/red)
- Offers grid shows 2-3 cards for PASS outcomes
- Punchlist shows actionable items

✅ **Performance:**
- Simulation duration <10 seconds
- Database queries <50ms
- Zero TypeScript errors

✅ **Quality:**
- Confidence scores align with data completeness
- Offer ranges are conservative (0.5x-1.2x requested)
- Reasons are detailed (not generic "missing data")

---

## 🎉 You're Done!

Phase 5 (Pre-Approval Simulator) is now live. Borrowers can see what they qualify for BEFORE applying.

**Next Steps:**
1. Monitor metrics (success rate, duration, confidence)
2. Gather user feedback (borrowers + bankers)
3. Iterate on policy packs based on real data
4. Plan Phase 6 (wire real agents)

**Questions?** See:
- Full docs: `PREAPPROVAL_SIMULATOR_COMPLETE.md`
- Quick ref: `PREAPPROVAL_SIMULATOR_QUICKREF.md`
- Implementation: `PHASE_5_COMPLETE.md`

🚀 **Ship it!**
