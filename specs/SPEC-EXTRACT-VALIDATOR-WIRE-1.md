# SPEC-EXTRACT-VALIDATOR-WIRE-1

## Problem in View (PIV)

The four-gate institutional-grade extraction validation infrastructure documented in `docs/FINANCIAL_EXPERTISE.md` §12 has never run in production. Across 19 deals containing 65 business tax returns and 61 personal tax returns, `deal_document_validation_results` has zero rows and `deal_extraction_exceptions` has zero rows.

The validator entry point — `runPostExtractionValidation(documentId, dealId, canonicalType, taxYear)` in `src/lib/extraction/postExtractionValidator.ts` — is fully implemented, returns `SKIPPED` gracefully on all error paths, never throws, and has supporting form specs for 1040, 1065, 1120, 1120S, Schedule C, and Schedule E. It is simply not called by anything in the extraction pipeline.

A second, smaller wiring gap compounds the first: when the validator does eventually get called, its `DOC_TYPE_TO_IRS_FORM` lookup table has no entry for `BUSINESS_TAX_RETURN` (the canonical type written by classification for all tax-return docs). It does have entries for the specific types — `TAX_RETURN_1120`, `TAX_RETURN_1120S`, etc. — but those types are never produced by the classifier. The result would still be `SKIPPED` even if the validator were wired in.

**Concrete evidence (OmniCare deal `80fe6f7a-5c68-4f02-8bcf-933f246a9fc5`):**

Three Form 1120 C-corporation returns for 2022, 2023, 2024. All classified at `tier1_anchor` with 0.97 confidence. Each row has `canonical_type = 'BUSINESS_TAX_RETURN'`, `ai_form_numbers = ['1120']`, `ai_tax_year` populated. Garbage extracted facts (`F1125A_DIRECT_LABOR: 6`, `WAGES_W2: 3`, `F4562_BONUS_DEPRECIATION: 11`, `F1125E_COMPENSATION: 100`) persisted as canonical because no gate ever ran.

Form number and tax year are already in the database. The fix is wiring, not building.

## §0 — Verify the problem still exists

Run before implementing:

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

Also verify the signature change is safe:

```bash
# From repo root. Expected: 0 matches outside src/lib/extraction/postExtractionValidator.ts
# itself and any __tests__ directory.
grep -rn "runPostExtractionValidation" src/ --include="*.ts" --include="*.tsx" \
  | grep -v "src/lib/extraction/postExtractionValidator.ts" \
  | grep -v "__tests__"
```

If the grep returns any production callers, this spec becomes a breaking change and §2's signature refactor needs to be done differently (overload or new function). If it returns zero, proceed as written.

If `deal_document_validation_results` already has rows, this spec is already partially done. Reconcile before proceeding.

## Scope

### In scope

1. Wire `runPostExtractionValidation` into `extractFactsFromClassifiedArtifacts` as a new step between extraction and backfill, **filtered to tax-return documents only**.
2. Add an IRS-form-type resolver that maps from a document row to the correct `IrsFormType`, using `ai_form_numbers` and `canonical_type` together.
3. Add a per-deal escape hatch: `deals.validation_disabled boolean default false`. When true, the validator step is skipped entirely with a log line.
4. Backfill validation on the existing 19 deals — a one-time script that iterates already-extracted documents and calls the validator.
5. Add aggregate counters to `ExtractFromArtifactsResult`: `validated`, `validationFlagged`, `validationBlocked`, `validationSkipped`.

### Out of scope

- The full 4-gate `reExtractionOrchestrator` retry loop. Gate 1 (identity validation) is enough to make the next OmniCare run useful; gates 2-4 wait for a follow-up spec.
- Changing the classifier to write specific canonical types (e.g., `TAX_RETURN_1120` instead of `BUSINESS_TAX_RETURN`). The resolver in this spec reads `ai_form_numbers` and bypasses the canonical-type ambiguity entirely. Changing the classifier is a future cleanup, not a blocker.
- New form specs. We have 1040, 1065, 1120, 1120S, Schedule C, Schedule E. K-1, Schedule L, M-1, M-2, 4562, 1125-A, 1125-E specs come later.
- UI surfacing of validation results. Database rows and ledger events first; UI is a follow-up.
- Validating already-extracted documents that were skipped in the current extraction batch because they already had facts. The backfill script (§5) handles those; the wired path stays narrow.

