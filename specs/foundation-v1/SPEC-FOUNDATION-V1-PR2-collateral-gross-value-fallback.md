# SPEC-FOUNDATION-V1 PR2 — Collateral `gross_value` Fallback

**Status:** Ready for Claude Code
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** opens against `feat/foundation-v1-pr2-collateral-gross-value-fallback`
**Depends on:** SPEC-FOUNDATION-V1 parent committed
**Blocks:** Closes the `collateral_value` blocker for any deal with banker-entered collateral

## Problem in one paragraph

`evaluateMemoReadinessContract` checks `collateral_value` via `memo.collateral.gross_value.value > 0`. The canonical memo's `collateral.gross_value` is populated by `computeCollateralValues` in `src/lib/creditMemo/canonical/factsAdapter.ts`, which reads the `COLLATERAL/GROSS_VALUE` fact directly from `deal_financial_facts`, with a fallback to `COLLATERAL/AS_IS_VALUE`. **Neither fact is ever written when a banker enters collateral via the UI.** The banker's data goes to `deal_collateral_items` (`estimated_value` column) but never propagates to the financial_facts table. For Samaritus: 2 items totaling $1.1M in `deal_collateral_items`, zero collateral facts. The `collateral_value` blocker fails despite collateral being clearly entered.

## Solution in one paragraph

