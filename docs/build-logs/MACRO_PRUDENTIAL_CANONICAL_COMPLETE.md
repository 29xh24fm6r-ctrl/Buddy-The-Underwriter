# Macro-Prudential Intelligence + Canonical Access Pages

## Overview
This commit adds:
1. **Macro-prudential intelligence**: Portfolio aggregation, stress testing, systemic risk analysis
2. **Canonical access pages**: Clear navigation structure for all governance features

## What's Built

### A. Macro-Prudential Intelligence

#### Database Schema (Migration: 20251228_macro_prudential.sql)
- **portfolio_risk_snapshots**: Time-series portfolio metrics
  - total_exposure, risk_weighted_exposure
  - exception_rate, committee_override_rate
  - concentration_json (flexible metrics by industry, geography, loan size, etc.)
- **stress_test_scenarios**: Shock definitions
  - shock_json: {dscr_delta, ltv_delta, loan_amount_multiplier, etc.}
- **stress_test_results**: Stress test outcomes
  - approvals_flipped_to_decline
  - capital_at_risk
  - results_json (per-deal outcomes)

#### Portfolio Aggregation (src/lib/macro/aggregatePortfolio.ts)
- Aggregates all final decision snapshots into system-wide view
- Calculates:
  - Total exposure
  - Risk-weighted assets
  - Exception rate
  - Committee override rate
  - Concentration metrics (by loan size, decision type)
- Stores daily snapshots for trend analysis

#### Stress Testing (src/lib/macro/runStressTest.ts)
- Replays historical decisions under shock scenarios
- Example shocks:
  - DSCR deteriorates 20% (dscr_delta: -0.2)
  - LTV increases 10% (ltv_delta: 0.1)
  - Loan amounts drop 10% (loan_amount_multiplier: 0.9)
- Tracks:
  - Approvals flipped to decline
  - Declines flipped to approval
  - Capital at risk

#### API Routes
- **POST /api/admin/portfolio/aggregate**: Trigger portfolio aggregation (nightly cron)
- **POST /api/admin/stress-test/run**: Run stress test scenario
- **POST /api/admin/stress-test/scenarios**: Create/list stress test scenarios

### B. Canonical Access Pages

All features are now accessible via clear, role-appropriate pages:

#### /governance - Governance Command Center
- **Audience**: CRO, Chief Credit Officer, Examiner
- **Shows**:
  - Attestation policy status
  - Committee policy status
  - Committee member roster
  - Recent decisions
  - Quick links to all governance features

#### /committee - Credit Committee Command Center
- **Audience**: Committee members, Credit Chair
- **Shows**:
  - Active decisions awaiting vote
  - Committee roster
  - Recent committee decisions
  - Vote tallies (via existing CommitteePanel component)

#### /policy - Living Credit Policy
- **Audience**: Credit Policy Officer, CRO
- **Shows**:
  - Active committee policy (trigger rules)
  - Active attestation policy
  - AI-extracted policy rules (pending approval)
  - Policy configuration links

#### /examiner - Examiner Mode Home
- **Audience**: Regulators, examiners (read-only)
- **Shows**:
  - Final decisions (searchable)
  - Summary stats (final decisions, committee decisions, attestations)
  - Export instructions (regulator ZIP, verification QR codes)
  - Links to individual decisions in examiner mode (?examiner=true)

#### /risk - Risk Intelligence Dashboard
- **Audience**: CRO, Risk Management
- **Shows**:
  - Committee override rate
  - Decisions with exceptions
  - Exception concentration by underwriter
  - Early-warning signals (e.g., override rate >20%)
  - Future placeholders (policy drift, counterfactual analysis, etc.)

#### /portfolio - Macro-Prudential Dashboard (existing Stitch design preserved)
- **Audience**: CEO, CRO, Board
- System-wide portfolio view (Stitch design intact)

## How This Works

### Navigation Structure
```
• Deals (existing)
• Governance → Policy compliance, attestation, committee
• Portfolio → System-wide risk metrics
• Policy → Living credit policy, extracted rules
• Committee → Voting, dissent, minutes
• Risk → Behavioral patterns, early warnings
• Examiner → Read-only regulator view
```

