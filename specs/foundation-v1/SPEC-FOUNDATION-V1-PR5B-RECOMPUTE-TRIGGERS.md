# SPEC-FOUNDATION-V1-PR5B — Canonical Recompute Triggers

**Path:** `specs/foundation-v1/SPEC-FOUNDATION-V1-PR5B-RECOMPUTE-TRIGGERS.md`
**Status:** Ready for Claude Code (multi-day scope — 2 to 3 days)
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** opens against `feat/foundation-v1-pr5b-recompute-triggers`
**Depends on:** PR5a merged
**Sequence position:** 2 of 4

---

## Problem in one paragraph

After PR5a, the canonical chain produces correct DSCR when it runs. But it only runs when `spreadsProcessor` is triggered, and `spreadsProcessor` is only triggered when something explicitly calls `enqueueSpreadRecompute`. The diagnostic finding showed Samaritus's GLOBAL_CASH_FLOW spread last rendered on 2026-04-03 and was never re-triggered for 35 days even as the underlying facts changed (the PRECHECK wrote new facts on 2026-05-08). Today the trigger surface is implicit: spread jobs get enqueued at deal creation, at document upload, and at banker-initiated re-extract. Fact writes that happen *between* spread renders don't trigger a recompute. This means the canonical chain self-heals only when something happens to enqueue a job — not when its underlying state changes.

## Solution in one paragraph

Add explicit canonical recompute triggers at three defined lifecycle events: (1) extraction batch complete (after a batch of `extractFactsFromDocument` calls finishes for a deal), (2) `deal_structural_pricing` row update (banker changes loan terms), (3) banker-initiated refresh (existing pattern, formalize as a named trigger). Each trigger calls `enqueueSpreadRecompute` with `GLOBAL_CASH_FLOW` (and other downstream-dependent spread types). Triggers are debounced — multiple fact writes within 5 seconds coalesce into one enqueue call. All triggers emit canonical ledger events for traceability.

## PIV — pre-implementation verification

### PIV-1. Confirm `enqueueSpreadRecompute` interface and behavior

```bash
grep -n 'export async function enqueueSpreadRecompute' src/lib/financialSpreads/enqueueSpreadRecompute.ts
```

Re-read the function signature and confirm: idempotent, race-safe, returns structured result, has `skipPrereqCheck` mode.

### PIV-2. Identify all current call sites of `enqueueSpreadRecompute`

```bash
grep -rn 'enqueueSpreadRecompute' src/ --include='*.ts' --include='*.tsx'
```

### PIV-3. Identify the extraction batch boundary

```bash
grep -rn 'extractFactsFromDocument' src/lib/jobs/processors/ src/lib/jobs/
```

### PIV-4. Identify the deal_structural_pricing update path

```bash
grep -rn 'deal_structural_pricing' src/app/api/ src/lib/structuralPricing/
```

### PIV-5. Confirm Samaritus state is post-PR5a baseline

```sql
SELECT fact_key, fact_value_num, provenance->>'extractor' AS extractor, updated_at
FROM deal_financial_facts
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
  AND fact_key IN ('CASH_FLOW_AVAILABLE', 'ANNUAL_DEBT_SERVICE', 'DSCR')
  AND is_superseded = false
ORDER BY fact_key, updated_at DESC;
```

---

## Scope

### In scope (this PR)

1. **New module `src/lib/financialFacts/triggerCanonicalRecompute.ts`.** Wraps `enqueueSpreadRecompute` with debouncing (5s in-memory) and ledger emission. Trigger reasons: `extraction_batch_complete`, `structural_pricing_updated`, `banker_initiated_refresh`, `manual_diagnostic`.

2. **Trigger #1: extraction batch complete.** Wired in spreadsProcessor at the extraction batch boundary.

3. **Trigger #2: structural pricing update.** Wired in the API route(s) that update `deal_structural_pricing`.

4. **Trigger #3: banker-initiated refresh.** Existing `enqueueSpreadRecompute` callers from banker-initiated paths wrapped through `triggerCanonicalRecompute`.

5. **Unit tests** for debounce, ledger emission, non-fatal error handling.

6. **Integration test** for extraction batch trigger.

### Out of scope

- Aggregator bridge re-evaluation (PR5c)
- Observability dashboard (PR5d)
- Auto-trigger on every fact write (explicitly avoided — render storm risk)
- Distributed debounce (in-memory sufficient for single-worker)

---

## V-N verification checklist

V-1 through V-12 per spec body (debounce tests, trigger wiring, manual self-heal verification).

---

## Hand-off commit message

```
feat(financialFacts): canonical recompute triggers (SPEC-FOUNDATION-V1 PR5b)

Adds explicit canonical recompute triggers at three lifecycle events:
extraction batch complete, structural pricing update, banker-initiated
refresh. Each calls triggerCanonicalRecompute with debouncing (5s) and
canonical ledger emission.

This is PR5b of 4.

Spec: specs/foundation-v1/SPEC-FOUNDATION-V1-PR5B-RECOMPUTE-TRIGGERS.md
Governs under: SPEC-BANKER-HOLY-SHIT-V1 Workstream B
```
