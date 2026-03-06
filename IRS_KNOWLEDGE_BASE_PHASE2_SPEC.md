# IRS Knowledge Base — Phase 2: Pipeline Integration

**Priority: P0 — Accuracy enforcement goes live**
**Branch: `feature/irs-validator-pipeline`**
**Depends on: PR #169 merged (Phase 1)**

---

## What Phase 2 Does

Phase 1 built the knowledge base and validator. It exists but nothing calls it yet.

Phase 2 wires the validator into the live extraction pipeline so that:

1. Every document that gets extracted is automatically validated
2. Validation results are written to the database as ledger events
3. Aegis surfaces failed checks as HIGH priority findings
4. The spread route checks validation status before rendering
5. Spreads from unverified documents render with a warning banner

**After Phase 2, Buddy cannot silently serve a spread built on bad extraction.**

---

## Files To Create or Modify

### FILE 1 (CREATE): `src/lib/irsKnowledge/pipelineIntegration.ts`

This is the glue layer. Called by the extraction job after facts are written.

```typescript
import "server-only";
import { validateDocumentFacts, isSpreadGenerationAllowed } from "./identityValidator";
import { getFormSpec } from "./index";
import type { IrsFormType } from "./types";

/**
 * Run IRS identity validation on a just-extracted document.
 *
 * Called by the extraction pipeline after facts are written to deal_financial_facts.
 * Writes results as a ledger event and returns the validation result.
 *
 * @param documentId - UUID of the document just extracted
 * @param formType - IRS form type detected during classification
 * @param taxYear - Tax year of the document
 * @param facts - The extracted fact map (canonical key → numeric value)
 * @param dealId - Deal UUID for ledger event
 * @param supabase - Supabase client (service role)
 */
export async function runPostExtractionValidation(
  documentId: string,
  formType: IrsFormType,
  taxYear: number,
  facts: Record<string, number | null>,
  dealId: string,
  supabase: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
) {
  const spec = getFormSpec(formType, taxYear);

  // No spec for this form type yet — skip validation, don't block
  if (!spec) {
    await writeLedgerEvent(supabase, dealId, documentId, {
      event: "extraction.validation.skipped",
      reason: `No form spec for ${formType} ${taxYear}`,
      status: "PARTIAL",
    });
    return { status: "PARTIAL" as const, allowed: true, requiresAnalystSignOff: false };
  }

  const result = validateDocumentFacts(documentId, spec, facts);

  // Write to ledger
  await writeLedgerEvent(supabase, dealId, documentId, {
    event: "extraction.validation.complete",
    status: result.status,
    passedCount: result.passedCount,
    failedCount: result.failedCount,
    skippedCount: result.skippedCount,
    summary: result.summary,
    checkResults: result.checkResults,
  });

  // Write to deal_documents — update extraction_quality_status
  await supabase
    .from("deal_documents")
    .update({
      extraction_quality_status: result.status,
      extraction_validated_at: result.validatedAt,
      extraction_validation_summary: result.summary,
    })
    .eq("id", documentId);

  // If failed — write Aegis finding
  if (result.status === "BLOCKED" || result.status === "FLAGGED") {
    await writeAegisFinding(supabase, dealId, documentId, result);
  }

  const gate = isSpreadGenerationAllowed([result]);

  return {
    status: result.status,
    allowed: gate.allowed,
    requiresAnalystSignOff: gate.requiresAnalystSignOff,
    reason: gate.reason,
    checkResults: result.checkResults,
  };
}

async function writeLedgerEvent(
  supabase: any,
  dealId: string,
  documentId: string,
  payload: Record<string, unknown>,
) {
  await supabase.from("buddy_system_events").insert({
    deal_id: dealId,
    source: "irs_identity_validator",
    event_type: payload.event ?? "extraction.validation.complete",
    payload: { documentId, ...payload },
    created_at: new Date().toISOString(),
  }).throwOnError().catch(() => {
    // Non-fatal — telemetry must never block extraction
  });
}

async function writeAegisFinding(
  supabase: any,
  dealId: string,
  documentId: string,
  result: import("./types").DocumentValidationResult,
) {
  const failedChecks = result.checkResults
    .filter(r => !r.skipped && !r.passed)
    .map(r => `${r.checkId}: delta $${r.delta?.toFixed(0)} (tolerance $${r.toleranceDollars})`)
    .join("; ");

  await supabase.from("deal_findings").insert({
    deal_id: dealId,
    source: "irs_identity_validator",
    severity: result.status === "BLOCKED" ? "HIGH" : "MEDIUM",
    category: "EXTRACTION_ACCURACY",
    title: `IRS Identity Check ${result.status}: ${result.formType} ${result.taxYear}`,
    description: `${result.summary} Failed checks: ${failedChecks}`,
    document_id: documentId,
    status: "open",
    created_at: new Date().toISOString(),
  }).throwOnError().catch(() => {
    // Non-fatal
  });
}
```