### Nightly Workflow (Recommended)
1. Scheduled function triggers `/api/admin/portfolio/aggregate`
2. Aggregates all final decisions into daily snapshot
3. Calculates:
   - Total exposure
   - Risk-weighted assets
   - Exception rate
   - Committee override rate
4. Stores snapshot in `portfolio_risk_snapshots`
5. Trend data appears in `/portfolio` page

### Stress Testing Workflow
1. Admin creates scenario via `/api/admin/stress-test/scenarios`
   ```json
   {
     "name": "20% DSCR Deterioration",
     "shock_json": {
       "dscr_delta": -0.2
     }
   }
   ```
2. Run scenario via `/api/admin/stress-test/run`
3. Results stored in `stress_test_results`
4. View on `/portfolio` page

### Examiner Access Pattern
1. Examiner visits `/examiner`
2. Views list of final decisions
3. Clicks decision → redirects to `/deals/[dealId]/decision?examiner=true`
4. Sees yellow banner (read-only mode)
5. Can download:
   - Regulator PDF (with letterhead + hash + QR code)
   - Regulator ZIP (7-file bundle)
6. Can scan QR code → public verification endpoint `/api/verify/[hash]`

## Migration Instructions

### 1. Run Database Migration
```sql
-- Run in Supabase SQL Editor:
-- supabase/migrations/20251228_macro_prudential.sql
```

### 2. Test Portfolio Aggregation
```bash
curl -X POST http://localhost:3000/api/admin/portfolio/aggregate \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Create Stress Test Scenario
```bash
curl -X POST http://localhost:3000/api/admin/stress-test/scenarios \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DSCR Stress",
    "description": "20% DSCR deterioration",
    "shock_json": {"dscr_delta": -0.2}
  }'
```

### 4. Run Stress Test
```bash
curl -X POST http://localhost:3000/api/admin/stress-test/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scenarioId": "SCENARIO_UUID"}'
```

## What This Means

Buddy now answers supervisory-grade questions:
- **"What did we decide?"** → /deals/[dealId]/decision
- **"Why did we decide it?"** → Decision PDF with policy evaluation
- **"Who approved it?"** → Attestation chain
- **"Who disagreed?"** → Committee dissent
- **"Is policy actually followed?"** → /policy (drift detection coming)
- **"Where is capital accumulating risk?"** → /portfolio (stress tests)
- **"What breaks under stress?"** → Stress test results
- **"What will regulators criticize?"** → /risk (early warnings)

## Navigation Philosophy

**Every feature is one click from /governance.**

No hidden power. No tribal knowledge. No "demo magic."

The system is:
- **Discoverable**: Clear page structure
- **Explorable**: Links between related features
- **Defensible**: Regulator-ready exports at every level

## Next Steps (Optional)

If you want to go deeper:

### Intelligence Layer (9 Features from Previous Spec)
- Policy drift detection (actual vs. stated policy)
- Silent risk accumulation detection
- Living credit policy (AI-suggested updates)
- Counterfactual decisions ("what if we removed exceptions?")
- Shadow committee replay (deliberation timeline)
- Examiner question simulator
- Early-warning system enhancements
- Capital allocation ledger
- Enhanced concentration analytics

### Board-Ready Features
- Quarterly risk packs (auto-generated)
- M&A due-diligence mode
- Inter-bank benchmarking (anonymized)

## Files Changed
- supabase/migrations/20251228_macro_prudential.sql
- src/lib/macro/aggregatePortfolio.ts
- src/lib/macro/runStressTest.ts
- src/app/(app)/governance/page.tsx
- src/app/(app)/committee/page.tsx
- src/app/(app)/policy/page.tsx
- src/app/(app)/examiner/page.tsx
- src/app/(app)/risk/page.tsx
- src/app/api/admin/portfolio/aggregate/route.ts
- src/app/api/admin/stress-test/run/route.ts
- src/app/api/admin/stress-test/scenarios/route.ts
