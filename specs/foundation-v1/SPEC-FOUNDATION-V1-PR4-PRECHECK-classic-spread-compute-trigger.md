# SPEC-FOUNDATION-V1 PR4 PRECHECK — Classic Spread compute-trigger verification

**Status:** Ready for Claude Code (verification only, no code changes)
**Owner:** Matt → Claude in chat (analysis) → Claude Code (verification execution)
**Filed:** 2026-05-08
**Blocks:** SPEC-FOUNDATION-V1 PR4 scope decision

## Why this exists

While performing the Conventional Banker Flow walkthrough, Claude-in-chat discovered that `src/app/api/deals/[dealId]/classic-spread/route.ts` (the Classic Spread PDF generation endpoint) contains an embedded compute pathway that:

1. Reads `deal_structural_pricing.annual_debt_service_est`
2. Reads latest `EBITDA` / `ORDINARY_BUSINESS_INCOME` / `NET_INCOME` from `deal_financial_facts`
3. Computes DSCR = NCADS / proposedAds
4. **Upserts these as canonical facts into `deal_financial_facts`** with `extractor: "classicSpread:debtService:v1"`:
   - `FINANCIAL_ANALYSIS / ANNUAL_DEBT_SERVICE`
   - `FINANCIAL_ANALYSIS / DSCR`
   - `FINANCIAL_ANALYSIS / CASH_FLOW_AVAILABLE`
   - `FINANCIAL_ANALYSIS / EXCESS_CASH_FLOW`
5. Rebuilds and persists the financial snapshot via `buildDealFinancialSnapshotForBank` + `persistFinancialSnapshot`

This is precisely the compute that SPEC-FOUNDATION-V1 PR4 (cash flow aggregator) was scoped to build from scratch. If it works on Samaritus, PR4's scope changes materially.

## Live data state for Samaritus (verified 2026-05-08)

Pre-verified in chat via Supabase MCP queries against `0279ed32-c25c-4919-b231-5790050331dd`:

| Input | Status |
|---|---|
| `BALANCE_SHEET` facts | 6 distinct keys ✓ (preflight gate requires ≥1) |
| `INCOME_STATEMENT` facts | 13 distinct keys ✓ (preflight gate requires ≥1) |
| `TAX_RETURN` facts | 86 facts, 35 distinct keys |
| `deal_structural_pricing.annual_debt_service_est` | $69,480 (computed 2026-04-03) |

Preflight should NOT block. Compute should fire. DSCR should populate.

**However** — this has not been actually executed. Verifying it now is mandatory before reshaping PR4.

## Verification steps

### Step 1 — Pre-execute fact inventory baseline

Run this SQL to capture the BEFORE state:

```sql
-- BEFORE: financial analysis facts on Samaritus
SELECT 
  fact_type, fact_key, fact_value_num, 
  provenance->>'extractor' AS extractor,
  created_at
FROM deal_financial_facts
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
  AND fact_type = 'FINANCIAL_ANALYSIS'
  AND is_superseded = false
ORDER BY fact_key, created_at DESC;
```

Paste output. Expected: probably empty or near-empty. This is the proof that DSCR has never been computed for Samaritus.

### Step 2 — Trigger Classic Spread for Samaritus

Two ways to do this:

**Option A — via the running app:**
1. Navigate to `/deals/0279ed32-c25c-4919-b231-5790050331dd/classic-spreads`
2. Click "Generate Spread"
3. Wait for PDF to render

**Option B — via direct API call (preferred for verification):**
```bash
# From a terminal with valid Clerk session cookies, OR via authenticated curl:
curl -i 'https://buddytheunderwriter.com/api/deals/0279ed32-c25c-4919-b231-5790050331dd/classic-spread' \
  -H 'Cookie: __session=<your-clerk-session>' \
  -o samaritus-classic-spread.pdf
```

Capture:
- HTTP status (expected 200; 409 means preflight blocked)
- Response headers (content-type should be `application/pdf`)
- PDF file size (should be > 0 bytes)
- Any 4xx/5xx errors

If preflight returns 409 with `status: "blocked"`, paste the JSON response. That changes the verification outcome.

### Step 3 — Post-execute fact inventory

Run the same SQL as Step 1 again. Expected: 4 new rows for ANNUAL_DEBT_SERVICE / DSCR / CASH_FLOW_AVAILABLE / EXCESS_CASH_FLOW with `extractor = 'classicSpread:debtService:v1'`.

Paste output.

### Step 4 — Re-evaluate readiness contract

