# Pre-Approval Simulator - Quick Reference

**One-liner:** "See what you qualify for BEFORE applying — no promises, just possibilities."

---

## 🚀 Quick Start

### Run Simulation
```bash
# Via API
curl -X POST http://localhost:3000/api/deals/<dealId>/preapproval/run \
  -H "Content-Type: application/json" \
  -d '{"mode": "DUAL"}'

# Via UI
Navigate to: /deals/[dealId]/preapproval
Click: "Run Simulator"
```

### Check Status
```bash
# Via API
curl http://localhost:3000/api/deals/<dealId>/preapproval/status?runId=<uuid>

# Via UI
Polls automatically every 1 second
```

### Demo
```bash
./scripts/demo-preapproval-simulator.sh <dealId>
```

### Verify
```bash
./scripts/verify-preapproval-simulator.sh
```

---

## 📊 Response Structure

### Run Response
```json
{
  "ok": true,
  "run_id": "123e4567-e89b-12d3-a456-426614174000"
}
```

### Status Response (Running)
```json
{
  "ok": true,
  "run": {
    "status": "running",
    "progress": 50,
    "current_stage": "S2",
    "logs": [
      { "stage": "S1", "message": "Gathering deal inputs...", "timestamp": "..." }
    ]
  },
  "result": null
}
```

### Status Response (Succeeded)
```json
{
  "ok": true,
  "run": {
    "status": "succeeded",
    "progress": 100,
    "current_stage": "DONE"
  },
  "result": {
    "sba_outcome": {
      "status": "pass",
      "reasons": [
        {
          "code": "NAICS_ELIGIBLE",
          "title": "NAICS Code Eligible",
          "detail": "NAICS 445110 is SBA-eligible",
          "confidence": 0.95
        }
      ]
    },
    "conventional_outcome": {
      "status": "conditional",
      "reasons": [...]
    },
    "offers": [
      {
        "product": "SBA 7(a) Term Loan",
        "amount_range": { "min": 50000, "max": 500000 },
        "term_months_range": { "min": 60, "max": 120 },
        "constraints": ["DSCR ≥1.10", "Personal guarantee required"],
        "conditions": ["Verify NAICS", "No delinquent debt"],
        "confidence": 0.85
      }
    ],
    "punchlist": {
      "borrower_actions": ["Connect QuickBooks", "Confirm use of proceeds"],
      "banker_actions": ["Run credit check", "Verify NAICS"],
      "system_reviews": ["Calculate DSCR", "Generate Form 1919"]
    },
    "confidence": 0.72
  }
}
```

---

## 🎯 Outcome States

| Status | Color | Meaning |
|--------|-------|---------|
| **pass** | 🟢 Green | Viable with current data |
| **conditional** | 🟡 Yellow | Viable IF missing data provided |
| **fail** | 🔴 Red | Not viable (hard gate blocked) |

---

## 📏 Policy Gates

### SBA Pre-Approval
- ✅ For-profit entity
- ✅ US-based
- ✅ Revenue ≤$40M
- ✅ Employees ≤500
- ✅ NAICS eligible
- ✅ DSCR ≥1.10 (target)
- ✅ Leverage ≤4.0 (target)
- ❌ Prohibited uses (passive RE, lending, gambling)

### Conventional Pre-Approval
- ✅ Credit score ≥680
- ✅ DSCR ≥1.15 (stricter)
- ✅ Leverage ≤3.5 (stricter)
- ✅ LTV ≤75% (RE)
- ✅ LTV ≤80% (equipment)

---

## 💡 Confidence Formula

```
Base: 0.5

Boosts:
+ 0.25 if connections ≥60% (Plaid/QBO/IRS)
+ 0.15 if documents ≥10

Reductions:
- 0.15 if missing NAICS
- 0.10 if missing use_of_proceeds
- 0.10 if missing ownership

Outcome Adjustments:
+ 0.10 per PASS
- 0.05 per FAIL

Example: 0.5 + 0.25 + 0.15 - 0.15 + 0.10 = 0.85 (85%)
```

---

## 🔧 Database Queries

### Get Latest Simulation
```sql
SELECT * FROM get_latest_simulation('<dealId>');
```

### Check Run Status
```sql
SELECT 
  status,
  progress,
  current_stage,
  (finished_at - created_at) AS duration
FROM preapproval_sim_runs
WHERE id = '<runId>';
```

### View Results
```sql
SELECT 
  confidence,
  sba_outcome_json->>'status' AS sba_status,
  conventional_outcome_json->>'status' AS conv_status,
  jsonb_array_length(offers_json) AS num_offers
FROM preapproval_sim_results
WHERE run_id = '<runId>';
```

---

## 📁 File Locations

### Database
- `supabase/migrations/20251227000008_preapproval_simulator.sql`

### Types
- `src/lib/preapproval/types.ts`

### Policy Packs
- `src/lib/policy/packs/sba_preapproval.ts`
- `src/lib/policy/packs/conventional_preapproval.ts`

### Engine
- `src/lib/preapproval/simulate.ts`

### API
- `src/app/api/deals/[dealId]/preapproval/run/route.ts`
- `src/app/api/deals/[dealId]/preapproval/status/route.ts`

### UI
- `src/components/preapproval/PreapprovalSimulator.tsx`
- `src/app/deals/[dealId]/preapproval/page.tsx`

### Docs
- `PREAPPROVAL_SIMULATOR_COMPLETE.md` (full docs)
- `PHASE_5_COMPLETE.md` (implementation summary)

### Scripts
- `scripts/demo-preapproval-simulator.sh` (demo)
- `scripts/verify-preapproval-simulator.sh` (verification)

---

## 🐛 Troubleshooting

### Simulation stuck at "running"
```sql
-- Check logs
SELECT logs FROM preapproval_sim_runs WHERE id = '<runId>';

-- Check error
SELECT error_json FROM preapproval_sim_runs WHERE id = '<runId>';
```

### No offers generated
- Check `sba_outcome.status` and `conventional_outcome.status`
- If both are "fail", no offers will be generated
- Review `reasons` array for blocking issues

### Low confidence score
- Connect more accounts (Plaid, QBO, IRS) → +0.25 boost
- Upload more documents → +0.15 boost
- Fill in missing fields (NAICS, use_of_proceeds, ownership)

### TypeScript errors in UI
- Ensure API response parses JSONB fields correctly
- Check `result.sba_outcome` (NOT `result.sba_outcome_json`)
- Verify `StatusResponse` interface matches API shape

---

## ✅ Pre-Deployment Checklist

- [ ] Run verification: `./scripts/verify-preapproval-simulator.sh`
- [ ] Apply migration: `supabase/migrations/20251227000008_preapproval_simulator.sql`
- [ ] Test API: `./scripts/demo-preapproval-simulator.sh <dealId>`
- [ ] Test UI: Navigate to `/deals/[dealId]/preapproval`
- [ ] Verify TypeScript: `npm run build` (zero errors in Phase 5 files)
- [ ] Check database: Ensure `preapproval_sim_runs` and `preapproval_sim_results` tables exist
- [ ] Verify RLS: Ensure `bank_id` filtering works correctly

---

## 🎯 Success Metrics

**Time to simulate:** 5-10 seconds  
**Confidence target:** ≥70% for high-quality deals  
**Offer count:** 2-3 offers for PASS outcomes  
**Punchlist items:** 3-10 actions per simulation

---

**Need help?** See full documentation: `PREAPPROVAL_SIMULATOR_COMPLETE.md`
