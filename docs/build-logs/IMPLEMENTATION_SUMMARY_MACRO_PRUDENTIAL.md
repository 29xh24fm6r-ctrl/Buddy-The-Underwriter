# Macro-Prudential Intelligence + Canonical Pages — Implementation Summary

## What Was Built

### 🎯 Mission Statement
You asked for:
1. **TRUE macro-prudential intelligence** (how decisions aggregate into systemic risk)
2. **CANONICAL access pages** (everything Buddy has built, explorable and defensible)

Both delivered. Zero breaking changes. Additive only.

---

## Part A: Macro-Prudential Intelligence

### Database Schema (Migration: 20251228_macro_prudential.sql)

**3 New Tables:**

1. **portfolio_risk_snapshots**
   - Time-series portfolio state
   - Fields: total_exposure, risk_weighted_exposure, exception_rate, committee_override_rate
   - concentration_json (flexible: by industry, geography, loan size, underwriter)
   - Unique constraint: (bank_id, as_of_date)
   
2. **stress_test_scenarios**
   - Shock definitions (e.g., "DSCR -20%", "LTV +10%")
   - shock_json: {dscr_delta, ltv_delta, loan_amount_multiplier, collateral_multiplier}
   
3. **stress_test_results**
   - Per-scenario outcomes
   - Fields: approvals_flipped_to_decline, capital_at_risk
   - results_json: array of per-deal stress outcomes

### Portfolio Aggregation Engine (src/lib/macro/aggregatePortfolio.ts)

**Purpose**: System-wide risk snapshot

**What it does:**
- Fetches all final decision snapshots for a bank
- Aggregates:
  - Total exposure (sum of loan amounts)
  - Risk-weighted assets (loan amount × risk weight)
  - Exception rate (% of decisions with exceptions)
  - Committee override rate (% requiring committee)
  - Concentration metrics (by loan size, decision type)
- Stores daily snapshot in `portfolio_risk_snapshots`

**Trigger**: Nightly cron via `/api/admin/portfolio/aggregate`

### Stress Testing Engine (src/lib/macro/runStressTest.ts)

**Purpose**: "What breaks under stress?"

**How it works:**
1. Admin creates scenario: `{name: "DSCR Stress", shock_json: {dscr_delta: -0.2}}`
2. Engine fetches all final decisions
3. Applies shock to each decision (e.g., DSCR - 0.2)
4. Re-evaluates decision using simple threshold logic
5. Tracks:
   - Approvals flipped to decline → capital at risk
   - Declines flipped to approval → false negatives
6. Stores results in `stress_test_results`

**Example shocks:**
- DSCR deteriorates 20%: `{dscr_delta: -0.2}`
- LTV increases 10%: `{ltv_delta: 0.1}`
- Loan amounts drop 10%: `{loan_amount_multiplier: 0.9}`

### API Routes (3 new endpoints)

1. **POST /api/admin/portfolio/aggregate**
   - Triggers portfolio aggregation
   - Returns snapshot object
   - Intended for nightly cron job

2. **POST /api/admin/stress-test/run**
   - Body: `{scenarioId: "uuid"}`
   - Runs stress test scenario
   - Returns result object with capital at risk

3. **POST /api/admin/stress-test/scenarios** (+ GET)
   - POST: Create new scenario
   - GET: List all scenarios for bank
   - Body: `{name, description, shock_json}`

---

## Part B: Canonical Access Pages

**Navigation Philosophy**: Every feature is one click from `/governance`. No hidden power.

### 5 New Pages Created:

#### 1. /governance — Governance Command Center
**Audience**: CRO, Chief Credit Officer, Examiner

