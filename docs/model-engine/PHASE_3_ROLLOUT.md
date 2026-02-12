# Phase 3: Renderer Migration — Rollout Plan

## Overview

Phase 3 introduces a renderer-neutral **SpreadViewModel** contract with adapters for both V1 (legacy `RenderedSpread`) and V2 (`FinancialModel`). A shadow-mode endpoint compares both adapters' output row-by-row without affecting production rendering.

**Feature flag**: `USE_MODEL_ENGINE_V2=true`
**Rollback**: Set `USE_MODEL_ENGINE_V2=false` — all Phase 3 code becomes unreachable.

---

## 4-Stage Rollout

### Stage 1: Staging Validation

**When**: Immediately after merge
**Environment**: Staging / Preview

1. Set `USE_MODEL_ENGINE_V2=true` in staging environment
2. Hit the render-diff endpoint for known test deals:
   ```
   GET /api/deals/{dealId}/model-v2/render-diff
   GET /api/deals/{dealId}/model-v2/render-diff?format=markdown
   ```
3. Review the diff output:
   - `summary.pass` should be `true` for deals with complete facts
   - Expected differences: rows where V2 model has fewer facts than V1 spread
   - Unexpected differences: same facts but different computed values (investigate)

**Exit criteria**: render-diff returns valid JSON for at least 3 test deals.

### Stage 2: Shadow Monitoring

**When**: After Stage 1 sign-off
**Environment**: Production (flag enabled)

1. Enable `USE_MODEL_ENGINE_V2=true` in production
2. Periodically run render-diff for active deals (manual or cron)
3. Monitor Aegis events:
   ```sql
   SELECT deal_id, payload->>'pass', payload->>'materialDiffs', created_at
   FROM buddy_system_events
   WHERE error_code = 'RENDER_DIFF_COMPUTED'
   ORDER BY created_at DESC
   LIMIT 50;
   ```
4. Track aggregate pass rate over 1 week

**Exit criteria**: >95% pass rate across all tested deals. All material diffs investigated and explained.

### Stage 3: Controlled Renderer Switch (Phase 3 Part 2)

**When**: After Stage 2 confidence threshold met
**Scope**: Future PR — not included in this PR

1. Wire `renderFromFinancialModel` into the Moody's spreads page behind an additional per-deal flag
2. A/B test: specific deals render from V2, rest from V1
3. Verify UI output is identical (pixel-level for numbers, section ordering)
4. Expand to all deals with complete financial data

**Exit criteria**: Zero user-reported visual regressions. Zero material diffs.

### Stage 4: Full Flip

**When**: After Stage 3 stable for 2 weeks
**Scope**: Future PR

1. Make V2 renderer the default path
2. V1 adapter becomes the rollback path
3. Remove shadow-mode overhead from hot paths
4. Eventually deprecate V1 adapter (after 1 release cycle)

---

## Monitoring Queries

### Recent render diffs
```sql
SELECT deal_id,
       payload->>'pass' as pass,
       payload->>'materialDiffs' as material_diffs,
       payload->>'totalCells' as total_cells,
       payload->>'differingCells' as differing_cells,
       created_at
FROM buddy_system_events
WHERE error_code = 'RENDER_DIFF_COMPUTED'
ORDER BY created_at DESC
LIMIT 20;
```

### Pass rate last 7 days
```sql
SELECT
  COUNT(*) FILTER (WHERE payload->>'pass' = 'true') as passes,
  COUNT(*) FILTER (WHERE payload->>'pass' = 'false') as failures,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE payload->>'pass' = 'true') / NULLIF(COUNT(*), 0), 1) as pass_rate
FROM buddy_system_events
WHERE error_code = 'RENDER_DIFF_COMPUTED'
  AND created_at > NOW() - INTERVAL '7 days';
```

---

## Files Introduced

| File | Purpose |
|------|---------|
| `src/lib/modelEngine/renderer/types.ts` | SpreadViewModel contract |
| `src/lib/modelEngine/renderer/formulaEval.ts` | Shared formula evaluation |
| `src/lib/modelEngine/renderer/v2Adapter.ts` | FinancialModel → ViewModel |
| `src/lib/modelEngine/renderer/v1Adapter.ts` | RenderedSpread → ViewModel |
| `src/lib/modelEngine/renderer/viewModelDiff.ts` | ViewModel diff utility |
| `src/lib/modelEngine/renderer/index.ts` | Barrel exports |
| `src/app/api/deals/[dealId]/model-v2/render-diff/route.ts` | Shadow endpoint |
| `src/lib/modelEngine/__tests__/rendererMigration.test.ts` | 15 unit tests |

## Non-negotiables

- No production rendering paths change in this PR
- No schema/migration changes
- No changes to extraction, lifecycle, or pricing
- Feature flag OFF = zero impact on production
