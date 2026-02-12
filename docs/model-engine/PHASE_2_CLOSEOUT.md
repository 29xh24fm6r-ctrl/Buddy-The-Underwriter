# Model Engine V2 — Phase 2 Closeout

## Objective

Phase 2 adds **parity validation** tooling to the Model Engine V2 pipeline. It provides:
- Read-only comparison between V1 spread output and V2 model engine output
- Deterministic hashing for audit trails
- Period integrity guards
- Metric graph diagnostics

## Non-Negotiables

- No changes to: `financialSpreads/**`, spread renderers, extraction, lifecycle engine, pricing gates, UI
- `USE_MODEL_ENGINE_V2` remains **false** in production
- All code changes limited to `src/lib/modelEngine/**`, `src/app/api/deals/[dealId]/model-v2/**`, tests, and docs
- Parity endpoint is debug-only, read-only — no DB writes

## Canonical Parity Metrics (10)

| # | Key | Category | Description |
|---|-----|----------|-------------|
| 1 | `revenue` | Income Statement | Total revenue / gross rental income |
| 2 | `cogs` | Income Statement | Cost of goods sold |
| 3 | `operatingExpenses` | Income Statement | Total operating expenses |
| 4 | `ebitda` | Income Statement | EBITDA (or NOI for RE) |
| 5 | `netIncome` | Income Statement | Net income |
| 6 | `cash` | Balance Sheet | Cash and equivalents |
| 7 | `totalAssets` | Balance Sheet | Total assets |
| 8 | `totalLiabilities` | Balance Sheet | Total liabilities |
| 9 | `equity` | Balance Sheet | Total equity |
| 10 | `leverageDebtToEbitda` | Derived | Total debt / EBITDA |

## Materiality Thresholds

A difference is **material** if:
- `abs(delta) > 1` (more than $1 absolute)
- **OR** `abs(delta) / max(1, abs(spread)) > 0.0001` (more than 0.01% relative)

## How to Run

### Unit Tests (all model engine tests)

```bash
# All Phase 1 + Phase 2 tests
node --import tsx --test src/lib/modelEngine/__tests__/*.test.ts

# Individual test suites
node --import tsx --test src/lib/modelEngine/__tests__/hashStability.test.ts
node --import tsx --test src/lib/modelEngine/__tests__/metricGraph.test.ts
node --import tsx --test src/lib/modelEngine/__tests__/parity.test.ts
node --import tsx --test src/lib/modelEngine/__tests__/parityDeals.test.ts
node --import tsx --test src/lib/modelEngine/__tests__/buildFinancialModel.test.ts
node --import tsx --test src/lib/modelEngine/__tests__/hashing.test.ts
```

### Hash Stability Tests

```bash
node --import tsx --test src/lib/modelEngine/__tests__/hashStability.test.ts
```

Covers: build-hash-rebuild-rehash invariance, shuffled facts, Date stability, object identity reuse, strip list completeness.

### Parity Endpoint (requires USE_MODEL_ENGINE_V2=true)

```bash
# JSON format
curl -H "Authorization: Bearer <token>" \
  "https://<host>/api/deals/<dealId>/model-v2/parity"

# Markdown format
curl -H "Authorization: Bearer <token>" \
  "https://<host>/api/deals/<dealId>/model-v2/parity?format=markdown"

# Filter to single period
curl -H "Authorization: Bearer <token>" \
  "https://<host>/api/deals/<dealId>/model-v2/parity?period=2024-12-31"

# Include raw metric maps (super_admin only)
curl -H "Authorization: Bearer <token>" \
  "https://<host>/api/deals/<dealId>/model-v2/parity?includeRaw=true"
```

### Env-Gated Live Deal Harness

```bash
ENABLE_PARITY_DEALS_TEST=true \
PARITY_DEAL_IDS=<deal1>,<deal2>,<deal3>,<deal4> \
node --import tsx --test src/lib/modelEngine/__tests__/parityDeals.test.ts
```

## Evidence Template (attach to PR #123)

```markdown
## Phase 2 Closeout Evidence

- [ ] Scope: No changes to spreads/extraction/lifecycle/pricing/UI
- [ ] USE_MODEL_ENGINE_V2 remains false in production
- [ ] `npx tsc --noEmit` PASS
- [ ] `node --import tsx --test src/lib/modelEngine/__tests__/*.test.ts` ALL PASS

### Parity Results (4 archetype deals)
> Output generated via: `/api/deals/:dealId/model-v2/parity?format=markdown`

1) CRE Deal: `<dealId>`
   - materiallyDifferent: false/true
   - totalDifferences: N

2) Operating Company Deal: `<dealId>`
   - materiallyDifferent: false/true
   - totalDifferences: N

3) Multi-Period Deal: `<dealId>`
   - materiallyDifferent: false/true
   - totalDifferences: N

4) TTM Deal: `<dealId>`
   - materiallyDifferent: false/true
   - totalDifferences: N

### Missing Metrics Observed
- [ ] None for core set (expected)
- [ ] If any: list metric + deal + reason

### Determinism Guarantees
- [ ] Period integrity guards active
- [ ] Metric graph diagnostics tested
- [ ] Hash stability (serialize-hash invariant) tested
- [ ] Canonical metric dictionary frozen (10 metrics, no duplicates)

### Forbidden Path Check
git diff --name-only origin/main...HEAD | grep -E 'financialSpreads/|/spreads/|/extract/|/lifecycle/|/pricing/' | head -20
# Expected: empty output
```

## Deliverable Summary

| # | Deliverable | File(s) |
|---|-------------|---------|
| A | ParityReport + Diff + materiality | `parity/parityCompare.ts` |
| B | Endpoint: ?includeRaw, ?period, ?format | `model-v2/parity/route.ts` |
| C | Period integrity guards | `buildFinancialModel.ts` |
| D | Metric graph diagnostics | `metricGraph.ts` |
| E | Hash stability + canonicalSerialize | `hash/canonicalSerialize.ts` |
| F | Parity targets mapping (PeriodMetricMap) | `parity/parityTargets.ts` |
| G | Controlled deal test harness | `__tests__/parityDeals.test.ts` |
| H | Snapshot dry run env-guarded | Verified in `model-v2/preview/route.ts` |
