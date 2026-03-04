# Spec: Fix Matching Tie + Manual Correction Signal Loss

**Tracking:** PTR/BTR documents not routing to cockpit after intake processing  
**Severity:** Critical — affects every year-specific tax return on every deal  
**Files touched:** 2 TypeScript files, no migrations, no schema changes

---

## Background

Two bugs are working in combination. Every year-specific tax return (BTR 2022, BTR 2023, PTR 2022, PTR 2023) routes to review instead of auto-attaching in the cockpit. The 2024 tax returns work by accident because no year-specific 2024 slot exists yet. Income statements and balance sheets are unaffected.

Additionally, manually corrected documents (e.g. AI classified PTR 2022 as BTR, banker corrects it) lose the correction signal when the processing engine re-runs matching, causing the stale AI classification to be used.

---

## Bug 1 — Year-Specific/Year-Agnostic Slot Tie (affects ALL year-specific tax returns)

### Location
`src/lib/intake/matching/matchEngine.ts` → `matchDocumentToSlot()`

### Root Cause
The slot policy creates two kinds of tax return slots per type:
- **Year-agnostic:** `BTR_MOST_RECENT`, `PTR_MOST_RECENT` — `required_tax_year = null`
- **Year-specific:** `BTR_2022`, `BTR_2023`, `PTR_2022`, `PTR_2023` — `required_tax_year = <year>`

In `constraints.ts`, `checkTaxYearMatch` treats `required_tax_year = null` as "no year requirement → satisfied for any document." This is correct behavior on its own.

The problem is in disambiguation. When matching a document with a known year (e.g. BTR year=2022):
- `BTR_MOST_RECENT` passes all constraints (year-agnostic slot accepts any year)
- `BTR_2022` passes all constraints (exact year match)

This produces **2 candidates**. The engine's current disambiguation:
```typescript
// >1 candidates → routed_to_review (ties escalate)
return { decision: "routed_to_review", ... };
```

This is a **guaranteed tie, every time, for every year-specific tax return doc.** The only docs that escape it are the most-recent-year ones (2024 as of March 2026) because no year-specific 2024 slot exists yet.

### The Fix
Add a year-specificity tiebreaker **before** the generic tie escalation. When exactly one candidate has a `required_tax_year` matching the document's year, that slot wins. The year-agnostic "most recent" slot is the fallback, not the winner, when a year-specific slot exists.

#### Exact Change — `src/lib/intake/matching/matchEngine.ts`

In `matchDocumentToSlot()`, locate the disambiguation block (Step 3) and insert the tiebreaker between the `candidates.length === 1` branch and the final `routed_to_review` return:

```typescript
  // ── Step 3: Disambiguation ──────────────────────────────────────────

  // 0 candidates → no_match
  if (candidates.length === 0) {
    return {
      decision: "no_match",
      slotId: null,
      slotKey: null,
      confidence: identity.confidence,
      evidence: buildEvidence(identity, [], [], slotPolicyVersion),
      reason: `No slot satisfies constraints for "${identity.effectiveDocType}"`,
    };
  }

  // 1 candidate → auto_attached
  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      decision: "auto_attached",
      slotId: c.slot.slotId,
      slotKey: c.slot.slotKey,
      confidence: identity.confidence,
      evidence: buildEvidence(
        identity,
        c.constraints,
        c.negativeRules,
        slotPolicyVersion,
      ),
      reason: `Matched to slot "${c.slot.slotKey}"`,
    };
  }

  // ── NEW: Year-specificity tiebreaker ───────────────────────────────
  // When a document has a known tax year AND there are multiple candidates,
  // prefer the year-specific slot over year-agnostic ("most recent") slots.
  // A document with year=2022 belongs in slot PTR_2022, not PTR_MOST_RECENT.
  // Only fires when exactly one year-specific candidate exists — true ambiguity
  // (e.g. two year-specific slots for same year) still escalates to review.
  if (candidates.length > 1 && identity.taxYear != null) {
    const yearSpecificCandidates = candidates.filter(
      (c) => c.slot.requiredTaxYear != null,
    );
    if (yearSpecificCandidates.length === 1) {
      const c = yearSpecificCandidates[0];
      return {
        decision: "auto_attached",
        slotId: c.slot.slotId,
        slotKey: c.slot.slotKey,
        confidence: identity.confidence,
        evidence: buildEvidence(
          identity,
          c.constraints,
          c.negativeRules,
          slotPolicyVersion,
        ),
        reason: `Year-specific slot "${c.slot.slotKey}" preferred over ${candidates.length - 1} year-agnostic candidate(s) — doc year ${identity.taxYear}`,
      };
    }
  }
  // ── END year-specificity tiebreaker ───────────────────────────────

  // >1 candidates → routed_to_review (true tie — escalate)
  return {
    decision: "routed_to_review",
    slotId: null,
    slotKey: null,
    confidence: identity.confidence,
    evidence: buildEvidence(identity, [], [], slotPolicyVersion),
    reason: `${candidates.length} candidate slots — tie escalated to review`,
  };
```