### Hard non-goals

- Validator must never block extraction. It must never throw, never roll back the extraction transaction, never fail closed in a way that prevents `backfillCanonicalFactsFromSpreads` from running afterward.
- No silent suppression on tax-return documents. When a doc passes the §3 tax-return filter and the resolver still returns null, a SKIPPED row is written so the audit trail captures why the validator couldn't route it. Non-tax documents are never sent to the validator at all (no SKIPPED noise).

## §1 — Resolver: doc row → IrsFormType

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
 * and therefore should be sent to the IRS identity validator.
 *
 * Exported so the wire-up in extractFactsFromClassifiedArtifacts can
 * filter before calling the validator, avoiding SKIPPED-row noise on
 * bank statements, PFS, AR aging, etc.
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
 *   1. If ai_form_numbers contains a known form number, use it (most specific signal).
 *   2. If canonical_type is one of the specific TAX_RETURN_* / FORM_* types, use the legacy map.
 *   3. Return null if nothing matches — caller writes a SKIPPED row only if the
 *      document is a tax return (per isTaxReturnDocument).
 */
export function resolveIrsFormType(row: DocRow): IrsFormType | null {
  const formNumbers = row.ai_form_numbers ?? [];

  // Priority 1: explicit form number wins
  for (const fn of formNumbers) {
    const normalized = fn.toUpperCase().replace(/\s+/g, "");
    if (normalized === "1120S") return "FORM_1120S";
    if (normalized === "1120") return "FORM_1120";
    if (normalized === "1065") return "FORM_1065";
    if (normalized === "1040" || normalized === "1040-SR") return "FORM_1040";
  }

  // Priority 2: legacy specific types
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

  // Priority 3: no signal. Caller decides whether to persist SKIPPED.
  return null;
}
```

## §2 — Refactor `postExtractionValidator.ts`

Replace the hardcoded `DOC_TYPE_TO_IRS_FORM` map with a call to `resolveIrsFormType`. Persist SKIPPED rows on unresolved form types **only when the document is a tax return** (caller has already filtered; validator can trust it).

Diff target (around line 44, the `runPostExtractionValidation` entry):

```typescript
import { resolveIrsFormType } from "./resolveIrsFormType";