Run V-8-equivalent: re-evaluate `evaluateMemoReadinessContract` against Samaritus and capture the result. The same script pattern from PR2's V-8 hand-off:

```ts
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";
import { buildCanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemoV1";
import { evaluateMemoReadinessContract } from "@/lib/creditMemo/submission/evaluateMemoReadinessContract";

const dealId = "0279ed32-c25c-4919-b231-5790050331dd";
const pkg = await buildMemoInputPackage({ dealId, runReconciliation: true });
if (!pkg.ok) throw new Error("Package build failed");
const memo = await buildCanonicalCreditMemoV1({ dealId, bankId: pkg.bankId, package: pkg.package });
const readiness = evaluateMemoReadinessContract({ memo, overrides: pkg.package.banker_overrides.overrides });

console.log(JSON.stringify({
  required: readiness.required,
  blockers: readiness.blockers,
  collateralGrossValue: memo.collateral.gross_value,
  dscr: memo.financial_analysis.dscr,
  cashFlowAvailable: memo.financial_analysis.cash_flow_available,
  annualDebtService: memo.financial_analysis.annual_debt_service,
}, null, 2));
```

Paste full output.

### Step 5 — Snapshot verification

Confirm the financial snapshot was persisted:

```sql
SELECT 
  id, created_at, 
  (snapshot_json->'dscr'->>'value_num')::numeric AS dscr_in_snapshot,
  (snapshot_json->'annual_debt_service'->>'value_num')::numeric AS ads_in_snapshot,
  (snapshot_json->>'completeness_pct')::numeric AS completeness_pct,
  jsonb_array_length(snapshot_json->'missing_required_keys') AS missing_count
FROM deal_financial_snapshots
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
ORDER BY created_at DESC
LIMIT 3;
```

Paste output.

## Decision tree based on verification outcome

### Outcome A — Classic Spread succeeds, DSCR populates, readiness clears

This is the win. Conclusions:

1. **Samaritus walks end-to-end after a single banker action** ("Generate Spread"). No PR4 build required to unblock the first deal.
2. **PR4's scope is fundamentally revised.** Instead of "build the cash flow aggregator," PR4 becomes "extract the existing aggregator from the Classic Spread side-effect and run it on a proper trigger so DSCR populates without requiring banker to click Generate Spread first."
3. **The conservative-tier methodology layer** (Stress A/B/C, worst-of-three living expense, owner W-2 conditional add-back, pro-rata affiliate, etc.) **is still PR4 work**, because the embedded compute does naive DSCR = NCADS / ADS without stress scenarios.

Update needed: revise `specs/foundation-v1/SPEC-FOUNDATION-V1-PR4-cash-flow-aggregator.md` to reflect this discovery. New companion spec drafted in Work Package 3 below.

### Outcome B — Preflight blocks (409 returned with missing facts)

Means Samaritus's BS/IS facts aren't where the loader expects them. Investigation needed before any PR4 decision:

1. Re-run the loader's BS/IS row query path against Samaritus to find what's expected vs present.
2. Determine if it's a fact-key mismatch (extracted under different keys than the loader looks for) or a true gap (not enough rows).
3. File the gap as a follow-up before PR4 scope changes.

### Outcome C — Classic Spread succeeds but readiness still doesn't clear

Means the bridge wrote facts but something else in the readiness contract path doesn't see them. Investigation needed:

1. Confirm `computeDscrGlobal` reads from the right facts table / scope.
2. Confirm bank_id is consistently set on the new facts.
3. Likely a small surgical fix to memo build path.

### Outcome D — Classic Spread fails entirely (5xx)

Means the route is broken in production for Samaritus. Highest-priority fix before PR4 scope discussion. Capture full error.

## Constraints

- This is verification ONLY. Do not modify any code.
- The fact upsert in the Classic Spread route is idempotent (`onConflict` clause). Re-running is safe.
- Triggering Classic Spread WRITES facts — this is a real production data mutation. Acceptable here because Samaritus is a test deal and the writes are facts the system needs anyway. But do NOT run this verification on any other deal without separate approval.

## Deliverable

A comment on this spec (or follow-up message in chat) containing:
1. Step 1 SQL output (BEFORE state)
2. Step 2 HTTP/PDF outcome
3. Step 3 SQL output (AFTER state)
4. Step 4 readiness contract JSON
5. Step 5 snapshot SQL output
6. Verification outcome label (A/B/C/D)

Then await Matt's call on next steps based on outcome.