---

## Bug 2 — Manual Correction Signal Lost in Processing Engine

### Location
`src/lib/intake/processing/processConfirmedIntake.ts` → `processOneDoc()`

### Root Cause
When a banker corrects a document's type during intake review (e.g. BTR → PTR), the confirm route correctly:
1. Updates `canonical_type` and `checklist_key` on `deal_documents`
2. Sets `match_source = "manual"` on the document
3. Calls `runMatchForDocument` with `matchSource: "manual"` and `confidence: 1.0` → correctly attaches to the right slot

Then `processConfirmedIntake` fires. Its `SELECT` never includes `match_source`:

```typescript
// CURRENT — missing match_source
.select(
  `id, canonical_type, document_type, original_filename,
   ai_doc_type, ai_confidence, ai_tax_year, ai_form_numbers,
   classification_tier,
   gatekeeper_doc_type, gatekeeper_route, gatekeeper_confidence,
   gatekeeper_needs_review, gatekeeper_tax_year`,
)
```

So `processOneDoc` has no way to know the doc was manually corrected. It re-builds spine/gatekeeper signals from `ai_doc_type` (which is still `BUSINESS_TAX_RETURN` — the wrong AI call) and calls `runMatchForDocument` with no `matchSource`.

Then `runMatch.ts` Step 0b runs:
```typescript
// Releases the correctly-attached slot before re-matching
if (existingSlotId) {
  // deactivates attachment, resets slot to empty, clears slot_id
}
```

Now re-matching runs with stale BTR signals, no `matchSource: "manual"`, probabilistic authority, and a confidence that was wrong to begin with. The doc either ties into review (Bug 1) or gets hard-blocked by `BTR_NOT_PTR` negative rule since the rebuilt identity still says BTR.

### The Fix
Two changes to `processConfirmedIntake.ts`:

1. Add `match_source` to the select query
2. When `match_source === "manual"`, reconstruct the gatekeeper signals from `canonical_type` (the corrected value) instead of from stale AI fields, and pass `matchSource: "manual"`

#### Exact Change — `src/lib/intake/processing/processConfirmedIntake.ts`

**Change 1: Add `match_source` to the `ConfirmedDoc` type:**

```typescript
// BEFORE
type ConfirmedDoc = {
  id: string;
  canonical_type: string | null;
  document_type: string | null;
  original_filename: string | null;
  ai_doc_type: string | null;
  ai_confidence: number | null;
  ai_tax_year: number | null;
  ai_form_numbers: string[] | null;
  classification_tier: string | null;
  gatekeeper_doc_type: string | null;
  gatekeeper_route: string | null;
  gatekeeper_confidence: number | null;
  gatekeeper_needs_review: boolean | null;
  gatekeeper_tax_year: number | null;
};

// AFTER
type ConfirmedDoc = {
  id: string;
  canonical_type: string | null;
  document_type: string | null;
  original_filename: string | null;
  ai_doc_type: string | null;
  ai_confidence: number | null;
  ai_tax_year: number | null;
  ai_form_numbers: string[] | null;
  classification_tier: string | null;
  gatekeeper_doc_type: string | null;
  gatekeeper_route: string | null;
  gatekeeper_confidence: number | null;
  gatekeeper_needs_review: boolean | null;
  gatekeeper_tax_year: number | null;
  match_source: string | null;   // ← ADD
};
```

**Change 2: Add `match_source` to the `.select()` call:**

```typescript
// BEFORE
const { data: docs, error: loadErr } = await (sb as any)
  .from("deal_documents")
  .select(
    `id, canonical_type, document_type, original_filename,
     ai_doc_type, ai_confidence, ai_tax_year, ai_form_numbers,
     classification_tier,
     gatekeeper_doc_type, gatekeeper_route, gatekeeper_confidence,
     gatekeeper_needs_review, gatekeeper_tax_year`,
  )
  ...

// AFTER
const { data: docs, error: loadErr } = await (sb as any)
  .from("deal_documents")
  .select(
    `id, canonical_type, document_type, original_filename,
     ai_doc_type, ai_confidence, ai_tax_year, ai_form_numbers,
     classification_tier,
     gatekeeper_doc_type, gatekeeper_route, gatekeeper_confidence,
     gatekeeper_needs_review, gatekeeper_tax_year,
     match_source`,
  )
  ...
```

**Change 3: In `processOneDoc`, branch on `match_source` when building signals for `runMatchForDocument`:**