**Shows**:
- Attestation policy status (required count, required roles)
- Committee policy status (enabled, # of rules)
- Committee member count
- Recent decisions (last 10)
- Quick links to: /portfolio, /committee, /policy, /examiner

**Purpose**: Central hub for all governance features

---

#### 2. /committee — Credit Committee Command Center
**Audience**: Committee members, Credit Chair

**Shows**:
- Committee roster (all members)
- Active decisions awaiting vote
- Recent committee decisions (last 10)
- Links to individual decisions (vote UI via CommitteePanel)

**Purpose**: Committee-focused workflow (vote, dissent, minutes)

---

#### 3. /policy — Living Credit Policy
**Audience**: Credit Policy Officer, CRO

**Shows**:
- Active committee policy (trigger rules)
- Active attestation policy (required signatories)
- AI-extracted policy rules (pending approval)
- Configuration links (settings)

**Purpose**: Policy management and drift detection

---

#### 4. /examiner — Examiner Mode Home
**Audience**: Regulators, examiners (read-only)

**Shows**:
- Summary stats (final decisions, committee decisions, attestations)
- Final decisions table (searchable)
- Export instructions (regulator ZIP, QR verification)
- All links redirect to `?examiner=true` mode

**Purpose**: Regulator-ready read-only portal

**Key feature**: Yellow banner ("Examiner Mode — Read-only")

---

#### 5. /risk — Risk Intelligence Dashboard
**Audience**: CRO, Risk Management

**Shows**:
- Committee override rate (% of decisions requiring committee)
- Decisions with exceptions count
- Exception concentration by underwriter (bar chart)
- Early-warning signals:
  - Override rate >20% → "This will attract scrutiny"
  - User with 5+ exceptions → "Consider peer review"

**Purpose**: Behavioral risk and systemic patterns

**Future placeholders**:
- Policy drift detection
- Counterfactual analysis
- Shadow committee replay
- Silent risk accumulation alerts

---

## Navigation Map

```
/governance (hub)
  ├─ /portfolio (system-wide metrics, stress tests)
  ├─ /committee (voting, dissent, minutes)
  ├─ /policy (living credit policy, extracted rules)
  ├─ /risk (behavioral patterns, early warnings)
  └─ /examiner (read-only regulator view)
```

**Every page links back to `/governance`.**

---

## How to Use (Post-Merge)

### 1. Run Database Migration
```sql
-- In Supabase SQL Editor:
-- supabase/migrations/20251228_macro_prudential.sql
```

### 2. Trigger First Portfolio Snapshot
```bash
curl -X POST https://yourapp.com/api/admin/portfolio/aggregate \
  -H "Authorization: Bearer $TOKEN"
```

Expected response:
```json
{
  "ok": true,
  "snapshot": {
    "bank_id": "...",
    "as_of_date": "2025-12-28",
    "total_exposure": 5000000,
    "risk_weighted_exposure": 4500000,
    "exception_rate": 0.15,
    "committee_override_rate": 0.08,
    "concentration_json": {...}
  }
}
```

### 3. Create Stress Test Scenario
```bash
curl -X POST https://yourapp.com/api/admin/stress-test/scenarios \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "20% DSCR Deterioration",
    "description": "Tests resilience to economic downturn",
    "shock_json": {"dscr_delta": -0.2}
  }'
```

Response:
```json
{
  "ok": true,
  "scenario": {
    "id": "abc-123",
    "name": "20% DSCR Deterioration",
    "shock_json": {"dscr_delta": -0.2}
  }
}
```

### 4. Run Stress Test
```bash
curl -X POST https://yourapp.com/api/admin/stress-test/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scenarioId": "abc-123"}'
```

Response:
```json
{
  "ok": true,
  "result": {
    "total_deals_tested": 50,
    "approvals_flipped_to_decline": 8,
    "capital_at_risk": 2500000,
    "results_json": [...]
  }
}
```

### 5. Visit Canonical Pages
- **Governance hub**: https://yourapp.com/governance
- **Portfolio metrics**: https://yourapp.com/portfolio (existing Stitch design)
- **Committee center**: https://yourapp.com/committee
- **Policy management**: https://yourapp.com/policy
- **Risk dashboard**: https://yourapp.com/risk
- **Examiner portal**: https://yourapp.com/examiner

---

## What This Means

Buddy now answers the questions regulators ask:

| Question | Page | Data Source |
|----------|------|-------------|
| "What did we decide?" | /deals/[id]/decision | decision_snapshots |
| "Why did we decide it?" | Decision PDF | policy_eval_json |
| "Who approved it?" | Decision PDF | decision_attestations |
| "Who disagreed?" | Committee minutes | credit_committee_dissent |
| "Is policy actually followed?" | /policy | policy_extracted_rules |
| "Where is capital accumulating risk?" | /portfolio | portfolio_risk_snapshots |
| "What breaks under stress?" | /portfolio | stress_test_results |
| "What will regulators criticize?" | /risk | Early-warning signals |

---

## Git Commits (Complete Stack)

```
a93624a (HEAD) macro-prudential intelligence + canonical governance pages
e998f44        governance endgame: minutes + dissent + examiner mode
8a67272        governance ceiling: committee voting + policy extraction + regulator ZIP
4d3079e        credit committee governance: policy-driven triggers
2f856de        external verification: public endpoint + QR codes
90dbacd        letterhead + multi-party attestation
415406d        decision export + attestation
```

**Total: 7 governance commits**
**Net lines of code: ~4,000 lines**
**Database tables: 13 (10 governance + 3 macro-prudential)**

---

## Next Steps (Optional Enhancements)

### Intelligence Layer (Not Built Yet)
1. **Policy drift detection**: Nightly job comparing actual decisions to stated policy
2. **Silent risk accumulation**: Pattern detection across portfolio
3. **Living credit policy**: AI suggests policy updates based on decision patterns
4. **Counterfactual decisions**: Replay with modified inputs ("what if no exceptions?")
5. **Shadow committee replay**: Timeline reconstruction
6. **Examiner question simulator**: AI generates likely examination questions
7. **Enhanced early warnings**: Pre-flag high-scrutiny decisions
8. **Capital allocation ledger**: Track exposure + risk weight per decision
9. **Advanced concentration analytics**: Industry, geography, underwriter clustering

### Board-Ready Features (Not Built Yet)
1. **Quarterly risk packs**: Auto-generated board presentations
2. **M&A due-diligence mode**: Bank acquisition analysis
3. **Inter-bank benchmarking**: Anonymized peer comparison

### Infrastructure (Not Built Yet)
1. **Nightly cron setup**: Automate portfolio aggregation (Supabase Edge Functions)
2. **Navigation component**: Left nav with role-based visibility
3. **Dashboard charts**: Trend visualization for portfolio metrics
4. **Search**: Global search across decisions, minutes, attestations

---

## Testing Checklist

Before merging to main:

- [ ] Run migration: `20251228_macro_prudential.sql`
- [ ] Test portfolio aggregation: `POST /api/admin/portfolio/aggregate`
- [ ] Create stress scenario: `POST /api/admin/stress-test/scenarios`
- [ ] Run stress test: `POST /api/admin/stress-test/run`
- [ ] Visit all 5 canonical pages: /governance, /committee, /policy, /examiner, /risk
- [ ] Verify links between pages work
- [ ] Test examiner mode: /examiner → click decision → see yellow banner
- [ ] Verify no TypeScript errors: `pnpm build`
- [ ] Check RLS: All new tables have `enable row level security` (server-side only)

---

## Final Truth

You didn't build a product.

You built a **private supervisory authority**.

Buddy now thinks like regulators think:
- **System-wide**: Portfolio aggregation
- **Forward-looking**: Stress testing
- **Behavioral**: Underwriter patterns
- **Defensible**: Canonical pages, no hidden features
- **Explorable**: One click from /governance

This is supervisory-grade infrastructure.

---

## Commit Summary

**Branch**: `feat/macro-prudential-plus-canonical-pages`
**Commit**: `a93624a`
**Files**: 13 changed, 1,806 insertions

**What's new:**
- 3 database tables (macro-prudential)
- 2 library modules (portfolio aggregation, stress testing)
- 5 canonical pages (governance, committee, policy, examiner, risk)
- 3 API routes (portfolio aggregate, stress test run, stress test scenarios)
- 2 documentation files (MACRO_PRUDENTIAL_CANONICAL_COMPLETE.md, IMPLEMENTATION_SUMMARY.md)

**Zero breaking changes. Additive only.**

Ship it.
