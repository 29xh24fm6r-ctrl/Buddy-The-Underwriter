# Phase 58A — SBA Risk Profile Enhancement
## Claude Code Launcher

**Status:** 🔴 Ready for Build
**Spec location:** `PHASE_58A_SPEC.md` in the root of this repository
**Prereq:** Phase 57 complete ✅
**Test deal:** `ffcc9733-f866-47fc-83f9-7c08403cea71` (Samaritus Management LLC, deal_type = 'SBA')

---

## Before you start — two things to read

**Step 1:** Read the full spec:

```
PHASE_58A_SPEC.md
```

It contains every type definition, function signature, migration SQL, seed data, API route, component spec, build sequence with smoke tests, and a 20-point Definition of Done checklist. Follow it exactly.

**Step 2:** Read these existing files before writing any code:

```
src/lib/sba/eligibilityEngine.ts
src/lib/sba/difficulty.ts
src/lib/sba/evaluateSba.ts
src/lib/benchmarks/industryBenchmarks.ts
src/lib/benchmarks/index.ts
src/lib/stressEngine/
src/lib/sbaPreflight/
```

These are not modified by Phase 58A, but you must read them to understand the existing SBA infrastructure before adding to it.

---

## Critical bug from Phase 57 — carry forward

The column is `deals.deal_type` NOT `deals.loan_type`.
The value is `'SBA'` NOT `'sba_7a'`.

All SBA type checks must use:
```typescript
const SBA_TYPES = ['SBA', 'sba_7a', 'sba_504', 'sba_express'];
```

The spec uses `loan_type` in examples — everywhere you see `deal.loan_type`, use `deal.deal_type` instead.

---

## What Phase 58A builds (three capabilities, zero ML)

1. **`src/lib/sba/newBusinessProtocol.ts`** — pure functions, detects businesses < 2 years old, sets DSCR threshold to 1.25x projected (not 1.10x historical) per SBA SOP 50 10 8

2. **NAICS Default Benchmarking** — extends existing `buddy_industry_benchmarks` table with SBA historical default rate columns, seeds 25 NAICS codes

3. **`src/lib/sba/sbaRiskProfile.ts`** — weighted composite score: industry (40%), business age (35%), loan term (15%), urban/rural (10%)

---

## Files to CREATE

```
src/lib/sba/newBusinessProtocol.ts
src/lib/sba/sbaRiskProfile.ts
src/evals/seeds/sbaBenchmarkSeed.ts
src/app/api/deals/[dealId]/sba/risk-profile/route.ts
src/components/sba/SBARiskProfilePanel.tsx
```

## Files to ADD TO (do not replace)

```
src/lib/benchmarks/industryBenchmarks.ts   ← add getSBAIndustryDefaultProfile() only
```

## Files NOT to modify

```
src/lib/sba/eligibilityEngine.ts   ← DO NOT TOUCH
src/lib/sba/sopRules.ts            ← DO NOT TOUCH
src/lib/sba/committeeGodMode.ts    ← DO NOT TOUCH
src/lib/sba/difficulty.ts          ← DO NOT TOUCH
src/lib/sba/evaluateSba.ts         ← DO NOT TOUCH
src/lib/sba/sop.ts                 ← DO NOT TOUCH
```

## Migrations

```
supabase/migrations/20260330_sba_benchmark_columns.sql
supabase/migrations/20260330_sba_risk_profiles.sql
```

Run `supabase db push` after creating both files.

---

## Start here

```bash
# 1. Read the full spec
cat PHASE_58A_SPEC.md

# 2. Before writing the migration, verify existing columns:
# SELECT column_name FROM information_schema.columns
# WHERE table_name = 'buddy_industry_benchmarks';

# 3. Build order: migrations → types → pure functions → server functions → routes → UI
```