```typescript
// BEFORE (inside processOneDoc, in the "2a. Matching" block)
const spineSignals = doc.ai_doc_type
  ? {
      docType: doc.ai_doc_type,
      confidence: doc.ai_confidence ?? 0,
      spineTier: doc.classification_tier ?? "fallback",
      taxYear: doc.ai_tax_year,
      entityType: null,
      formNumbers: doc.ai_form_numbers ?? [],
      evidence: [],
    }
  : null;

const gkSignals = doc.gatekeeper_doc_type
  ? {
      docType: doc.gatekeeper_doc_type,
      confidence: doc.gatekeeper_confidence ?? 0,
      taxYear: doc.gatekeeper_tax_year ?? null,
      formNumbers: [] as string[],
      effectiveDocType,
    }
  : null;

const matchResult = await runMatchForDocument({
  dealId,
  bankId,
  documentId: doc.id,
  spine: spineSignals,
  gatekeeper: gkSignals,
  ocrText: null,
  filename: doc.original_filename ?? null,
});

// AFTER
const isManualCorrection = doc.match_source === "manual";

// For manually corrected docs: discard stale AI signals entirely.
// Use canonical_type (the banker's corrected value) at confidence 1.0.
// For AI-classified docs: use spine + gatekeeper signals as before.
const spineSignals = (!isManualCorrection && doc.ai_doc_type)
  ? {
      docType: doc.ai_doc_type,
      confidence: doc.ai_confidence ?? 0,
      spineTier: doc.classification_tier ?? "fallback",
      taxYear: doc.ai_tax_year,
      entityType: null,
      formNumbers: doc.ai_form_numbers ?? [],
      evidence: [],
    }
  : null;

const gkSignals = isManualCorrection
  ? {
      // Rebuild from the banker's corrected canonical_type, not stale AI gatekeeper
      docType: effectiveDocType,
      effectiveDocType,
      confidence: 1.0,
      taxYear: doc.ai_tax_year ?? doc.gatekeeper_tax_year ?? null,
      formNumbers: [] as string[],
    }
  : doc.gatekeeper_doc_type
    ? {
        docType: doc.gatekeeper_doc_type,
        confidence: doc.gatekeeper_confidence ?? 0,
        taxYear: doc.gatekeeper_tax_year ?? null,
        formNumbers: [] as string[],
        effectiveDocType,
      }
    : null;

const matchResult = await runMatchForDocument({
  dealId,
  bankId,
  documentId: doc.id,
  spine: spineSignals,
  gatekeeper: gkSignals,
  ocrText: null,
  filename: doc.original_filename ?? null,
  matchSource: isManualCorrection ? "manual" : null,
});
```

---

## Implementation Checklist

- [ ] `src/lib/intake/matching/matchEngine.ts` — add year-specificity tiebreaker in `matchDocumentToSlot()` (Bug 1)
- [ ] `src/lib/intake/processing/processConfirmedIntake.ts` — add `match_source` to `ConfirmedDoc` type (Bug 2)
- [ ] `src/lib/intake/processing/processConfirmedIntake.ts` — add `match_source` to `.select()` call (Bug 2)
- [ ] `src/lib/intake/processing/processConfirmedIntake.ts` — branch on `isManualCorrection` in `processOneDoc` (Bug 2)

---

## What NOT to Change

- `constraints.ts` — `checkTaxYearMatch` treating `required_tax_year = null` as "no requirement" is correct behavior. The fix is in disambiguation, not constraints.
- `negativeRules.ts` — no changes needed
- `runMatch.ts` Step 0b (slot release before re-match) — this is correct behavior for the general case; the fix is to pass the right signals so re-matching produces the right result
- No database migrations required
- No schema changes required

---

## Expected Outcome After Fix

| Document | Before | After |
|---|---|---|
| BTR SAMARITUS 2022 | `routed_to_review` (tie) | `auto_attached` → BTR_2022 slot |
| BTR SAMARITUS 2023 | `routed_to_review` (tie) | `auto_attached` → BTR_2023 slot |
| BTR SAMARITUS 2024 | `auto_attached` ✓ | `auto_attached` ✓ (unchanged) |
| PTR 2022 NEWMARK FAMILY (corrected) | `routed_to_review` (tie + stale AI signals) | `auto_attached` → PTR_2022 slot |
| PTR 2023 NEWMARK | `routed_to_review` (tie) | `auto_attached` → PTR_2023 slot |
| PTR 2024 NEWMARK MICHAEL | `auto_attached` ✓ | `auto_attached` ✓ (unchanged) |
| Income Statement / Balance Sheet | `auto_attached` ✓ | `auto_attached` ✓ (unchanged) |

Personal Tax Returns checklist item should advance from "Need 1 more year" to "Received" once PTR 2022 fills its slot.
