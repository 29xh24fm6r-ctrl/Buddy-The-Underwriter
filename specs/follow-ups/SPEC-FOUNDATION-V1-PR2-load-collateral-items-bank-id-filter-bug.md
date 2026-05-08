# SPEC-FOUNDATION-V1 PR2 follow-up — `loadCollateralItems` bank_id filter is a no-op

Surfaced during SPEC-FOUNDATION-V1 PR2 (PR #406, 2026-05-08) when Claude Code's PIV-5 verification discovered that `deal_collateral_items` has no `bank_id` column. The existing `loadCollateralItems` loader in `buildMemoInputPackage.ts` filters rows by `r.bank_id === null || r.bank_id === bankId` — but with the column absent, `r.bank_id` is `undefined` for every row, both equality checks return `false`, and **the filter discards every row in every call**. PR2's fallback in `factsAdapter.ts` is unaffected (it queries `deal_collateral_items` directly without the filter), but `MemoInputPackage.collateral_items` has been silently empty for every deal that flows through `buildMemoInputPackage`.

## Detected
SPEC-FOUNDATION-V1 PR2 PIV-5 (2026-05-08). PR description on PR #406 documents the schema finding. Confirmed independently by Claude in chat via `information_schema.columns` query against `public.deal_collateral_items` — column list is `id, deal_id, item_type, description, estimated_value, lien_position, appraisal_date, address, created_at, updated_at, valuation_method, valuation_source_note, advance_rate, net_lendable_value, collateral_type, market_value`. No `bank_id`.

## Expected
`loadCollateralItems` returns the canonical-store rows for the deal (filtered appropriately for tenant isolation), so consumers of `MemoInputPackage.collateral_items` see banker-entered collateral.

## Actual
`loadCollateralItems` returns an empty array for every deal because the post-query filter `.filter((r) => r.bank_id === null || r.bank_id === bankId)` evaluates against `r.bank_id === undefined`. `undefined === null` is `false` in strict equality and `undefined === bankId` is `false`. Every row is discarded. The function silently returns `[]` for Samaritus despite two real collateral items totaling $1.1M.

## Impact
Submission readiness contract is unaffected — `evaluateMemoReadinessContract` reads `memo.collateral.gross_value.value` from the canonical memo, which sources from `computeCollateralValues` (and after PR2's merge, has the working canonical-store fallback). PR2's V-8 will clear `collateral_value` correctly.

What IS affected: any consumer that reads `MemoInputPackage.collateral_items` directly. Likely surfaces include:
- Credit memo narrative generation (collateral section text)
- Banker review panel collateral display
- Research extractors that cross-reference collateral
- Any audit/snapshot path that includes collateral detail

These have all been reading empty arrays since the loader was written. The blast radius needs investigation.

## Resolution
Two-step fix:

1. **Immediate one-liner:** remove the `.filter((r) => r.bank_id === null || r.bank_id === bankId)` line entirely from `loadCollateralItems` in `src/lib/creditMemo/inputs/buildMemoInputPackage.ts`. The query already filters by `deal_id`; with no `bank_id` column on the table, no further tenant scoping is possible at the row level. Update the `DealCollateralItem` mapper to drop the `bank_id` field (or set it explicitly to `null`).

2. **Design question to resolve before fix:** see companion follow-up `SPEC-FOUNDATION-V1-PR2-deal-collateral-items-tenant-scoping-design.md`. The existence of the broken filter implies someone intended `bank_id` to exist on this table. Before silently removing the filter, confirm whether tenant scoping at the row level is required or whether `deal_id`-scoped is sufficient (because `deals` itself is bank-scoped via `deals.bank_id`).

If the design follow-up concludes `deal_id`-scoping is sufficient, remove the filter as described in step 1. If it concludes `bank_id` must exist on the row, file a schema migration to add the column with a backfill from `deals.bank_id`.

## Risk
Until fixed, every consumer of `MemoInputPackage.collateral_items` operates on empty data. This could mean credit memo narratives have been silently omitting collateral discussions, banker review panels have been showing "no collateral" despite entered items, etc. The bug has been latent because the readiness contract doesn't consume this field — but the field is non-trivially used elsewhere.

## Related
- SPEC-FOUNDATION-V1 PR2 (PR #406, 2026-05-08)
- `SPEC-FOUNDATION-V1-PR2-deal-collateral-items-tenant-scoping-design.md` (companion design question)
- File: `src/lib/creditMemo/inputs/buildMemoInputPackage.ts`, function `loadCollateralItems` lines ~210-240