export async function runPostExtractionValidation(
  documentId: string,
  dealId: string,
  docRow: { canonical_type: string | null; ai_form_numbers: string[] | null; document_type: string | null },
  taxYear: number | null,
): Promise<PostExtractionValidationResult> {
  const sb = supabaseAdmin();

  try {
    // a) Resolve IRS form type from doc row
    const irsFormType = resolveIrsFormType(docRow);
    if (!irsFormType) {
      const summary = `No IRS form type resolvable. canonical_type=${docRow.canonical_type}, ai_form_numbers=${JSON.stringify(docRow.ai_form_numbers)}`;
      await persistSkipped(sb, dealId, documentId, summary);
      return {
        documentId, status: "SKIPPED", summary,
        spreadGenerationAllowed: true, requiresAnalystSignOff: false,
      };
    }

    // b) Get form spec
    const spec = getFormSpec(irsFormType, taxYear ?? 2024);
    if (!spec) {
      const summary = `No form spec for ${irsFormType} ${taxYear}`;
      await persistSkipped(sb, dealId, documentId, summary, irsFormType, taxYear);
      return {
        documentId, status: "SKIPPED", summary,
        spreadGenerationAllowed: true, requiresAnalystSignOff: false,
      };
    }

    // (rest unchanged — query facts, run identity check, upsert, emit ledger event, etc.)
```

Where `persistSkipped` is a new helper that upserts a SKIPPED row into `deal_document_validation_results`:

```typescript
async function persistSkipped(
  sb: any, dealId: string, documentId: string, summary: string,
  formType: string | null = null, taxYear: number | null = null,
): Promise<void> {
  await sb.from("deal_document_validation_results").upsert({
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
  }, { onConflict: "document_id" }).then(() => {}).catch(() => {});
}
```

**Signature change rationale.** Per §0, this is safe only if zero production callers exist. If the §0 grep finds any callers, do this instead: keep the old signature alive as a legacy entrypoint that constructs a `docRow` from a database lookup, mark it `@deprecated`, and route new code through the new signature. Default to the clean refactor if §0 shows zero callers.

## §3 — Wire validator into `extractFactsFromClassifiedArtifacts`

Diff target: `src/lib/financialFacts/extractFactsFromClassifiedArtifacts.ts`, between the extraction batch (current step 3) and the backfill (current step 4).

```typescript
import { runPostExtractionValidation } from "@/lib/extraction/postExtractionValidator";
import { isTaxReturnDocument } from "@/lib/extraction/resolveIrsFormType";

// ... existing code through step 3 (extraction batch) unchanged ...

// 3.5) Run post-extraction validation on tax-return documents in this extraction batch.
//      Already-extracted docs from prior runs that weren't in `batch` are NOT validated here —
//      the one-time backfill script (scripts/backfill-extraction-validation.ts) handles those.
//      This keeps the wired path narrow and predictable.
let validated = 0;
let validationFlagged = 0;
let validationBlocked = 0;
let validationSkipped = 0;

// Check the validation_disabled escape hatch on the deal
const { data: dealRow } = await (sb as any)
  .from("deals")
  .select("validation_disabled")
  .eq("id", dealId)
  .maybeSingle();

const validationEnabled = !dealRow?.validation_disabled;

if (validationEnabled && batch.length > 0) {
  const docIdsToValidate = batch.map((a) => a.source_id);
  const { data: docRows } = await (sb as any)
    .from("deal_documents")
    .select("id, canonical_type, ai_form_numbers, document_type, ai_tax_year, doc_year")
    .in("id", docIdsToValidate);

  const allDocRows = (docRows ?? []) as Array<{
    id: string;
    canonical_type: string | null;
    ai_form_numbers: string[] | null;
    document_type: string | null;
    ai_tax_year: number | null;
    doc_year: number | null;
  }>;

  // Filter to tax-return documents only. Bank statements, PFS, AR aging,
  // leases, etc. are not sent to the IRS identity validator.
  const taxReturnDocs = allDocRows.filter(isTaxReturnDocument);

  for (const doc of taxReturnDocs) {
    const taxYear = doc.ai_tax_year ?? doc.doc_year ?? null;
    const result = await runPostExtractionValidation(
      doc.id,
      dealId,
      { canonical_type: doc.canonical_type, ai_form_numbers: doc.ai_form_numbers, document_type: doc.document_type },
      taxYear,
    );

    switch (result.status) {
      case "VERIFIED": case "PARTIAL": validated++; break;
      case "FLAGGED":  validationFlagged++; break;
      case "BLOCKED":  validationBlocked++; break;
      case "SKIPPED":  validationSkipped++; break;
    }
  }
} else if (!validationEnabled) {
  console.info("[extractFactsFromClassifiedArtifacts] validation_disabled=true, skipping gates", { dealId });
}

// 4) Run canonical fact backfill from any existing spreads (unchanged)
const backfill = await backfillCanonicalFactsFromSpreads({ dealId, bankId });

// ... existing step 5 (enqueue spread recompute) unchanged ...

return {
  ok: true,
  extracted,
  skipped,
  failed,
  backfillFactsWritten: backfill.ok ? backfill.factsWritten : 0,
  validated,
  validationFlagged,
  validationBlocked,
  validationSkipped,
};
```

Update `ExtractFromArtifactsResult` type:

```typescript
export type ExtractFromArtifactsResult =
  | {
      ok: true;
      extracted: number;
      skipped: number;
      failed: number;
      backfillFactsWritten: number;
      validated: number;
      validationFlagged: number;
      validationBlocked: number;
      validationSkipped: number;
    }
  | { ok: false; error: string };
```

## §4 — `validation_disabled` column on deals

Migration `20260513_deals_validation_disabled`:

```sql
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS validation_disabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN deals.validation_disabled IS
  'When true, skips post-extraction IRS identity validation. Use only for deals where the validator is producing false positives that block legitimate underwriting. Default false (validation runs).';
```

## §5 — Backfill script

New file: `scripts/backfill-extraction-validation.ts`

For each deal that has tax-return documents:
1. Skip if `validation_disabled = true`
2. Find documents where `canonical_type` is in `TAX_RETURN_CANONICAL_TYPES` (import from resolver)
3. For each doc, fetch `(canonical_type, ai_form_numbers, document_type, ai_tax_year, doc_year)`
4. Call `runPostExtractionValidation` exactly the same way the wired extraction does
5. Log results per deal: `{ deal_id, docs_processed, verified, flagged, blocked, skipped }`
6. Final summary at end: totals across all deals

Add to `package.json`:

```json
"backfill:validation": "tsx scripts/backfill-extraction-validation.ts"
```

The script is idempotent (validator upserts on `onConflict: "document_id"`) and safe to run multiple times. Recommended invocation:

```bash
npm run backfill:validation 2>&1 | tee logs/backfill-validation-$(date +%Y%m%d-%H%M%S).log
```

## §6 — Verification

Verification points (V-N), to be confirmed after Claude Code lands the change:

- **V-1**: Unit test `resolveIrsFormType.test.ts` — table-driven test covering: (a) `ai_form_numbers: ["1120"]` + generic `BUSINESS_TAX_RETURN` → `FORM_1120`; (b) `ai_form_numbers: ["1120S"]` → `FORM_1120S`; (c) `ai_form_numbers: ["1065"]` → `FORM_1065`; (d) `ai_form_numbers: ["1040"]` → `FORM_1040`; (e) `canonical_type: "TAX_RETURN_1120"` + null form numbers → `FORM_1120`; (f) `canonical_type: "PERSONAL_TAX_RETURN"` + null form numbers → `FORM_1040`; (g) all null/empty → null.
- **V-2**: Unit test `isTaxReturnDocument` — returns true for the 17 canonical types in `TAX_RETURN_CANONICAL_TYPES`, false for `BANK_STATEMENT`, `PFS`, `AR_AGING`, `BALANCE_SHEET`, `INCOME_STATEMENT`, null, and unknown strings.
- **V-3**: Unit test for `runPostExtractionValidation` — verify SKIPPED outcomes write rows to `deal_document_validation_results` (today they don't).
- **V-4**: Integration test for `extractFactsFromClassifiedArtifacts` — assert returned result includes `validated`, `validationFlagged`, `validationBlocked`, `validationSkipped` counters. Assert non-tax documents in the batch do NOT generate SKIPPED rows.
- **V-5**: Integration test for `validation_disabled` flag — when set to true on a deal, validator step is skipped and all four validation counters are zero regardless of batch contents.
- **V-6**: Production smoke (§10) — run extraction on the OmniCare deal; confirm `deal_document_validation_results` contains exactly three rows (one per 1120) with non-SKIPPED statuses.

## §7 — Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Validator finds real failures on existing data and floods `buddy_system_events` with FLAGGED/BLOCKED entries | High | Medium | This is the goal. The system events are correct signals. If the volume is high, that's evidence the validator was overdue, not evidence to back it out. Set `validation_disabled = true` on specific deals if needed. |
| Validator throws on some malformed fact row and breaks extraction | Low | High | The validator already catches all errors and returns SKIPPED. Spec preserves this guarantee. The wire-up code (§3) uses no `await` outside the existing try/catch structure. |
| Form-number-driven routing misclassifies a doc | Low | Medium | Tier 1 anchors hit at 0.97 confidence and the source patterns are unambiguous (literal "Form 1120" strings). Resolver only trusts known-good form numbers (1120, 1120S, 1065, 1040). |
| Backfill script overwhelms the database with concurrent writes | Medium | Low | Script processes deals serially with a small per-deal concurrency (3). Each validation call is one upsert + one optional system_events insert. ~126 docs total. Estimated runtime: under 2 minutes. |
| Signature change to `runPostExtractionValidation` breaks something | Very Low (per §0 grep) | Low | §0 verifies zero current callers before the change lands. If the grep finds callers, §2 includes a fallback compatibility-layer approach. |
| SKIPPED rows accumulate noise on non-tax documents | Was high, now Mitigated | Low | §3 filters to `isTaxReturnDocument` before calling the validator. Non-tax docs never reach `runPostExtractionValidation`, so they never produce SKIPPED rows. |

## §8 — Hand-off commit message (for Claude Code)

```
feat(extraction): wire post-extraction validation gates into extraction pipeline

The four-gate validation infrastructure has been built but never invoked. This
wires runPostExtractionValidation into extractFactsFromClassifiedArtifacts after
each extraction completes, using a new resolveIrsFormType helper that reads
ai_form_numbers from deal_documents to route correctly even when canonical_type
is the generic BUSINESS_TAX_RETURN bucket. Validation is filtered to tax-return
documents only to avoid SKIPPED-row noise on bank statements, PFS, etc.

Changes:
- New: src/lib/extraction/resolveIrsFormType.ts (form-type resolver + isTaxReturnDocument)
- New: src/lib/extraction/__tests__/resolveIrsFormType.test.ts
- Modified: src/lib/extraction/postExtractionValidator.ts (accept docRow, persist SKIPPED rows)
- Modified: src/lib/financialFacts/extractFactsFromClassifiedArtifacts.ts (wire validation step, filter to tax returns)
- New migration: 20260513_deals_validation_disabled.sql (escape hatch)
- New: scripts/backfill-extraction-validation.ts
- Modified: package.json (add backfill:validation script)

Per SPEC-EXTRACT-VALIDATOR-WIRE-1. Validates against §6 V-1 through V-6.

Closes Gap 1 from docs/FINANCIAL_EXPERTISE.md.
```

## §9 — Addendum for Claude Code

- Start with §0. The grep on `runPostExtractionValidation` is load-bearing. If it returns zero, proceed with the clean signature change in §2. If it returns one or more callers, switch to the compatibility-layer approach noted in §2 and update §6 V-3 to test both signatures.
- Run `npm run typecheck` after changes. Expected: green.
- Run the new `resolveIrsFormType.test.ts` tests. All should pass.
- **Do not** run the backfill script in the same PR as the wiring change. Wiring lands first, gets merged, then OmniCare smoke test (§10), then run the backfill once smoke passes.
- **Do not** modify the four-gate orchestrator (`reExtractionOrchestrator.ts`). That's a future spec. This change wires only Gate 1 (identity validation via `runPostExtractionValidation`). Gates 2-4 are part of a separate orchestrator that comes later.
- Update `docs/FINANCIAL_EXPERTISE.md` Gap 1 section in the same PR: mark it as "Closed in SPEC-EXTRACT-VALIDATOR-WIRE-1" rather than deleting it. The historical record matters.

## §10 — OmniCare single-deal smoke test (post-merge, pre-backfill)

After the PR merges to main and deploys to Vercel, run a single-deal smoke test on OmniCare before running the broader backfill across the 18 other deals.

**Why:** The entire motivation for this spec is OmniCare's garbage facts. If validation behaves unexpectedly on OmniCare — form-spec gap, schema drift, tax-year mismatch, fact-key naming inconsistency — we want to discover that on one deal we understand cold, not mid-batch across 18 others.

**Procedure:**

1. Re-trigger extraction on the OmniCare deal `80fe6f7a-5c68-4f02-8bcf-933f246a9fc5` via whatever mechanism the deal cockpit exposes (re-extract button, or manual API call to the extraction worker).
2. Wait for extraction to complete (typically under 5 minutes).
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
- `status` is one of `VERIFIED`, `FLAGGED`, or `BLOCKED` — but **not** `SKIPPED`. The form is resolvable, the spec exists, and there are extracted facts.
- Given the garbage facts present in extraction (e.g., `WAGES_W2: 3`), at least one of the three should fail identity checks. `FLAGGED` or `BLOCKED` is the most likely outcome and is the correct signal — the validator is doing its job.

**Decision tree based on smoke results:**
- All three `VERIFIED` → unexpected, but not a regression. Maybe the garbage facts don't actually violate the identity equations Gate 1 checks. Note for follow-up (Gates 2-4 may catch what Gate 1 didn't), then proceed to backfill.
- Mix of FLAGGED/BLOCKED → working as designed. Proceed to backfill.
- All `SKIPPED` → something's wrong with the resolver or the wire-up. Stop. Diagnose. Do NOT run backfill.
- Zero rows → the wired validator wasn't invoked. Stop. Check the deal's `validation_disabled` flag and the extraction logs.

Once smoke passes (FLAGGED/BLOCKED or VERIFIED on all three OmniCare 1120s), proceed to the broader backfill:

```bash
npm run backfill:validation 2>&1 | tee logs/backfill-validation-$(date +%Y%m%d-%H%M%S).log
```
