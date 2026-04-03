# Phase 70 — Extraction Fact Key Coverage
## Schedule L Balance Sheet, K-1 Basics, and Reconciliator Key Fix

**Date:** April 2026
**Status:** Spec — ready for implementation

---

## Pre-work verification (run before any code, log all results in AAR)

```sql
-- 1. What fact keys exist for ffcc9733?
SELECT DISTINCT fact_key, fact_type, COUNT(*) as periods
FROM deal_financial_facts
WHERE deal_id = 'ffcc9733-f866-47fc-83f9-7c08403cea71'
AND fact_type != 'EXTRACTION_HEARTBEAT'
GROUP BY fact_key, fact_type
ORDER BY fact_type, fact_key;

-- 2. Do TOTAL_ASSETS, TOTAL_LIABILITIES, NET_WORTH, TOTAL_EQUITY, 
--    K1_ORDINARY_INCOME, K1_OWNERSHIP_PCT exist?
SELECT fact_key, fact_value_num, fact_period_end
FROM deal_financial_facts
WHERE deal_id = 'ffcc9733-f866-47fc-83f9-7c08403cea71'
AND fact_key IN (
  'TOTAL_ASSETS', 'TOTAL_LIABILITIES', 'NET_WORTH', 'TOTAL_EQUITY',
  'K1_ORDINARY_INCOME', 'K1_OWNERSHIP_PCT', 'ORDINARY_BUSINESS_INCOME'
)
ORDER BY fact_key, fact_period_end;

-- 3. Does a BALANCE_SHEET spread exist?
SELECT spread_type, spread_version, updated_at
FROM deal_spreads
WHERE deal_id = 'ffcc9733-f866-47fc-83f9-7c08403cea71'
AND spread_type = 'BALANCE_SHEET';
```

Also check Pulse event coverage:
```sql
SELECT DISTINCT event_key, COUNT(*) as count
FROM deal_pipeline_ledger
WHERE deal_id = 'ffcc9733-f866-47fc-83f9-7c08403cea71'
GROUP BY event_key
ORDER BY event_key;
```

Log all results. They determine scope for Steps 2 and 3.

---

## Context

Three gaps found by code inspection:

1. **Reconciliator uses `TOTAL_EQUITY` — canonical system writes `NET_WORTH`.**
   `dealReconciliator.ts` line: `const totalEquity = allFacts["TOTAL_EQUITY"] ?? null;`
   But `backfillFromSpreads.ts` writes `fact_key: "NET_WORTH"` (from `CANONICAL_FACTS.NET_WORTH`).
   These never match. One-line fix.

2. **Schedule L (balance sheet) facts from 1065 never reach `deal_financial_facts`.**
   `backfillFromSpreads.ts` reads `BALANCE_SHEET` spread type — but 1065 entities like Samaritus
   don't produce a `BALANCE_SHEET` spread. Schedule L data is on the 1065 itself, Gemini
   extracts `total_assets`/`total_liabilities`/`total_equity` from it, but nothing writes
   those values to `deal_financial_facts` with canonical uppercase keys.

3. **K-1 income facts (`K1_ORDINARY_INCOME`, `K1_OWNERSHIP_PCT`) are never written.**
   For pass-through entities (1065, 1120S), the partner's/shareholder's allocated income
   is never written to the fact store. For a single-owner entity, a reasonable first-pass
   approximation is: K1_ORDINARY_INCOME = ORDINARY_BUSINESS_INCOME, K1_OWNERSHIP_PCT = 100.
   This is explicitly an approximation until full Schedule K-1 parsing ships.

**Model Engine V2 note:** `modeSelector.ts` already hard-enforces `v2_primary` for all
non-ops contexts. The roadmap item is stale. Nothing to build there.

---

## What NOT to touch

```
src/lib/reconciliation/k1ToEntityCheck.ts         ← do not modify
src/lib/reconciliation/balanceSheetCheck.ts        ← do not modify
src/lib/reconciliation/multiYearTrendCheck.ts      ← do not modify
src/lib/reconciliation/ownershipIntegrityCheck.ts  ← do not modify
src/lib/extraction/geminiFlashPrompts.ts           ← do not modify
src/lib/extraction/geminiFlashStructuredAssist.ts  ← do not modify
src/lib/financialFacts/backfillFromSpreads.ts      ← do not modify
src/lib/modelEngine/modeSelector.ts               ← do not modify
```

---

## Step 1 — Fix reconciliator key mismatch (1-line change)

