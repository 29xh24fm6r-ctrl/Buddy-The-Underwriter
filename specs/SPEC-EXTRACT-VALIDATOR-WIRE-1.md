# SPEC-EXTRACT-VALIDATOR-WIRE-1 — Wire post-extraction IRS identity validation correctly (rev 2)

**Status:** Draft (rev 2 — incorporates §0 finding that validator IS already called from `runRecord.ts:244`).
**Branch:** `feat/extract-validator-wire-1` off `main`
**Workstream:** Extraction quality (closes Gap 1 from `docs/FINANCIAL_EXPERTISE.md`)
**Estimate:** ~2 hours wiring + ~30 min backfill script + ~5 min OmniCare smoke

**Revision history:**
- **rev 1** claimed the validator was never called. INCORRECT. `finalizeExtractionRun` at `src/lib/extraction/runRecord.ts:241-253` already invokes `runPostExtractionValidation` via dynamic-import fire-and-forget after every successful run.
- **rev 2** drops §3 (would have double-fired on top of the existing per-run call). Folds the `validation_disabled` escape hatch and the tax-return filter INTO the validator itself. Updates `runRecord.ts:244` in the same commit as §2 to construct a `docRow` and pass it.

---

## PIV (Problem, Invariant, Verification)

### Problem

The four-gate extraction validation infrastructure documented in `docs/FINANCIAL_EXPERTISE.md` §12 has produced zero rows in `deal_document_validation_results` across 19 deals containing 126 tax returns. The validator is wired and being called — but every call short-circuits to `SKIPPED` without persisting a row.

**Actual root cause:**

`finalizeExtractionRun()` in `src/lib/extraction/runRecord.ts:241-253` invokes `runPostExtractionValidation` non-blocking after every successful extraction. It passes `args.metrics.canonicalType` (a string), which extraction sets to canonical doc types like `"BUSINESS_TAX_RETURN"`. The validator's `DOC_TYPE_TO_IRS_FORM` map has no entry for `"BUSINESS_TAX_RETURN"` (only for specific types like `TAX_RETURN_1120` that the classifier never produces). The validator returns early with status `SKIPPED` and `summary: "No IRS form mapping for type: BUSINESS_TAX_RETURN"` — **without persisting a row**. Empty `deal_document_validation_results` is the exact predicted output of that branch.

The mechanism for the empty table is correct. The wire-up exists. What's missing is:

1. A resolver that maps `BUSINESS_TAX_RETURN` + `ai_form_numbers: ['1120']` → `FORM_1120` (data is already in the database; the validator just doesn't read it)
2. SKIPPED outcomes persisting rows so the audit trail captures why the validator couldn't route a doc
3. A filter so non-tax documents (bank statements, PFS, AR aging) don't generate SKIPPED noise
4. A per-deal `validation_disabled` escape hatch

**Concrete evidence (OmniCare deal `80fe6f7a-5c68-4f02-8bcf-933f246a9fc5`):**

Three Form 1120 C-corporation returns for 2022, 2023, 2024. All classified at `tier1_anchor` with 0.97 confidence. Each row has `canonical_type = 'BUSINESS_TAX_RETURN'`, `ai_form_numbers = ['1120']`, `ai_tax_year` populated. Garbage extracted facts (`F1125A_DIRECT_LABOR: 6`, `WAGES_W2: 3`, `F4562_BONUS_DEPRECIATION: 11`, `F1125E_COMPENSATION: 100`) persisted as canonical because the validator early-returned SKIPPED on the missing map entry.

Form number and tax year are already in the database. The fix is wiring + persistence, not building.

### Invariant

| Surface | Behavior after fix |
|---|---|
| `runPostExtractionValidation` | Accepts a `docRow` (`{canonical_type, ai_form_numbers, document_type}`) instead of a bare canonical-type string. Self-gates on three conditions: (1) `deals.validation_disabled = true` → return SKIPPED with no row; (2) document is not a tax return → return SKIPPED with no row; (3) tax-return doc but resolver returns null → return SKIPPED **with a row written** (audit-relevant). |
| `resolveIrsFormType` (new) | Reads `ai_form_numbers` first (priority 1), `canonical_type` second (priority 2). Returns the correct `IrsFormType` for `BUSINESS_TAX_RETURN` + `ai_form_numbers=['1120']` documents. |
| `runRecord.ts:241-253` (`finalizeExtractionRun`) | Updated to construct a `docRow` via DB lookup before calling the validator. Same single call site as before. |
| `extractFactsFromClassifiedArtifacts.ts` | **NOT MODIFIED.** No batch-level wire-up needed; the per-run call from `finalizeExtractionRun` is the wire-up. |
| `deal_documents` (non-tax docs) | Bank statements, PFS, AR aging, leases never produce validation rows. Validator self-gates on `isTaxReturnDocument`. |
| `deals.validation_disabled` | New boolean column, default false. Validator reads it via its self-gate. Applies uniformly across all call paths. |
| `deal_document_validation_results` | Populated with one row per validated tax-return doc, including SKIPPED rows for unroutable tax returns (audit trail). NO rows for non-tax docs. |
| `buddy_system_events` | FLAGGED and BLOCKED outcomes generate `error_class: "EXTRACTION_ACCURACY"` events as the validator already implements (unchanged). |

### Verification (V-N)

- **V-1**: Unit test `resolveIrsFormType.test.ts` — table-driven test covering: (a) `ai_form_numbers: ["1120"]` + generic `BUSINESS_TAX_RETURN` → `FORM_1120`; (b) `["1120S"]` → `FORM_1120S`; (c) `["1065"]` → `FORM_1065`; (d) `["1040"]` → `FORM_1040`; (e) `canonical_type: "TAX_RETURN_1120"` + null form numbers → `FORM_1120`; (f) `canonical_type: "PERSONAL_TAX_RETURN"` + null form numbers → `FORM_1040`; (g) all null/empty → null.
- **V-2**: Unit test `isTaxReturnDocument` — returns true for the 17 canonical types in `TAX_RETURN_CANONICAL_TYPES`, false for `BANK_STATEMENT`, `PFS`, `AR_AGING`, `BALANCE_SHEET`, `INCOME_STATEMENT`, null, and unknown strings.
- **V-3**: Unit test for `runPostExtractionValidation` — verify each self-gate: (a) `validation_disabled = true` → SKIPPED, no row; (b) non-tax doc → SKIPPED, no row; (c) tax-return doc with resolver returning null → SKIPPED **with row persisted**; (d) tax-return doc with valid form spec → VERIFIED/FLAGGED/BLOCKED with row persisted; (e) extraction errors trapped, never thrown.
- **V-4**: Integration test for `finalizeExtractionRun` — assert that on `status: "succeeded"` the function fetches the doc row from `deal_documents` and calls `runPostExtractionValidation` with a correctly-constructed `docRow`. Mock the validator and verify the call shape. Verify that validation failures never throw or affect `finalizeExtractionRun`'s success path.
- **V-5**: Integration test for the `validation_disabled` self-gate — set the column to true on a fixture deal, call the validator directly, verify no row is written.
- **V-6**: Production smoke (§10) — run extraction on the OmniCare deal; confirm `deal_document_validation_results` contains exactly three rows (one per 1120) with non-SKIPPED statuses.

---

## §0 — Verify the problem still exists

Run before implementing.

**Database state check:**

```sql
-- Should return 0
SELECT count(*) FROM deal_document_validation_results;

-- Should return 0
SELECT count(*) FROM deal_extraction_exceptions;

-- Should return >0 rows showing BUSINESS_TAX_RETURN with populated ai_form_numbers
SELECT id, canonical_type, ai_form_numbers, ai_tax_year, doc_year
FROM deal_documents
WHERE canonical_type = 'BUSINESS_TAX_RETURN'
  AND ai_form_numbers IS NOT NULL
LIMIT 5;
```

**Caller-grep (expected to find the existing caller at `runRecord.ts:244`):**

```bash
grep -rn "runPostExtractionValidation" src/ --include="*.ts" --include="*.tsx" \
  | grep -v "src/lib/extraction/postExtractionValidator.ts" \
  | grep -v "__tests__"
```

**Expected output:**

```
src/lib/extraction/runRecord.ts:244:        const { runPostExtractionValidation } = await import("./postExtractionValidator");
src/lib/extraction/runRecord.ts:245:        await runPostExtractionValidation(
```

If the grep returns more callers than the two `runRecord.ts` lines above, surface them — the spec needs revision before implementing. If the grep returns zero, the rev 2 PIV is invalid; halt and reconcile.

If `deal_document_validation_results` already has rows, this spec is already partially done. Reconcile before proceeding.

---

## Scope

### §1 — Resolver: doc row → IrsFormType

New file: `src/lib/extraction/resolveIrsFormType.ts`

```typescript
import type { IrsFormType } from "@/lib/irsKnowledge/types";

type DocRow = {
  canonical_type: string | null;
  ai_form_numbers: string[] | null;
  document_type: string | null;
};

/**
 * Set of canonical_type values that indicate a document is a tax return
 * and therefore is a candidate for IRS identity validation.
 */
export const TAX_RETURN_CANONICAL_TYPES = new Set<string>([
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "INDIVIDUAL_TAX_RETURN",
  "TAX_RETURN_1040",
  "TAX_RETURN_1065",
  "TAX_RETURN_1120",
  "TAX_RETURN_1120S",
  "PARTNERSHIP_RETURN",
  "CORPORATE_RETURN",
  "S_CORP_RETURN",
  "TAX_RETURN",
  "FORM_1040",
  "FORM_1065",
  "FORM_1120",
  "FORM_1120S",
  "SCHEDULE_E",
  "SCHEDULE_C",
]);

export function isTaxReturnDocument(row: { canonical_type: string | null }): boolean {
  if (!row.canonical_type) return false;
  return TAX_RETURN_CANONICAL_TYPES.has(row.canonical_type.toUpperCase());
}

/**
 * Resolve a document row to its IRS form type for validation routing.
 *
 * Priority:
 *   1. If ai_form_numbers contains a known form number, use it.
 *   2. If canonical_type is one of the specific TAX_RETURN_* / FORM_* types, use the legacy map.
 *   3. Return null — caller writes a SKIPPED row only if the document is a tax return.
 */
export function resolveIrsFormType(row: DocRow): IrsFormType | null {
  const formNumbers = row.ai_form_numbers ?? [];

  for (const fn of formNumbers) {
    const normalized = fn.toUpperCase().replace(/\s+/g, "");
    if (normalized === "1120S") return "FORM_1120S";
    if (normalized === "1120") return "FORM_1120";
    if (normalized === "1065") return "FORM_1065";
    if (normalized === "1040" || normalized === "1040-SR") return "FORM_1040";
  }

  const ct = (row.canonical_type ?? "").toUpperCase();
  const SPECIFIC_MAP: Record<string, IrsFormType> = {
    TAX_RETURN_1065: "FORM_1065",
    TAX_RETURN_1120: "FORM_1120",
    TAX_RETURN_1120S: "FORM_1120S",
    TAX_RETURN_1040: "FORM_1040",
    PARTNERSHIP_RETURN: "FORM_1065",
    CORPORATE_RETURN: "FORM_1120",
    S_CORP_RETURN: "FORM_1120S",
    INDIVIDUAL_TAX_RETURN: "FORM_1040",
    PERSONAL_TAX_RETURN: "FORM_1040",
    SCHEDULE_E: "SCHEDULE_E",
    SCHEDULE_C: "SCHEDULE_C",
  };
  if (SPECIFIC_MAP[ct]) return SPECIFIC_MAP[ct];

  return null;
}
```

### §2 — Refactor `postExtractionValidator.ts` AND update `runRecord.ts` in the same commit

Two file changes land together because the signature change is breaking.

#### §2a — `postExtractionValidator.ts`

The validator gains the new signature taking `docRow` plus internal self-gates:

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { getFormSpec, validateDocumentFacts, isSpreadGenerationAllowed } from "@/lib/irsKnowledge";
import type { ValidationStatus } from "@/lib/irsKnowledge/types";
import { resolveIrsFormType, isTaxReturnDocument } from "./resolveIrsFormType";

export type PostExtractionValidationResult = {
  documentId: string;
  status: ValidationStatus | "SKIPPED";
  summary: string;
  spreadGenerationAllowed: boolean;
  requiresAnalystSignOff: boolean;
};

export async function runPostExtractionValidation(
  documentId: string,
  dealId: string,
  docRow: {
    canonical_type: string | null;
    ai_form_numbers: string[] | null;
    document_type: string | null;
  },
  taxYear: number | null,
): Promise<PostExtractionValidationResult> {
  const sb = supabaseAdmin();

  try {
    // Self-gate 1: tenant escape hatch. No row persisted.
    const { data: dealRow } = await (sb as any)
      .from("deals")
      .select("validation_disabled")
      .eq("id", dealId)
      .maybeSingle();

    if (dealRow?.validation_disabled) {
      return {
        documentId,
        status: "SKIPPED",
        summary: "validation_disabled=true on deal",
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // Self-gate 2: only tax-return documents get IRS identity validation. No row.
    if (!isTaxReturnDocument(docRow)) {
      return {
        documentId,
        status: "SKIPPED",
        summary: `Not a tax-return document (canonical_type=${docRow.canonical_type})`,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // a) Resolve IRS form type
    const irsFormType = resolveIrsFormType(docRow);
    if (!irsFormType) {
      const summary = `No IRS form type resolvable. canonical_type=${docRow.canonical_type}, ai_form_numbers=${JSON.stringify(docRow.ai_form_numbers)}`;
      await persistSkipped(sb, dealId, documentId, summary);
      return {
        documentId,
        status: "SKIPPED",
        summary,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // b) Get form spec
    const spec = getFormSpec(irsFormType, taxYear ?? 2024);
    if (!spec) {
      const summary = `No form spec for ${irsFormType} ${taxYear}`;
      await persistSkipped(sb, dealId, documentId, summary, irsFormType, taxYear);
      return {
        documentId,
        status: "SKIPPED",
        summary,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // c) Query facts for this document
    const { data: factRows, error: factsError } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId)
      .eq("source_document_id", documentId);

    if (factsError || !factRows || factRows.length === 0) {
      const summary = factsError
        ? `Facts query failed: ${factsError.message}`
        : "No facts found for document";
      await persistSkipped(sb, dealId, documentId, summary, irsFormType, taxYear);
      return {
        documentId,
        status: "SKIPPED",
        summary,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // Build fact map
    const facts: Record<string, number | null> = {};
    for (const row of factRows as { fact_key: string; fact_value_num: number | null }[]) {
      facts[row.fact_key] = row.fact_value_num;
    }

    // d) Run identity validation
    const result = validateDocumentFacts(documentId, spec, facts);

    // e) Upsert to deal_document_validation_results
    await (sb as any)
      .from("deal_document_validation_results")
      .upsert(
        {
          document_id: documentId,
          deal_id: dealId,
          form_type: result.formType,
          tax_year: result.taxYear,
          status: result.status,
          check_results: result.checkResults,
          passed_count: result.passedCount,
          failed_count: result.failedCount,
          skipped_count: result.skippedCount,
          summary: result.summary,
          validated_at: result.validatedAt,
        },
        { onConflict: "document_id" },
      );

    // f) Emit ledger event
    writeEvent({
      dealId,
      kind: "extraction.identity_validation_complete",
      scope: "extraction",
      action: "identity_validation_complete",
      meta: {
        document_id: documentId,
        form_type: result.formType,
        tax_year: result.taxYear,
        status: result.status,
        passed_count: result.passedCount,
        failed_count: result.failedCount,
        skipped_count: result.skippedCount,
        summary: result.summary,
      },
    }).catch(() => {});

    // g) Aegis findings for FLAGGED/BLOCKED (unchanged from existing impl)
    if (result.status === "FLAGGED" || result.status === "BLOCKED") {
      const failedChecks = result.checkResults
        .filter(r => !r.skipped && !r.passed)
        .map(r => `${r.checkId}: delta $${r.delta?.toFixed(0)} (tolerance $${r.toleranceDollars})`)
        .join("; ");

      await (sb as any)
        .from("buddy_system_events")
        .insert({
          deal_id: dealId,
          event_type: result.status === "BLOCKED" ? "error" : "warning",
          severity: result.status === "BLOCKED" ? "HIGH" : "MEDIUM",
          error_class: "EXTRACTION_ACCURACY",
          error_code: "IRS_IDENTITY_CHECK_FAILED",
          error_signature: `irs_identity_${result.formType}_${result.taxYear}`,
          error_message: `IRS Identity Check ${result.status}: ${result.formType} ${result.taxYear}. ${result.summary}`,
          source_system: "irs_identity_validator",
          source_job_id: documentId,
          source_job_table: "deal_documents",
          resolution_status: "open",
          payload: {
            document_id: documentId,
            form_type: result.formType,
            tax_year: result.taxYear,
            status: result.status,
            failed_checks: failedChecks,
            check_results: result.checkResults,
          },
        })
        .then(() => {})
        .catch(() => {});
    }

    // h) Check spread generation gate
    const gate = isSpreadGenerationAllowed([result]);

    return {
      documentId,
      status: result.status,
      summary: result.summary,
      spreadGenerationAllowed: gate.allowed,
      requiresAnalystSignOff: gate.requiresAnalystSignOff,
    };
  } catch (err) {
    console.warn("[PostExtractionValidator] Validation failed (non-fatal):", err);
    return {
      documentId,
      status: "SKIPPED",
      summary: `Validation error: ${err instanceof Error ? err.message : "unknown"}`,
      spreadGenerationAllowed: true,
      requiresAnalystSignOff: false,
    };
  }
}

async function persistSkipped(
  sb: any,
  dealId: string,
  documentId: string,
  summary: string,
  formType: string | null = null,
  taxYear: number | null = null,
): Promise<void> {
  await sb
    .from("deal_document_validation_results")
    .upsert(
      {
        document_id: documentId,
        deal_id: dealId,
        form_type: formType,
        tax_year: taxYear,
        status: "SKIPPED",
        check_results: [],
        passed_count: 0,
        failed_count: 0,
        skipped_count: 0,
        summary,
        validated_at: new Date().toISOString(),
      },
      { onConflict: "document_id" },
    )
    .then(() => {})
    .catch(() => {});
}
```

#### §2b — `runRecord.ts:241-253` (`finalizeExtractionRun`)

Update the existing call site to construct a `docRow` and pass it:

```typescript
// Fire post-extraction IRS identity validation (non-blocking, dynamic import)
if (args.status === "succeeded") {
  void (async () => {
    try {
      // Fetch the doc row so the validator can route correctly
      const { data: docRow } = await (supabaseAdmin() as any)
        .from("deal_documents")
        .select("canonical_type, ai_form_numbers, document_type, ai_tax_year, doc_year")
        .eq("id", args.documentId)
        .maybeSingle();

      if (!docRow) return; // doc deleted between extraction and finalize — skip silently

      const { runPostExtractionValidation } = await import("./postExtractionValidator");
      await runPostExtractionValidation(
        args.documentId,
        args.dealId,
        {
          canonical_type: docRow.canonical_type,
          ai_form_numbers: docRow.ai_form_numbers,
          document_type: docRow.document_type,
        },
        docRow.ai_tax_year ?? docRow.doc_year ?? (args.metrics?.taxYear as number) ?? null,
      );
    } catch { /* validation must never break extraction */ }
  })();
}
```

Both changes land in a single commit.

### §3 — DROPPED in rev 2

Originally proposed a batch-level wire-up in `extractFactsFromClassifiedArtifacts.ts`. Dropped because §0 revealed the validator is already called per-run from `finalizeExtractionRun`. Adding a batch-level call would double-fire.

`extractFactsFromClassifiedArtifacts.ts` is **NOT MODIFIED** by this spec.

### §4 — `validation_disabled` column on deals

Migration `20260513_deals_validation_disabled`:

```sql
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS validation_disabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN deals.validation_disabled IS
  'When true, skips post-extraction IRS identity validation. Use only for deals where the validator is producing false positives that block legitimate underwriting. Default false. The validator self-gates on this column, so the flag applies uniformly across all call paths.';
```

The column is read by the validator itself in §2a (self-gate 1), not by callers.

### §5 — Backfill script

New file: `scripts/backfill-extraction-validation.ts`

For each deal that has tax-return documents:
1. Find documents where `canonical_type` is in `TAX_RETURN_CANONICAL_TYPES` (import from resolver)
2. For each doc, fetch `(canonical_type, ai_form_numbers, document_type, ai_tax_year, doc_year)`
3. Call `runPostExtractionValidation` with the new signature. The validator's self-gates apply automatically.
4. Log results per deal: `{ deal_id, docs_processed, verified, flagged, blocked, skipped }`
5. Final summary at end

Add to `package.json`:

```json
"backfill:validation": "tsx scripts/backfill-extraction-validation.ts"
```

The script is idempotent (validator upserts on `onConflict: "document_id"`). Recommended invocation:

```bash
npm run backfill:validation 2>&1 | tee logs/backfill-validation-$(date +%Y%m%d-%H%M%S).log
```

### Hard non-goals

- The full 4-gate `reExtractionOrchestrator` retry loop. Gate 1 only.
- Changing the classifier to write specific canonical types.
- New form specs beyond what `getFormSpec` already supports (1040, 1065, 1120, 1120S, Schedule C, Schedule E).
- UI surfacing of validation results.
- Modifying `extractFactsFromClassifiedArtifacts.ts`.
- Modifying `reExtractionOrchestrator.ts`.

Validator must never block extraction. Never throw. Never roll back the extraction transaction.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Validator finds real failures and floods `buddy_system_events` with FLAGGED/BLOCKED | High | Medium | This is the goal. Set `validation_disabled = true` on specific deals if volume blocks work. |
| Validator throws and breaks extraction | Low | High | Validator catches all errors and returns SKIPPED. `runRecord.ts:241-253` uses `void (async () => {...})()` so any throw is contained. |
| Form-number-driven routing misclassifies a doc | Low | Medium | Tier 1 anchors hit at 0.97 confidence on literal "Form 1120" strings. Resolver only trusts known-good form numbers. |
| Backfill script overwhelms the database | Medium | Low | Serial deal processing with per-deal concurrency 3. ~126 docs total, <2 min runtime. |
| Signature change breaks the existing `runRecord.ts:244` caller | Low | High | Both files updated in the same commit (§2a + §2b). Typecheck enforces. V-4 catches regression. |
| Two new DB fetches (`deals.validation_disabled` + caller's `deal_documents` lookup) add latency | Low | Low | Validator is fired non-blocking via `void (async () => {...})()` in `runRecord.ts`. Both fetches happen off the main extraction promise. At current volumes the latency is negligible. Track in observability; future optimization can fold both lookups into a single round-trip. |
| SKIPPED rows accumulate noise on non-tax documents | Mitigated | N/A | Validator self-gate 2 (`isTaxReturnDocument`) returns early without writing a row for non-tax docs. |

---

## Hand-off commit message

```
feat(extraction): fix post-extraction validation wire-up and add validation_disabled escape hatch

The validator (runPostExtractionValidation) is already invoked from
finalizeExtractionRun, but every call short-circuits to SKIPPED without
persisting a row because (a) DOC_TYPE_TO_IRS_FORM has no entry for the generic
BUSINESS_TAX_RETURN canonical type the classifier writes, and (b) SKIPPED
outcomes never wrote audit rows.

This change adds a resolveIrsFormType helper that reads ai_form_numbers
(already populated by Tier 1 anchors) to route business tax returns to their
specific form spec. SKIPPED outcomes now persist audit rows for tax-return
documents (non-tax documents are filtered out by the validator's self-gate so
no SKIPPED noise accumulates on bank statements / PFS / AR aging).

Adds a deals.validation_disabled escape hatch read by the validator itself, so
the flag applies uniformly across all call paths.

Changes:
- New: src/lib/extraction/resolveIrsFormType.ts (resolver + isTaxReturnDocument + TAX_RETURN_CANONICAL_TYPES)
- New: src/lib/extraction/__tests__/resolveIrsFormType.test.ts
- Modified: src/lib/extraction/postExtractionValidator.ts (accept docRow, self-gates, persist SKIPPED rows for tax-return docs)
- Modified: src/lib/extraction/runRecord.ts (construct docRow before calling validator)
- New migration: 20260513_deals_validation_disabled.sql
- New: scripts/backfill-extraction-validation.ts
- Modified: package.json (add backfill:validation script)

Per SPEC-EXTRACT-VALIDATOR-WIRE-1 (rev 2). Validates against V-1 through V-6.

Closes Gap 1 from docs/FINANCIAL_EXPERTISE.md.
```

---

## Addendum for Claude Code

**Read-before-coding checklist:**

1. `docs/FINANCIAL_EXPERTISE.md` §12 and §15 (Gap 1) — context.
2. `src/lib/extraction/postExtractionValidator.ts` — the function being refactored.
3. `src/lib/extraction/runRecord.ts` lines 219-260 — the existing call site updated in §2b. Read the full `finalizeExtractionRun` function to understand the fire-and-forget pattern.
4. `src/lib/irsKnowledge/types.ts` — `IrsFormType` union and `FormSpecification` shape.
5. `src/lib/irsKnowledge/index.ts` — `getFormSpec()` helper.
6. `src/lib/irsKnowledge/identityValidator.ts` — what runs once the form spec is resolved.

**Implementation order (mandatory):**

1. Run §0 verification queries and the caller-grep. STOP if `deal_document_validation_results` already has rows, OR if the grep returns more than the two `runRecord.ts` lines documented in §0's "Expected output," OR if the grep returns zero.
2. Create migration for `deals.validation_disabled`. Apply locally.
3. Create `src/lib/extraction/resolveIrsFormType.ts` per §1.
4. Write unit tests for `resolveIrsFormType` and `isTaxReturnDocument` (V-1, V-2). Run. Confirm green.
5. Refactor `postExtractionValidator.ts` per §2a AND update `runRecord.ts` per §2b in a single commit. Add tests for V-3 and V-4. Run. Confirm green.
6. Write V-5 integration test for `validation_disabled` self-gate. Run. Confirm green.
7. Run `npm run typecheck`. Confirm green.
8. Create `scripts/backfill-extraction-validation.ts` per §5. Do NOT run it.
9. Update `docs/FINANCIAL_EXPERTISE.md` Gap 1 section: mark as "Closed in SPEC-EXTRACT-VALIDATOR-WIRE-1" rather than deleting.
10. Commit per the hand-off message above. Open PR against main referencing this spec.

**AAR verification requirements:**

1. `git log --oneline -10` showing all commits on the branch.
2. Output of `npm run typecheck` showing green.
3. Output of all V-1 through V-5 test runs showing green.
4. Note that §3 was dropped per rev 2 of the spec (single line).
5. Verification that the backfill script was NOT run.
6. Confirmation that `docs/FINANCIAL_EXPERTISE.md` Gap 1 was updated, not deleted.

---

## §10 — OmniCare single-deal smoke test (post-merge, pre-backfill — operator step)

**Not part of the implementation PR.** Operator runbook after the PR merges and deploys.

**Procedure:**

1. Re-trigger extraction on the OmniCare deal `80fe6f7a-5c68-4f02-8bcf-933f246a9fc5`.
2. Wait for extraction to complete (typically <5 minutes).
3. Query results:

```sql
SELECT
  v.document_id,
  d.canonical_type,
  d.ai_form_numbers,
  d.ai_tax_year,
  v.form_type,
  v.tax_year,
  v.status,
  v.passed_count,
  v.failed_count,
  v.skipped_count,
  v.summary
FROM deal_document_validation_results v
JOIN deal_documents d ON d.id = v.document_id
WHERE v.deal_id = '80fe6f7a-5c68-4f02-8bcf-933f246a9fc5'
ORDER BY d.doc_year;
```

**Expected:**
- Three rows (one per 1120 document, tax years 2022/2023/2024).
- `form_type = FORM_1120` for all three.
- `status` is one of `VERIFIED`, `FLAGGED`, or `BLOCKED` — **not** `SKIPPED`.
- Given the garbage facts, at least one should fail identity checks. FLAGGED or BLOCKED is the most likely outcome and is the correct signal.

**Decision tree:**
- All three `VERIFIED` → unexpected but not a regression. Note for follow-up. Proceed to backfill.
- Mix of FLAGGED/BLOCKED → working as designed. Proceed to backfill.
- All `SKIPPED` → something's wrong with the resolver or wire-up. Stop. Diagnose. Do NOT run backfill.
- Zero rows → validator wasn't invoked. Stop. Check `validation_disabled` flag and extraction logs.

Once smoke passes:

```bash
npm run backfill:validation 2>&1 | tee logs/backfill-validation-$(date +%Y%m%d-%H%M%S).log
```