Modify `computeCollateralValues` to add a third fallback tier: when neither `GROSS_VALUE` nor `AS_IS_VALUE` facts exist, sum `deal_collateral_items.estimated_value` for the deal (filtered by `bank_id`) and use that as the gross_value with a synthetic provenance source `Canonical:DEAL_COLLATERAL_ITEMS`. This preserves the existing behavior when facts ARE present (facts win, since they're the more authoritative source per the documents-as-source-of-truth principle) and falls back to the canonical store data when not. Add a CI guard: any deal with `deal_collateral_items` rows containing non-null `estimated_value` MUST produce a non-null `memo.collateral.gross_value` from the canonical memo build pipeline.

## PIV — pre-implementation verification

### PIV-1. Confirm `computeCollateralValues` reads only from facts, not from canonical store

```bash
grep -n "deal_collateral_items\|estimated_value\|collateral_items" \
  src/lib/creditMemo/canonical/factsAdapter.ts
```

**Expected:** zero hits. Confirms the function reads only from `deal_financial_facts` via `getLatestFactNum`.

### PIV-2. Confirm Samaritus has the orphan pattern

```sql
WITH samaritus AS (SELECT '0279ed32-c25c-4919-b231-5790050331dd'::uuid AS deal_id)
SELECT
  (SELECT COUNT(*) FROM deal_collateral_items WHERE deal_id = (SELECT deal_id FROM samaritus)) AS items_count,
  (SELECT SUM(estimated_value) FROM deal_collateral_items WHERE deal_id = (SELECT deal_id FROM samaritus)) AS sum_estimated_value,
  (SELECT COUNT(*) FROM deal_financial_facts 
   WHERE deal_id = (SELECT deal_id FROM samaritus) 
     AND fact_type = 'COLLATERAL') AS collateral_facts_count;
```

**Expected:** `items_count > 0`, `sum_estimated_value > 0`, `collateral_facts_count = 0`. Confirms the data is in the canonical store but no facts were materialized.

### PIV-3. Confirm no existing materializer writes COLLATERAL facts from `deal_collateral_items`

```bash
grep -rn "fact_type.*COLLATERAL\|GROSS_VALUE\|AS_IS_VALUE" \
  src/lib/financialFacts/ src/lib/creditMemo/inputs/upsertCollateralItem.ts
```

**Expected:** confirms `upsertCollateralItem.ts` writes to `deal_collateral_items` but does NOT emit COLLATERAL facts. PR2's design choice: read-time fallback in `computeCollateralValues` rather than write-time fact emission. Reasoning: keeps `deal_collateral_items` as the canonical source for banker-entered collateral; avoids dual-write race conditions; treats facts as derived computed-from-source values.

### PIV-4. Confirm the readiness contract requires non-null gross_value

```bash
grep -A 5 "collateralOk\|collateral_value\|gross_value" \
  src/lib/creditMemo/submission/evaluateMemoReadinessContract.ts
```

**Expected:** confirms `memo.collateral.gross_value.value !== null && > 0` is required.

### PIV-5. Confirm bank_id scoping discipline in `loadCollateralItems`

```bash
grep -A 10 "loadCollateralItems" src/lib/creditMemo/inputs/buildMemoInputPackage.ts
```

**Expected:** the loader filters by `bank_id` (multi-tenant isolation rule). PR2's fallback must do the same.

## Scope

### In scope (PR2)

#### A-1. Add fallback to `deal_collateral_items.estimated_value`

In `src/lib/creditMemo/canonical/factsAdapter.ts`, modify `computeCollateralValues` to add a third tier of fallback for `grossValue`:

```ts
// Existing fallback tiers preserved:
//   1. GROSS_VALUE fact (most authoritative)
//   2. AS_IS_VALUE fact (legacy fallback)
//
// NEW tier 3: sum deal_collateral_items.estimated_value when no facts exist
if (gross === null && asIs === null) {
  const sb = supabaseAdmin();
  const res = await (sb as any)
    .from("deal_collateral_items")
    .select("estimated_value, market_value, bank_id, deal_id")
    .eq("deal_id", args.dealId);
  
  const rows = ((res.data ?? []) as any[]).filter(
    (r) => r.bank_id === null || r.bank_id === args.bankId
  );
  
  // Prefer market_value if present, else estimated_value
  let sum: number | null = null;
  for (const r of rows) {
    const v = numOrNull(r.market_value) ?? numOrNull(r.estimated_value);
    if (v !== null) sum = (sum ?? 0) + v;
  }
  
  if (sum !== null && sum > 0) {
    grossMetric = {
      value: sum,
      source: "Canonical:DEAL_COLLATERAL_ITEMS:SUM",
      updated_at: new Date().toISOString(),
    };
  }
}
```

The provenance label `Canonical:DEAL_COLLATERAL_ITEMS:SUM` is distinct from the fact-based labels so memo readers can identify the source.

#### A-2. Same fallback for net_value and discounted_value

Same logic as A-1 but for `netValue` (sum `net_lendable_value`) and `discountedValue` (sum `(estimated_value × advance_rate)` when both columns present).

For Samaritus specifically: `net_lendable_value` is `null` for Charter bus fleet item but `600000` for the yacht. The fallback should sum the available values (yields `600000` for net_value).

#### A-3. CI guard test

Create `src/lib/creditMemo/canonical/__tests__/collateralFallback.test.ts`:

- Synthetic test: deal with `deal_collateral_items` rows but zero collateral facts → `computeCollateralValues` returns non-null gross_value sum.
- Synthetic test: deal with both items AND a GROSS_VALUE fact → fact wins.
- Synthetic test: deal with no items and no facts → returns null (preserves existing behavior).
- Bank_id scoping: items belonging to a different bank are excluded from sum.

#### A-4. Submission-pipeline-level invariant guard

Create `src/lib/creditMemo/__tests__/collateralPropagationGuard.test.ts`:

Source-level CI guard reading `factsAdapter.ts`:

- Asserts source contains `deal_collateral_items` (proving the fallback is wired)
- Asserts source contains `Canonical:DEAL_COLLATERAL_ITEMS` (proving the provenance label)
- Asserts source contains `bank_id` filtering after the fallback (proving multi-tenant isolation preserved)

### Out of scope (explicit)

- Writing COLLATERAL facts from `upsertCollateralItem.ts` write path. The canonical memo is rebuilt on every read; cached facts would risk staleness. Read-time fallback is structurally cleaner.
- Changing the readiness contract — the `> 0` check is correct.
- Lien position / valuation_method handling — these are display fields, don't affect the submission gate.
- Discounted coverage ratio (loan_amount / collateral) — that's a memo display calculation, not a submission gate.

## V-N verification checklist

- V-1. ☐ All 5 PIV outputs pasted into AAR.
- V-2. ☐ A-1: `computeCollateralValues` returns non-null gross_value for Samaritus (sum of $350K + $750K = $1.1M).
- V-3. ☐ A-2: `computeCollateralValues` returns non-null net_value ($600K from yacht) for Samaritus.
- V-4. ☐ A-3: Synthetic tests passing.
- V-5. ☐ A-4: CI guard passing.
- V-6. ☐ tsc clean.
- V-7. ☐ pnpm test:unit shows expected new test count, all green.
- V-8. ☐ Re-evaluate `evaluateMemoReadinessContract` against Samaritus's current data: `collateral_value` blocker now `false` (gate clears).

## Files affected

| Path | Change | Risk |
|------|--------|------|
| `src/lib/creditMemo/canonical/factsAdapter.ts` | Add 3rd-tier fallback to `computeCollateralValues` | Med — touches memo build path |
| `src/lib/creditMemo/canonical/__tests__/collateralFallback.test.ts` | New | Low |
| `src/lib/creditMemo/__tests__/collateralPropagationGuard.test.ts` | New | Low |

No migrations. No new tables.

## Risk register

1. **Performance: extra Supabase query in canonical memo build.** Only triggers when no facts exist (i.e., the orphan case). Once cash flow aggregator (PR4) starts writing facts, this query path becomes rare.
2. **Bank_id scoping bypass.** Mitigated by explicit filter; CI guard verifies presence of bank_id check.
3. **Sum produces unexpected value due to mixed currency or unit issues.** All Samaritus collateral is in USD; `estimated_value` column is numeric without unit metadata. Acceptable for current scope. If multi-currency support is added later, this fallback needs revision.
4. **Race with concurrent BankerReviewPanel collateral edit.** The fallback reads the current state at memo build time; if the banker is mid-edit, they'll see consistent state at next page render. Acceptable.

## Hand-off commit message

```
feat(foundation): collateral gross_value fallback to canonical store (SPEC-FOUNDATION-V1 PR2)

The submit-time readiness contract checks collateral.gross_value > 0
via the canonical memo, which sources from COLLATERAL/GROSS_VALUE
fact. But there's no code path from deal_collateral_items
(banker-entered, the canonical store) to the fact. Bankers enter
collateral, the canonical memo never sees it, and the collateral_value
blocker fails.

This PR teaches computeCollateralValues to fall back to summing
deal_collateral_items.estimated_value when no fact exists. Facts
remain the most authoritative source when present; the fallback
only triggers for the orphan case.

After merge, Samaritus's collateral_value gate clears with
gross_value = $1.1M (sum of charter bus fleet + yacht).
```