**File:** `src/lib/reconciliation/dealReconciliator.ts`

Find this block (around line 80):
```typescript
const totalAssets = allFacts["TOTAL_ASSETS"] ?? null;
const totalLiabilities = allFacts["TOTAL_LIABILITIES"] ?? null;
const totalEquity = allFacts["TOTAL_EQUITY"] ?? null;
```

Replace with:
```typescript
const totalAssets = allFacts["TOTAL_ASSETS"] ?? null;
const totalLiabilities = allFacts["TOTAL_LIABILITIES"] ?? null;
// NET_WORTH is the canonical key; TOTAL_EQUITY is an alias written by some extractors
const totalEquity = allFacts["NET_WORTH"] ?? allFacts["TOTAL_EQUITY"] ?? null;
```

No other changes to this file.

---

## Step 2 — Write Schedule L facts from BTR extraction

**New file:** `src/lib/financialFacts/writeScheduleLFacts.ts`

This function takes the Gemini structured assist output for a business tax return
and writes Schedule L balance sheet facts directly to `deal_financial_facts`.
It runs after extraction for `BUSINESS_TAX_RETURN` / `IRS_1065` / `IRS_1120S` docs.

```typescript
import "server-only";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

type EntityRow = {
  type: string;
  normalizedValue?: {
    moneyValue?: { units: number; nanos: number };
  };
  confidence: number;
};

type ScheduleLInput = {
  dealId: string;
  bankId: string;
  documentId: string;
  taxYear: number | null;
  entities: EntityRow[];
};

// Map from Gemini entity type names to canonical fact keys
const SCHEDULE_L_ENTITY_MAP: Record<string, string> = {
  total_assets: "TOTAL_ASSETS",
  total_liabilities: "TOTAL_LIABILITIES",
  total_equity: "NET_WORTH",        // canonical key is NET_WORTH
  partners_capital: "NET_WORTH",    // partnership equivalent of equity
  retained_earnings_schedule_l: "RETAINED_EARNINGS_SCH_L",
  cash_schedule_l: "CASH_SCH_L",
  accounts_receivable_schedule_l: "AR_SCH_L",
  inventory_schedule_l: "INVENTORY_SCH_L",
};

function extractMoney(e: EntityRow): number | null {
  const units = e.normalizedValue?.moneyValue?.units;
  if (typeof units === "number" && Number.isFinite(units)) return units;
  return null;
}

function buildPeriodEnd(taxYear: number | null): string | null {
  if (!taxYear) return null;
  return `${taxYear}-12-31`;
}

/**
 * Write Schedule L (balance sheet) facts from BTR Gemini extraction output.
 *
 * Writes TOTAL_ASSETS, TOTAL_LIABILITIES, NET_WORTH (and supporting line items)
 * directly to deal_financial_facts as DOC_EXTRACT facts.
 *
 * Called after BTR extraction for IRS_1065, IRS_1120S, IRS_1120.
 * Never throws. Returns count of facts written.
 */
export async function writeScheduleLFacts(input: ScheduleLInput): Promise<{ factsWritten: number }> {
  let factsWritten = 0;
  const periodEnd = buildPeriodEnd(input.taxYear);
  const periodStart = input.taxYear ? `${input.taxYear}-01-01` : null;
  const sourceRef = `deal_documents:${input.documentId}`;

  const writes: Promise<any>[] = [];

  for (const entity of input.entities) {
    const canonicalKey = SCHEDULE_L_ENTITY_MAP[entity.type.toLowerCase()];
    if (!canonicalKey) continue;

    const value = extractMoney(entity);
    if (value === null) continue;

    writes.push(
      upsertDealFinancialFact({
        dealId: input.dealId,
        bankId: input.bankId,
        sourceDocumentId: input.documentId,
        factType: "BALANCE_SHEET",
        factKey: canonicalKey,
        factValueNum: value,
        confidence: entity.confidence,
        factPeriodStart: periodStart,
        factPeriodEnd: periodEnd,
        provenance: {
          source_type: "DOC_EXTRACT",
          source_ref: sourceRef,
          as_of_date: periodEnd,
          extractor: "writeScheduleLFacts:v1",
          confidence: entity.confidence,
        },
      }),
    );
  }

  if (writes.length > 0) {
    const results = await Promise.allSettled(writes);
    factsWritten = results.filter(
      (r) => r.status === "fulfilled" && (r.value as any)?.ok,
    ).length;
  }

  return { factsWritten };
}
```