---

### FILE 2 (MODIFY): `src/lib/financialSpreads/spreadGate.ts`

**This file likely doesn't exist yet — create it.**

The spread gate checks validation status before allowing spread rendering.

```typescript
import "server-only";

export type SpreadGateResult = {
  allowed: boolean;
  requiresAnalystSignOff: boolean;
  verifiedCount: number;
  flaggedCount: number;
  blockedCount: number;
  partialCount: number;
  reason: string;
};

/**
 * Determine whether a spread can be rendered for a deal.
 *
 * Queries deal_documents for extraction_quality_status of all
 * financial documents associated with the deal.
 *
 * Policy:
 *   Any BLOCKED document → spread not allowed
 *   Any FLAGGED document → spread allowed but requires analyst sign-off
 *   All VERIFIED or PARTIAL → spread allowed
 *
 * @param dealId - Deal UUID
 * @param supabase - Supabase client
 */
export async function checkSpreadGate(
  dealId: string,
  supabase: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
): Promise<SpreadGateResult> {
  const { data: docs, error } = await supabase
    .from("deal_documents")
    .select("id, extraction_quality_status, document_type")
    .eq("deal_id", dealId)
    .not("extraction_quality_status", "is", null);

  if (error || !docs || docs.length === 0) {
    // No validated documents — allow spread but note no verification
    return {
      allowed: true,
      requiresAnalystSignOff: false,
      verifiedCount: 0,
      flaggedCount: 0,
      blockedCount: 0,
      partialCount: 0,
      reason: "No validated documents found. Spread unverified.",
    };
  }

  const verifiedCount = docs.filter(d => d.extraction_quality_status === "VERIFIED").length;
  const flaggedCount = docs.filter(d => d.extraction_quality_status === "FLAGGED").length;
  const blockedCount = docs.filter(d => d.extraction_quality_status === "BLOCKED").length;
  const partialCount = docs.filter(d => d.extraction_quality_status === "PARTIAL").length;

  if (blockedCount > 0) {
    return {
      allowed: false,
      requiresAnalystSignOff: false,
      verifiedCount, flaggedCount, blockedCount, partialCount,
      reason: `${blockedCount} document(s) failed IRS identity validation. Extraction must be corrected before spread can render.`,
    };
  }

  if (flaggedCount > 0) {
    return {
      allowed: true,
      requiresAnalystSignOff: true,
      verifiedCount, flaggedCount, blockedCount, partialCount,
      reason: `${flaggedCount} document(s) require analyst verification. Spread is for internal review only — not for distribution.`,
    };
  }

  return {
    allowed: true,
    requiresAnalystSignOff: false,
    verifiedCount, flaggedCount, blockedCount, partialCount,
    reason: `All ${verifiedCount} document(s) verified.`,
  };
}
```

---

### FILE 3 (MODIFY): Extraction job — call validator after facts are written

Find the file that runs after financial facts are written to the database.
It is likely one of:
- `src/lib/extraction/extractFinancialFacts.ts`
- `src/lib/jobs/spreads/processSpreadJob.ts`
- `src/app/api/deals/[dealId]/re-extract/route.ts`

Search for where `deal_financial_facts` is written and add this call immediately after:

```typescript
// After facts are written — run IRS identity validation
import { runPostExtractionValidation } from "@/lib/irsKnowledge/pipelineIntegration";

// Map extracted facts to canonical key format
const factMap: Record<string, number | null> = {};
for (const fact of writtenFacts) {
  factMap[fact.fact_key] = fact.fact_value_num;
}

// Determine form type from document classification
const formType = mapDocumentTypeToIrsFormType(document.document_type);
const taxYear = extractTaxYearFromDocument(document);

if (formType && taxYear) {
  // Non-blocking — validation must never break extraction
  runPostExtractionValidation(
    document.id,
    formType,
    taxYear,
    factMap,
    dealId,
    supabase,
  ).catch(err => {
    console.warn("[IRS Validator] Post-extraction validation failed:", err);
  });
}
```