---

## Step 3 — Write K-1 basics for pass-through entities

**New file:** `src/lib/financialFacts/writeK1BaseFacts.ts`

For 1065 and 1120S entities, when we have OBI and a single owner, write K-1
facts as a first-pass approximation. This is explicitly labeled as an
approximation — full Schedule K-1 parsing is a future Moody's MMAS item.

```typescript
import "server-only";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

type K1BaseInput = {
  dealId: string;
  bankId: string;
  documentId: string;
  taxYear: number | null;
  /** Ordinary business income from the entity return (1065 or 1120S OBI) */
  ordinaryBusinessIncome: number | null;
  /** Known ownership percentage (0–100). Defaults to 100 for single-owner. */
  ownershipPct?: number;
  /** Number of owners/partners — if > 1, skip K-1 approximation */
  ownerCount?: number;
};

/**
 * Write K-1 approximation facts for single-owner pass-through entities.
 *
 * For entities with a single owner and known OBI, writes:
 * - K1_ORDINARY_INCOME = OBI (100% allocation)
 * - K1_OWNERSHIP_PCT = 100 (or known pct)
 *
 * IMPORTANT: This is an approximation pending full Schedule K-1 parsing.
 * source_ref includes "k1_approx" to distinguish from real K-1 data.
 * The reconciliator uses this to run K1_TO_ENTITY checks.
 *
 * Skipped when ownerCount > 1 — multi-owner K-1 allocation requires
 * real Schedule K-1 parsing, not a passthrough approximation.
 *
 * Never throws. Returns count of facts written.
 */
export async function writeK1BaseFacts(input: K1BaseInput): Promise<{ factsWritten: number; skipped: boolean }> {
  // Skip for multi-owner entities — approximation is not valid
  if (input.ownerCount && input.ownerCount > 1) {
    return { factsWritten: 0, skipped: true };
  }

  if (input.ordinaryBusinessIncome === null) {
    return { factsWritten: 0, skipped: true };
  }

  const periodEnd = input.taxYear ? `${input.taxYear}-12-31` : null;
  const periodStart = input.taxYear ? `${input.taxYear}-01-01` : null;
  const ownershipPct = input.ownershipPct ?? 100;
  const sourceRef = `deal_documents:${input.documentId}:k1_approx`;

  const provenance = {
    source_type: "DOC_EXTRACT" as const,
    source_ref: sourceRef,
    as_of_date: periodEnd,
    extractor: "writeK1BaseFacts:v1",
    confidence: 0.7, // lower confidence — this is an approximation
  };

  const results = await Promise.allSettled([
    upsertDealFinancialFact({
      dealId: input.dealId,
      bankId: input.bankId,
      sourceDocumentId: input.documentId,
      factType: "TAX_RETURN",
      factKey: "K1_ORDINARY_INCOME",
      factValueNum: input.ordinaryBusinessIncome,
      confidence: 0.7,
      factPeriodStart: periodStart,
      factPeriodEnd: periodEnd,
      provenance,
    }),
    upsertDealFinancialFact({
      dealId: input.dealId,
      bankId: input.bankId,
      sourceDocumentId: input.documentId,
      factType: "TAX_RETURN",
      factKey: "K1_OWNERSHIP_PCT",
      factValueNum: ownershipPct,
      confidence: 0.7,
      factPeriodStart: periodStart,
      factPeriodEnd: periodEnd,
      provenance,
    }),
  ]);

  const factsWritten = results.filter(
    (r) => r.status === "fulfilled" && (r.value as any)?.ok,
  ).length;

  return { factsWritten, skipped: false };
}
```

---

## Step 4 — Wire both new functions into BTR extraction

Find the function that processes a completed BTR (business tax return) extraction
and writes facts. Based on the codebase, this is in:
`src/lib/financialSpreads/extractFactsFromDocument.ts`

If that file doesn't exist, search for the caller of `upsertDealFinancialFact`
for `IRS_1065` or `IRS_1120S` doc types.

After the existing fact-writing logic for a BTR document, add:

```typescript
import { writeScheduleLFacts } from "@/lib/financialFacts/writeScheduleLFacts";
import { writeK1BaseFacts } from "@/lib/financialFacts/writeK1BaseFacts";

// After existing extraction completes for BUSINESS_TAX_RETURN / IRS_1065 / IRS_1120S:

// Write Schedule L balance sheet facts from Gemini entities
if (structuredAssistResult?.entities && isBusinessTaxReturn(canonicalDocType)) {
  await writeScheduleLFacts({
    dealId,
    bankId,
    documentId,
    taxYear,
    entities: structuredAssistResult.entities,
  }).catch((err) =>
    console.warn("[extractFacts] writeScheduleLFacts failed (non-fatal)", { documentId, err })
  );
}

// Write K-1 approximation facts for single-owner pass-through entities
if (isPassThroughEntity(canonicalDocType) && ordinaryBusinessIncome !== null) {
  await writeK1BaseFacts({
    dealId,
    bankId,
    documentId,
    taxYear,
    ordinaryBusinessIncome,
    ownerCount: 1, // Conservative default — single owner assumed if not parsed
  }).catch((err) =>
    console.warn("[extractFacts] writeK1BaseFacts failed (non-fatal)", { documentId, err })
  );
}
```

Helper type guards to add inline or at module level:
```typescript
const BTR_DOC_TYPES = new Set(["BUSINESS_TAX_RETURN", "IRS_1065", "IRS_1120S", "IRS_1120"]);
const PASS_THROUGH_TYPES = new Set(["IRS_1065", "IRS_1120S"]);

function isBusinessTaxReturn(docType: string): boolean {
  return BTR_DOC_TYPES.has(docType.toUpperCase());
}
function isPassThroughEntity(docType: string): boolean {
  return PASS_THROUGH_TYPES.has(docType.toUpperCase());
}
```

If the extraction call site doesn't have access to `structuredAssistResult` or
`ordinaryBusinessIncome` at the point of wiring, find the closest point where both
the Gemini output and the extracted OBI value are available, and wire there.
Document the exact insertion point in the AAR.

---

## Step 5 — Re-trigger reconciliation for ffcc9733

After all code changes are deployed, call reconciliation on the test deal
to verify the new facts flow:

```bash
# Trigger re-extraction on ffcc9733 to write new fact keys
curl -X POST /api/deals/ffcc9733-f866-47fc-83f9-7c08403cea71/re-extract

# Then re-run reconciliation
curl -X POST /api/deals/ffcc9733-f866-47fc-83f9-7c08403cea71/reconcile
```

Or via MCP/direct DB if HTTP auth is unavailable. Log the reconciliation
response — specifically whether `checksSkipped` decreases and `checksRun` increases.

---

## Pulse observability diagnostic (non-blocking)

Run this SQL and log in AAR. This is diagnostic only — no code changes required
unless the outbox is completely empty:

```sql
-- Check outbox backlog
SELECT kind, COUNT(*) as count, MIN(created_at) as oldest
FROM buddy_outbox_events
WHERE processed_at IS NULL
GROUP BY kind
ORDER BY count DESC
LIMIT 20;

-- Check what's reached Pulse
SELECT DISTINCT event_key, COUNT(*) as count
FROM deal_pipeline_ledger
GROUP BY event_key
ORDER BY count DESC
LIMIT 20;
```

If `buddy_outbox_events` has a large unprocessed backlog, note it — that's a
separate observability issue. No code changes in this phase for Pulse.

---

## Acceptance criteria

- [ ] Pre-work SQL run and results logged in AAR
- [ ] `dealReconciliator.ts` uses `NET_WORTH` fallback for `TOTAL_EQUITY`
- [ ] `writeScheduleLFacts.ts` created, maps Gemini entity types to canonical fact keys
- [ ] `writeK1BaseFacts.ts` created, skips multi-owner entities
- [ ] Both functions wired into BTR extraction pipeline (location documented in AAR)
- [ ] Both new functions are non-fatal (wrapped in `.catch()` at call site)
- [ ] Re-trigger reconciliation on ffcc9733 and log response
- [ ] Pulse diagnostic SQL results logged
- [ ] `tsc --noEmit` clean
- [ ] All existing tests pass
- [ ] New unit tests for `writeScheduleLFacts` entity mapping (at minimum: known key maps correctly, unknown key is skipped, null value is skipped)
- [ ] New unit tests for `writeK1BaseFacts` (at minimum: skips multi-owner, skips null OBI, writes correct keys for single-owner)

## AAR format

1. Pre-work SQL results (paste actual output)
2. Exact file and line number where Step 4 wiring was inserted
3. Files created, files modified
4. Re-trigger reconciliation response (paste JSON)
5. Pulse diagnostic SQL results
6. `tsc --noEmit` result + test pass count
7. Deviations from spec with rationale