Add these helper functions in the same file:

```typescript
function mapDocumentTypeToIrsFormType(
  documentType: string,
): import("@/lib/irsKnowledge/types").IrsFormType | null {
  const map: Record<string, import("@/lib/irsKnowledge/types").IrsFormType> = {
    "TAX_RETURN_1065":   "FORM_1065",
    "TAX_RETURN_1120":   "FORM_1120",
    "TAX_RETURN_1120S":  "FORM_1120S",
    "TAX_RETURN_1040":   "FORM_1040",
    "SCHEDULE_C":        "SCHEDULE_C",
    "SCHEDULE_E":        "SCHEDULE_E",
    "K1":                "SCHEDULE_K1_1065",
    "AUDITED_FINANCIALS":"AUDITED_FINANCIALS",
    "REVIEWED_FINANCIALS":"REVIEWED_FINANCIALS",
    "COMPILED_FINANCIALS":"COMPILED_FINANCIALS",
  };
  return map[documentType] ?? null;
}

function extractTaxYearFromDocument(document: { tax_year?: number; period_end?: string }): number | null {
  if (document.tax_year) return document.tax_year;
  if (document.period_end) return new Date(document.period_end).getFullYear();
  return null;
}
```

---

### FILE 4 (MODIFY): Spread API route — enforce gate

Find `src/app/api/deals/[dealId]/spreads/standard/route.ts`

At the top of the GET handler, add:

```typescript
import { checkSpreadGate } from "@/lib/financialSpreads/spreadGate";

// Inside GET handler, before building the spread:
const gate = await checkSpreadGate(dealId, supabase);

if (!gate.allowed) {
  return NextResponse.json(
    {
      error: "SPREAD_BLOCKED",
      reason: gate.reason,
      blockedCount: gate.blockedCount,
    },
    { status: 422 }
  );
}

// Attach gate status to response so UI can show banner
// Add to the spread response object:
// verificationStatus: { ...gate }
```

---

## Database Migration Required

Add two columns to `deal_documents`:

```sql
ALTER TABLE deal_documents
  ADD COLUMN IF NOT EXISTS extraction_quality_status TEXT
    CHECK (extraction_quality_status IN ('VERIFIED','FLAGGED','BLOCKED','PARTIAL')),
  ADD COLUMN IF NOT EXISTS extraction_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_validation_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_deal_documents_quality_status
  ON deal_documents(deal_id, extraction_quality_status);

COMMENT ON COLUMN deal_documents.extraction_quality_status IS
  'IRS identity validation result: VERIFIED=all checks pass, FLAGGED=some failed/needs analyst, BLOCKED=spread cannot render, PARTIAL=insufficient data to verify';
```

**Write this as a migration file:**
`supabase/migrations/[timestamp]_add_extraction_quality_status.sql`

---

## Tests Required

Create `src/lib/irsKnowledge/__tests__/pipelineIntegration.test.ts`

```typescript
// Test 1: VERIFIED document — spread allowed, no sign-off required
// Test 2: FLAGGED document — spread allowed, analyst sign-off required
// Test 3: BLOCKED document — spread not allowed, returns 422
// Test 4: Mixed (VERIFIED + FLAGGED) — spread allowed with sign-off
// Test 5: No validated documents — spread allowed with warning
```

---

## Acceptance Criteria

- [ ] Migration runs clean
- [ ] Validator fires automatically after every extraction job
- [ ] BLOCKED documents produce Aegis HIGH finding
- [ ] Spread route returns 422 for BLOCKED documents
- [ ] Spread route returns `verificationStatus` in response for UI banner
- [ ] `tsc --noEmit` clean
- [ ] All tests pass
- [ ] PR title: `feat: IRS Validator — live pipeline enforcement (Phase 2)`

---

## What This Achieves

After Phase 2 merges:

- Every document that gets extracted is automatically checked against IRS math
- Extraction errors that violate accounting identities are caught immediately
- The Samaritus OBI-as-revenue bug would have been caught automatically on first extraction
- Spreads built on bad data are blocked before they reach a banker
- The audit trail exists — every validation result is in the ledger

**This is the point where Buddy stops being a best-effort system and becomes an accuracy-enforced system.**
