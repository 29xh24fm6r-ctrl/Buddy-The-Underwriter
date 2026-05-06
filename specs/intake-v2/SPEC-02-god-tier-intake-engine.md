# SPEC-INTAKE-V2 — God-Tier Intake Engine

**Path when committed:** `specs/intake-v2/SPEC-02-god-tier-intake-engine.md`
**Status:** Ready for implementation planning
**Owner:** Matt — architecture / Claude Code — implementation
**Branch:** `main`
**Primary objective:** Convert Buddy Intake from a strong institutional pipeline into an elite, self-directing intake engine that reliably drives deals from upload chaos to credit-ready package.

---

## 1. Executive summary

Buddy’s intake architecture is already strong: deterministic document slots, scenario-aware requirements, gatekeeper classification, slot matching, intake confirmation, processing heartbeats, audit ledger events, and partial recovery mechanics. The gap is not conceptual architecture. The gap is operational execution and intelligence.

The current system behaves like a structured pipeline. The target system must behave like an expert intake operator.

This spec combines Claude’s operational rescue plan with three additional upgrades required for a true god-tier intake engine:

1. **Operational fixes** — eliminate zombie states, BTR review bottlenecks, missing slots, silent orchestrator failures, and opaque review queues.
2. **Intake Brain** — introduce a deterministic reasoning layer that evaluates the deal package, identifies blockers, and generates next best actions.
3. **Readiness Intelligence** — convert raw document completeness into credit-aware readiness, including risk-weighted blockers, minimum viable package detection, and banker-facing guidance.

This spec is intentionally surgical. It does not replace the lifecycle model, does not introduce a new database architecture, and does not require new core tables. It strengthens the existing engine and adds a high-value intelligence layer on top.

---

## 2. Current problem

Recent production review showed a sharp gap between code quality and operational outcomes.

The architecture is institutional-grade, but production behavior is leaking deals into dead zones:

* Deals stuck in `CLASSIFIED_PENDING_CONFIRMATION`
* Deals stuck in `BULK_UPLOADED` with zero documents
* Business Tax Returns over-routed to manual review
* Slot generation missing on a meaningful share of deals
* Orchestrator steps soft-failing while returning `ok: true`
* Bankers seeing opaque review flags with no useful resolution path
* Completed deals not always having full slot/fact coverage

The result: Buddy may have elite plumbing, but it does not yet force operational excellence.

---

## 3. Target state

The target engine should do the following:

1. Accept messy banker or borrower uploads.
2. Classify documents with strong deterministic + AI fallback behavior.
3. Generate required slots for every deal, even with incomplete scenario data.
4. Match documents to requirements with explainable evidence.
5. Route only genuinely ambiguous documents to review.
6. Coach bankers through review resolution with OCR evidence and one-click confirmations.
7. Detect abandoned shells and remove them from active work queues.
8. Produce a single authoritative intake run summary after each material intake event.
9. Generate next best actions that tell the banker or borrower exactly what to do next.
10. Compute credit-aware readiness, not just checklist completeness.

The system should answer, at all times:

> What do we have, what is missing, what matters most, who needs to act, and what is the next best action?

---

## 4. Non-negotiable design principles

### 4.1 No new lifecycle model

Do not rewrite `src/buddy/lifecycle/model.ts`. This spec strengthens intake without changing the downstream lifecycle contract.

### 4.2 Ledger-first observability

Important intake decisions must write ledger/events. Mutable columns may remain for query speed, but the ledger should explain why the engine did what it did.

### 4.3 Deterministic before generative

AI may classify, summarize, and explain. It must not be the only source of truth for required documents, slot satisfaction, readiness state, or blocker severity.

### 4.4 Fail closed on critical steps

A critical intake failure must make `ok = false`. Non-critical enrichment may soft-fail, but the engine cannot claim success when critical work failed.

### 4.5 Banker UX must be resolution-oriented

Never show “needs review” without showing why, what the likely answers are, and what button resolves it.

### 4.6 No silent zero-slot completion

A deal may not quietly appear healthy if it has no deterministic intake slots.

---

# PART A — Mandatory pre-implementation verification

All PIV outputs must be pasted into the AAR before implementation begins.

## PIV-1 — Confirm BTR confidence pattern persists

Run:

```sql
SELECT
  canonical_type,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE gatekeeper_needs_review = true) AS needs_review,
  ROUND(AVG(gatekeeper_confidence)::numeric, 2) AS avg_conf,
  ROUND(MIN(gatekeeper_confidence)::numeric, 2) AS min_conf,
  ROUND(MAX(gatekeeper_confidence)::numeric, 2) AS max_conf
FROM deal_documents
WHERE is_active = true
  AND gatekeeper_classified_at IS NOT NULL
  AND created_at > NOW() - INTERVAL '30 days'
  AND canonical_type IN ('BUSINESS_TAX_RETURN', 'PERSONAL_TAX_RETURN')
GROUP BY canonical_type;
```

Expected:

* BTR avg confidence below `0.75`
* BTR needs-review rate at or above `50%`
* PTR avg confidence at or above `0.95`
* PTR needs-review rate at or below `10%`

If BTR confidence has already drifted above `0.85`, pause Fix 1 and report.

## PIV-2 — Confirm orchestrator soft-fail behavior

Run:

```bash
grep -n "ok: true" src/lib/intake/orchestrateIntake.ts | head -5
grep -n "diagnostics.steps.push" src/lib/intake/orchestrateIntake.ts
```

Expected:

* Final result returns `ok: true` unconditionally or too broadly.
* `step()` logs failures but does not propagate critical failure.

## PIV-3 — Confirm slot generation call chain

Run:

```bash
grep -n "ensureDeterministicSlots\|ensureCoreDocumentSlots" src/lib/intake/seedIntakePrereqsCoreImpl.ts
grep -n "ensureDeterministicSlots\|ensureCoreDocumentSlots" src/lib/intake/orchestrateIntake.ts
```

Expected:

* Seeder references slot generation.
* Orchestrator relies on seeder rather than directly asserting slots.
* Document the actual call chain.

## PIV-4 — Confirm slot generation failure rate

Run:

```sql
WITH recent AS (
  SELECT id, created_at FROM deals
  WHERE created_at > NOW() - INTERVAL '30 days'
)
SELECT
  CASE
    WHEN slots = 0 THEN 'NO_SLOTS'
    ELSE 'HAS_SLOTS'
  END AS bucket,
  COUNT(*) AS deals
FROM (
  SELECT
    r.id,
    (SELECT COUNT(*) FROM deal_document_slots WHERE deal_id = r.id) AS slots
  FROM recent r
) sub
GROUP BY bucket;
```

Expected:

* At least `30%` of recent deals in `NO_SLOTS`.
* If `NO_SLOTS < 5%`, slot generation may have self-healed; still add assertion.

## PIV-5 — Confirm `INTAKE_ABANDONED` not already present

Run:

```bash
grep -rn "INTAKE_ABANDONED" src/lib/intake/ src/buddy/lifecycle/ src/lib/deals/
```

Expected: zero hits.

## PIV-6 — Inspect BTR prompt bottleneck

Open:

```bash
sed -n '30,80p' src/lib/gatekeeper/geminiClassifierPure.ts
```

Expected:

* `BUSINESS_TAX_RETURN` prompt conflates 1120, 1120-S, and 1065.
* Confidence rules penalize uncertain sub-flavor even when the document is clearly an entity tax return.

## PIV-7 — Confirm full coverage examples

Run:

```sql
SELECT
  d.id,
  d.display_name,
  (SELECT COUNT(*) FROM deal_documents WHERE deal_id = d.id AND is_active = true) AS docs,
  (SELECT COUNT(*) FROM deal_document_slots WHERE deal_id = d.id) AS slots,
  (SELECT COUNT(*) FROM deal_document_slots WHERE deal_id = d.id AND status != 'empty') AS filled,
  (SELECT COUNT(*) FROM deal_financial_facts WHERE deal_id = d.id AND is_superseded = false) AS facts
FROM deals d
WHERE d.created_at > NOW() - INTERVAL '60 days'
  AND d.intake_phase = 'PROCESSING_COMPLETE'
ORDER BY filled DESC, facts DESC
LIMIT 5;
```

Expected:

* Top 1–2 deals have strong coverage.
* Others may show partial coverage despite `PROCESSING_COMPLETE`.

## PIV-8 — Locate active-deal surfaces

Run:

```bash
grep -rn "from(\"deals\")\|from('deals')\|intake_phase\|BULK_UPLOADED" src/app src/components src/lib | head -100
```

Expected:

* Produce list of deal listing surfaces that need `INTAKE_ABANDONED` filtering.

## PIV-9 — Locate orchestrator call sites

Run:

```bash
grep -rn "orchestrateIntake(" src/app src/lib src/components
```

Expected:

* Every caller listed in AAR.
* Any caller ignoring `result.ok` must be fixed.

---

# PART B — Operational fixes

## Fix 1 — BTR confidence rebalance

### Problem

Business Tax Returns are being over-routed to manual review because the classifier appears to conflate two questions:

1. Is this a business/entity tax return?
2. Which exact sub-flavor is it: 1120, 1120-S, or 1065?

The first question determines intake routing. The second question is downstream extraction metadata.

### Fix 1a — Prompt clarification

Edit:

```text
src/lib/gatekeeper/geminiClassifierPure.ts
```

Update `SYSTEM_PROMPT` under `BUSINESS_TAX_RETURN`:

```text
When the document is clearly an entity tax return — 1120, 1120-S, or 1065 family — but the specific form variant is uncertain, classify as BUSINESS_TAX_RETURN with confidence >= 0.85 if entity-tax-return signals are strong, including entity name, EIN, business income/expense schedules, K-1 references, or business return form structure.

Sub-flavor belongs in form_numbers and downstream extraction. Confidence should reflect whether this is an entity tax return, not whether the exact variant is perfectly identified.
```

Update confidence rules:

```text
Confidence applies to doc_type, not sub-flavor identification. A document confidently identified as an entity tax return should score >= 0.85 even if the exact form variant is ambiguous.
```

Bump:

```ts
GEMINI_PROMPT_VERSION = "gemini_classifier_v3"
```

### Fix 1b — BTR routing exception

Edit:

```text
src/lib/gatekeeper/routing.ts
```

In `computeGatekeeperRoute`, add a BTR-only exception:

```ts
const isModerateConfidenceBtr =
  docType === "BUSINESS_TAX_RETURN" &&
  confidence >= 0.70 &&
  confidence < 0.80 &&
  detectedSignals?.has_ein === true &&
  Array.isArray(detectedSignals?.form_numbers) &&
  detectedSignals.form_numbers.length > 0 &&
  taxYear !== null;

if (isModerateConfidenceBtr) {
  return {
    route: "GOOGLE_DOC_AI_CORE",
    needs_review: false,
    evidence_tier: "moderate_with_signals",
    reason: "Business tax return accepted below normal confidence threshold because EIN, form number, and tax year corroborate the classification.",
  };
}
```

Comment block required:

```ts
/**
 * BTR-specific exception:
 * For entity tax returns, intake routing only needs to know that the document is
 * a business tax return family member. Exact sub-flavor is downstream extraction.
 * A moderate classifier score with EIN + form number + tax year is stronger
 * operational evidence than raw confidence alone.
 */
```

Do not lower the global threshold.

### Fix 1c — Backfill existing BTRs

Migration name:

```text
intake_v2_btr_routing_backfill
```

Migration:

```sql
BEGIN;

SET LOCAL statement_timeout = '60s';

UPDATE deal_documents
SET
  gatekeeper_needs_review = false,
  gatekeeper_review_reason_code = NULL,
  gatekeeper_reasons = COALESCE(gatekeeper_reasons, '[]'::jsonb) || jsonb_build_array(
    'Backfilled by intake_v2_btr_routing_backfill: BTR accepted under moderate_with_signals exception.'
  ),
  updated_at = NOW()
WHERE canonical_type = 'BUSINESS_TAX_RETURN'
  AND gatekeeper_needs_review = true
  AND gatekeeper_confidence >= 0.70
  AND gatekeeper_confidence < 0.80
  AND gatekeeper_signals->>'has_ein' = 'true'
  AND gatekeeper_form_numbers IS NOT NULL
  AND ARRAY_LENGTH(gatekeeper_form_numbers, 1) > 0
  AND gatekeeper_tax_year IS NOT NULL
  AND bank_id IN (SELECT id FROM banks WHERE active = true);

COMMIT;
```

Validation:

```sql
SELECT COUNT(*) FROM deal_documents
WHERE canonical_type = 'BUSINESS_TAX_RETURN'
  AND gatekeeper_needs_review = false
  AND gatekeeper_confidence < 0.80
  AND gatekeeper_signals->>'has_ein' = 'true'
  AND gatekeeper_form_numbers IS NOT NULL
  AND ARRAY_LENGTH(gatekeeper_form_numbers, 1) > 0
  AND gatekeeper_tax_year IS NOT NULL;
```

Expected: at least 20 rows, unless PIV proves otherwise.

---

## Fix 2 — Slot wire repair and structural assertion

### Problem

Some deals complete intake or move through intake without deterministic slots. This destroys the guided-readiness experience and makes the engine behave like a flat document list.

### Fix 2a — Repair slot generation

Read:

```text
src/lib/intake/seedIntakePrereqsCoreImpl.ts
src/lib/intake/slots/ensureDeterministicSlots.ts
src/lib/intake/orchestrateIntake.ts
```

Find why some deals get slots and others do not.

Likely causes:

* Missing scenario row
* Product type unset
* Quick Look branch skipping slot generation
* Early return in seeder
* Feature flag bypass
* Scenario-specific slot policy not falling back

Required behavior:

* Every normal intake deal gets deterministic slots.
* If scenario is missing, use `CONVENTIONAL_FALLBACK`.
* Single-entity deals must get slots even without scenario metadata.
* Quick Look behavior must be preserved if Quick Look intentionally uses minimal slots.
* Slot creation must be idempotent.

### Fix 2b — Structural assertion in processing

Edit:

```text
src/lib/intake/processing/processConfirmedIntake.ts
```

After `recomputeDealDocumentState`, before phase transition:

```ts
const { count: slotCount } = await sb
  .from("deal_document_slots")
  .select("id", { count: "exact", head: true })
  .eq("deal_id", dealId);

if ((slotCount ?? 0) === 0) {
  errors.push("structural: deal completed processing with zero slots");
  void writeEvent({
    dealId,
    kind: "intake.processing_no_slots",
    scope: "intake",
    requiresHumanReview: true,
    meta: {
      run_id: runId ?? null,
      docs_processed: confirmedDocs.length,
    },
  });
}
```

### Matt correction

For this PR, slot-zero is a ledger event and soft signal.

Future hardening requirement:

> Once false positives are ruled out, zero-slot processing should become a hard invariant. A normal intake deal with zero slots should not be considered successfully processed.

---

## Fix 3 — Orchestrator critical-step contract

### Problem

The orchestrator currently treats all failures as diagnostic noise. This lets the system appear successful when critical steps failed.

### Fix

Edit:

```text
src/lib/intake/orchestrateIntake.ts
```

Introduce critical/non-critical step sets:

```ts
const CRITICAL_STEPS = new Set([
  "ensure_checklist_seeded",
  "gatekeeper_classify",
  "advance_lifecycle",
]);

const NON_CRITICAL_STEPS = new Set([
  "classify_documents",
  "extract_borrower",
  "extract_principals",
  "ensure_financial_snapshot",
]);
```

Mutate `step()`:

```ts
const criticalFailures: string[] = [];

const step = async (
  name: string,
  fn: () => Promise<string | undefined>
) => {
  try {
    const status = await fn();
    diagnostics.steps.push({ name, ok: true, status });
  } catch (e: any) {
    const message = String(e?.message ?? e);
    diagnostics.steps.push({ name, ok: false, error: message });

    if (CRITICAL_STEPS.has(name)) {
      criticalFailures.push(`${name}: ${message}`);
    }

    // Preserve existing GOOGLE_UNKNOWN / ledger error behavior.
  }
};
```

Final return:

```ts
return {
  ok: criticalFailures.length === 0,
  criticalFailures: criticalFailures.length > 0 ? criticalFailures : undefined,
  dealId: args.dealId,
  bankId: args.bankId,
  diagnostics,
  borrowerDetected,
  principalsDetected,
  financialSnapshot,
  lifecycleAdvanced,
};
```

Update type:

```ts
export type OrchestrateIntakeResult = {
  ok: boolean;
  criticalFailures?: string[];
  dealId: string;
  bankId: string;
  diagnostics: IntakeDiagnostics;
  borrowerDetected?: unknown;
  principalsDetected?: unknown;
  financialSnapshot?: unknown;
  lifecycleAdvanced?: boolean;
};
```

Audit all call sites from PIV-9.

Any caller ignoring `result.ok` must be updated to fail loudly, show a banker-visible error, or write a ledger event.

---

## Fix 4 — Needs-review coaching surface

### Problem

The current review experience is opaque. Bankers see that Buddy needs review, but not enough evidence to resolve the issue quickly.

### Target UX

For every document with `gatekeeper_needs_review = true`, show a coaching card with:

* OCR snippet, first 400 characters
* Buddy’s top classification candidate
* Confidence
* One-sentence reason
* Up to 2 alternative candidates
* One-click confirm button for each candidate
* Optional “hide for this session” button

### Backend changes

#### Add alternatives to classifier response

Edit:

```text
src/lib/gatekeeper/geminiClassifierPure.ts
src/lib/gatekeeper/types.ts
src/lib/gatekeeper/runGatekeeper.ts
```

When confidence is below `0.80`, ask Gemini to provide:

```ts
alternatives: Array<{
  doc_type: string;
  confidence: number;
}>;
```

Normalize alternatives:

* Unknown or unsupported `doc_type` becomes `UNKNOWN`.
* Confidence is clamped to `[0, 1]`.
* Missing alternatives returns empty array.
* Maximum 2 alternatives.

#### Add column

Migration name:

```text
intake_v2_alternatives_column
```

SQL:

```sql
ALTER TABLE deal_documents
ADD COLUMN IF NOT EXISTS gatekeeper_alternatives jsonb DEFAULT '[]'::jsonb;
```

#### Update confirm route

Edit:

```text
src/app/api/deals/[dealId]/documents/[docId]/confirm-classification/route.ts
```

Accept payload:

```ts
{
  confirmed_doc_type: string;
  confirmed_from: "primary" | "alternative" | "manual_override";
}
```

Update document:

```ts
{
  intake_status: "USER_CONFIRMED",
  match_source: "manual",
  gatekeeper_needs_review: false,
  canonical_type: confirmed_doc_type,
  document_type: confirmed_doc_type,
  intake_confirmed_at: now,
  intake_confirmed_by: userIdOrRole,
}
```

Write ledger event:

```text
intake.classification_confirmed
```

Event meta:

```ts
{
  doc_id,
  confirmed_doc_type,
  confirmed_from,
  previous_doc_type,
  previous_confidence,
}
```

### Frontend changes

New component:

```text
src/components/deals/intake/NeedsReviewCoachingCard.tsx
```

Mount above the classification table in the intake review surface.

Component behavior:

* One card per needs-review document.
* Card collapses or disappears after successful confirmation.
* Shows OCR snippet in read-only monospace block.
* Shows primary and alternative candidates as action rows.
* One-click confirm posts to route.
* “Hide for this session” only hides locally; it does not resolve review.

---

## Fix 5 — Abandoned-deal terminal phase with controlled recovery

### Problem

Empty `BULK_UPLOADED` deal shells pollute active surfaces. They are not active intake work and should not sit beside real deals.

### Claude recommendation

Add `INTAKE_ABANDONED` as a terminal phase. Empty `BULK_UPLOADED` deals older than 24 hours are swept out of active views.

### Matt correction

Use `INTAKE_ABANDONED` to remove dead shells from active surfaces, but do not permanently block recovery yet.

Reason:

* Audit cleanliness matters.
* Banker experience also matters.
* A banker returning late to a link should not be forced into confusing duplicate-deal behavior unless we have confirmed that is the desired product behavior.

### Fix 5a — Add phase constant

Add:

```ts
INTAKE_ABANDONED = "INTAKE_ABANDONED"
```

Definition:

```text
Deal shell created but no active documents uploaded within 24 hours.
Hidden from active work queues. Recoverable by explicit banker/admin action only.
```

Do not edit lifecycle model.

### Fix 5b — Cron sweep

New route:

```text
src/app/api/cron/intake-abandonment-sweep/route.ts
```

Runs every 6 hours.

Logic:

```ts
Find deals where:
- intake_phase = 'BULK_UPLOADED'
- created_at < NOW() - interval '24 hours'
- no active documents exist
- intake_phase != 'INTAKE_ABANDONED'

For each:
- update intake_phase = 'INTAKE_ABANDONED'
- write ledger event 'intake.abandoned'
- include reason, age_hours, doc_count = 0
```

Add to `vercel.json`:

```json
{
  "path": "/api/cron/intake-abandonment-sweep",
  "schedule": "0 */6 * * *"
}
```

### Fix 5c — Filter active surfaces

Every active deal list must exclude abandoned deals:

```ts
.neq("intake_phase", "INTAKE_ABANDONED")
```

AAR must list every file changed.

### Fix 5d — Explicit recovery endpoint

New route:

```text
src/app/api/deals/[dealId]/reactivate-intake/route.ts
```

Allowed only for banker/admin users.

Behavior:

* Only works when `intake_phase = 'INTAKE_ABANDONED'`.
* Re-checks deal has zero active documents or prompts caller to use existing intake if documents now exist.
* Sets `intake_phase = 'BULK_UPLOADED'` or appropriate intake collection phase.
* Writes ledger event `intake.reactivated_from_abandoned`.

This preserves audit while avoiding banker-hostile dead ends.

---

# PART C — God-tier intelligence layer

## Fix 6 — Intake Brain

### Problem

The engine currently knows how to process intake, but it does not produce a single authoritative interpretation of the intake state.

A god-tier intake system needs a brain that continuously answers:

* What do we have?
* What is missing?
* What is ambiguous?
* What matters most?
* Who needs to act?
* What should happen next?

### Core design

Add a pure service:

```text
src/lib/intake/brain/computeIntakeBrain.ts
```

Main function:

```ts
export async function computeIntakeBrain(args: {
  supabase: SupabaseClient;
  dealId: string;
  bankId: string;
  reason: "after_upload" | "after_classification" | "after_confirmation" | "after_processing" | "manual_refresh" | "cron";
}): Promise<IntakeBrainResult>;
```

Type:

```ts
export type IntakeBrainResult = {
  deal_id: string;
  bank_id: string;
  computed_at: string;
  reason: string;
  intake_quality_score: number;
  readiness_score: number;
  slot_coverage_pct: number;
  required_slot_coverage_pct: number;
  docs_total: number;
  docs_confirmed: number;
  docs_needing_review: number;
  docs_rejected_or_unknown: number;
  missing_required_slots: IntakeMissingSlot[];
  unresolved_reviews: IntakeReviewItem[];
  blockers: IntakeBlocker[];
  warnings: IntakeWarning[];
  next_best_actions: NextBestAction[];
  minimum_viable_package: MinimumViablePackageResult;
  summary: string;
};
```

Supporting types:

```ts
export type IntakeMissingSlot = {
  slot_id: string;
  slot_key: string;
  label: string;
  required_doc_type: string;
  required_tax_year?: number | null;
  required_entity_id?: string | null;
  severity: "critical" | "high" | "medium" | "low";
  reason: string;
};

export type IntakeReviewItem = {
  document_id: string;
  filename: string;
  current_doc_type: string | null;
  confidence: number | null;
  reason: string | null;
  alternatives: Array<{ doc_type: string; confidence: number }>;
};

export type IntakeBlocker = {
  code: string;
  severity: "critical" | "high" | "medium" | "low";
  actor: "banker" | "borrower" | "buddy";
  message: string;
  evidence?: Record<string, unknown>;
};

export type IntakeWarning = {
  code: string;
  message: string;
  evidence?: Record<string, unknown>;
};

export type NextBestAction = {
  id: string;
  rank: number;
  actor: "banker" | "borrower" | "buddy";
  action_type:
    | "request_document"
    | "confirm_classification"
    | "confirm_entity"
    | "resolve_duplicate"
    | "run_processing"
    | "send_borrower_reminder"
    | "mark_ready"
    | "review_exception";
  label: string;
  description: string;
  target_type?: "slot" | "document" | "deal" | "borrower";
  target_id?: string;
  priority: "critical" | "high" | "medium" | "low";
  can_auto_execute: boolean;
  endpoint?: string;
  payload?: Record<string, unknown>;
};

export type MinimumViablePackageResult = {
  is_met: boolean;
  missing: IntakeMissingSlot[];
  explanation: string;
};
```

### Inputs

`computeIntakeBrain` reads existing data only:

* `deals`
* `deal_intake_scenario`
* `deal_documents`
* `deal_document_slots`
* `deal_document_slot_attachments`
* `document_artifacts`
* `deal_events`
* `deal_pipeline_ledger`
* existing readiness/memo input helpers where safe

No new table required.

### Output persistence

Write the result into ledger/event layer:

```text
kind: intake.brain_computed
scope: intake
requiresHumanReview: result.blockers.some(b => b.severity === "critical" || b.actor === "banker")
meta: result
```

Also update `deals.next_action_json` with the top action:

```ts
next_action_json = result.next_best_actions[0] ?? null
```

Optional, if already consistent with project conventions:

* store compact score fields on `deals` only if they already exist or are clearly intended.
* do not add new columns for this phase unless necessary.

### Scoring

#### Intake quality score

Score from 0 to 100.

Suggested formula:

```ts
score = 100
score -= missingCriticalRequiredSlots * 18
score -= missingHighRequiredSlots * 10
score -= unresolvedReviewDocs * 8
score -= unknownDocs * 5
score -= zeroSlotPenalty
score -= staleProcessingPenalty
score = clamp(score, 0, 100)
```

#### Readiness score

Separate from intake quality.

Readiness score answers:

> Is this deal package ready for credit analysis?

Suggested formula:

```ts
readiness = 100
readiness -= missingCreditCriticalDocs * 20
readiness -= missingFinancialDocs * 15
readiness -= unresolvedClassificationIssues * 10
readiness -= staleOrAmbiguousPeriodDocs * 8
readiness -= missingEntityCoverage * 8
readiness = clamp(readiness, 0, 100)
```

### Minimum viable package logic

Implement:

```text
src/lib/intake/brain/minimumViablePackage.ts
```

Function:

```ts
export function evaluateMinimumViablePackage(args: {
  deal: DealLite;
  scenario: IntakeScenario | null;
  slots: IntakeSlotLite[];
  documents: IntakeDocumentLite[];
}): MinimumViablePackageResult;
```

Rules:

* Required slots must be filled or explicitly waived.
* Tax return requirements must be year-aware.
* Entity-specific requirements must be entity-aware.
* If scenario is missing, use conventional fallback requirements.
* `needs_review` docs do not satisfy MVP unless manually confirmed.
* Unknown docs do not satisfy MVP.

### Integration points

Call `computeIntakeBrain` after:

1. upload/classification completes
2. manual classification confirmation
3. `processConfirmedIntake`
4. cron recovery or abandonment sweep
5. banker manually refreshes intake state

---

## Fix 7 — Next Best Action engine

### Problem

Even with better review and readiness logic, the system must tell the user exactly what to do next.

### New module

```text
src/lib/intake/brain/nextBestAction.ts
```

Function:

```ts
export function computeNextBestActions(args: {
  missingSlots: IntakeMissingSlot[];
  unresolvedReviews: IntakeReviewItem[];
  blockers: IntakeBlocker[];
  warnings: IntakeWarning[];
  minimumViablePackage: MinimumViablePackageResult;
  dealPhase: string;
}): NextBestAction[];
```

### Ranking rules

Rank actions in this order:

1. Critical structural failures Buddy must resolve
2. Banker classification confirmations
3. Missing required borrower documents
4. Entity/ownership clarifications
5. Duplicate/supersession conflicts
6. Processing/retry actions
7. Reminder/follow-up actions
8. Optional documents or low-priority warnings

### Example outputs

```ts
{
  id: "confirm-doc-abc",
  rank: 1,
  actor: "banker",
  action_type: "confirm_classification",
  label: "Confirm classification for 2023 Business Tax Return",
  description: "Buddy found EIN, tax year, and entity-return structure, but confidence is below the normal threshold. Confirm the type to unblock processing.",
  target_type: "document",
  target_id: "doc_abc",
  priority: "high",
  can_auto_execute: false,
  endpoint: "/api/deals/deal_123/documents/doc_abc/confirm-classification",
  payload: { confirmed_doc_type: "BUSINESS_TAX_RETURN" }
}
```

```ts
{
  id: "request-slot-2023-btr",
  rank: 2,
  actor: "borrower",
  action_type: "request_document",
  label: "Request 2023 Business Tax Return",
  description: "This is required for the current package and has not been satisfied by any confirmed document.",
  target_type: "slot",
  target_id: "slot_2023_btr",
  priority: "critical",
  can_auto_execute: true,
  endpoint: "/api/deals/deal_123/request-document",
  payload: { slot_id: "slot_2023_btr" }
}
```

### UI integration

Surface the top action in:

* deal header
* intake review page
* banker dashboard
* borrower portal where actor = `borrower`

Use existing `deals.next_action_json` for compact display.

---

## Fix 8 — Readiness Intelligence

### Problem

Checklist completeness is not the same as credit readiness.

A package can be “mostly complete” but still not credit-useful if it lacks the few documents that matter most.

### New module

```text
src/lib/intake/brain/readinessIntelligence.ts
```

Function:

```ts
export function computeReadinessIntelligence(args: {
  deal: DealLite;
  scenario: IntakeScenario | null;
  slots: IntakeSlotLite[];
  documents: IntakeDocumentLite[];
  artifacts: DocumentArtifactLite[];
}): {
  readiness_score: number;
  blockers: IntakeBlocker[];
  warnings: IntakeWarning[];
  minimum_viable_package: MinimumViablePackageResult;
};
```

### Readiness blocker examples

```ts
{
  code: "missing_business_tax_return_current_year",
  severity: "critical",
  actor: "borrower",
  message: "Current-year business tax return is required for this package and has not been received.",
  evidence: { tax_year: 2024 }
}
```

```ts
{
  code: "classification_review_blocks_package",
  severity: "high",
  actor: "banker",
  message: "One or more likely required documents need banker confirmation before they can satisfy readiness.",
  evidence: { document_ids: ["doc_123"] }
}
```

```ts
{
  code: "zero_slots_structural_gap",
  severity: "critical",
  actor: "buddy",
  message: "No deterministic intake slots exist for this deal. Slot generation must run before readiness can be trusted.",
  evidence: { deal_id: "deal_123" }
}
```

### Product-aware readiness

Initial version should support:

* conventional fallback
* SBA package behavior where currently represented by existing scenario/slot logic
* Quick Look minimal package behavior if already present

Do not hardcode a brand-new policy universe. Derive from existing slot policy first.

### Readiness states

Computed state:

```ts
type ReadinessState =
  | "not_started"
  | "collecting"
  | "needs_banker_review"
  | "missing_required_docs"
  | "minimum_viable_package_ready"
  | "credit_ready"
  | "blocked_structural";
```

Mapping:

* zero slots → `blocked_structural`
* unresolved needs-review docs affecting required slots → `needs_banker_review`
* missing required slots → `missing_required_docs`
* MVP met but optional/quality warnings remain → `minimum_viable_package_ready`
* MVP met and no high/critical blockers → `credit_ready`

Persist in ledger event meta. Do not add a new enum column unless already consistent with existing patterns.

---

## Fix 9 — Intake Run Summary

### Problem

After intake processing, there is no single concise artifact that explains what happened.

### New module

```text
src/lib/intake/brain/renderIntakeRunSummary.ts
```

Function:

```ts
export function renderIntakeRunSummary(result: IntakeBrainResult): string;
```

Example output:

```text
Buddy processed 14 documents. 11 are confirmed, 2 need banker review, and 1 is unknown. Required slot coverage is 82%. The minimum viable package is not ready because the 2023 Business Tax Return and current interim financials are missing. Next best action: request the 2023 Business Tax Return from the borrower.
```

This summary appears in:

* ledger event
* deal activity feed
* intake review page
* optional banker notification

---

# PART D — UI requirements

## Intake review page

Add three sections above raw document table:

1. **Intake Summary**

   * readiness state
   * readiness score
   * slot coverage
   * docs confirmed / review / unknown

2. **Next Best Action**

   * top-ranked action
   * actor
   * one primary button when executable

3. **Needs Review Coaching Cards**

   * one per review doc

## Deal dashboard card

Show:

* intake phase
* readiness state
* next best action label
* warning badge if structural blocker exists

## Borrower portal

Only show actions where:

```ts
actor === "borrower"
```

Do not expose internal confidence, model details, or evidence tiers to borrower.

---

# PART E — Tests

## Gatekeeper tests

New:

```text
src/lib/gatekeeper/__tests__/btrRoutingException.test.ts
```

Cases:

1. BTR confidence `0.65`, EIN true, form number present, tax year present → still `NEEDS_REVIEW` because below `0.70`.
2. BTR confidence `0.72`, EIN true, form number present, tax year present → `GOOGLE_DOC_AI_CORE`, evidence tier `moderate_with_signals`.
3. BTR confidence `0.72`, EIN false → `NEEDS_REVIEW`.
4. BTR confidence `0.72`, no tax year → `NEEDS_REVIEW`.
5. BTR confidence `0.85` → normal auto route.
6. PTR confidence `0.72` → `NEEDS_REVIEW`.

New:

```text
src/lib/gatekeeper/__tests__/geminiClassifierPure.alternatives.test.ts
```

Cases:

1. Parses alternatives.
2. Missing alternatives becomes empty array.
3. Bad doc type coerces to `UNKNOWN`.
4. Confidence clamps to `[0,1]`.
5. More than two alternatives truncates to two.

## Intake orchestrator tests

New:

```text
src/lib/intake/__tests__/orchestrateIntake.criticalSteps.test.ts
```

Cases:

1. `seedIntakePrereqsCore` throws → `ok = false`.
2. borrower extraction throws → `ok = true` but diagnostics include error.
3. all succeed → `ok = true`, no critical failures.

New:

```text
src/lib/intake/__tests__/orchestrateIntake.slotGeneration.test.ts
```

Cases:

1. Fresh deal with no scenario row generates fallback slots.
2. Running twice does not duplicate slots.
3. Quick Look behavior preserved.

## Processing tests

New:

```text
src/lib/intake/processing/__tests__/processConfirmedIntake.slotAssertion.test.ts
```

Cases:

1. Deleted slots produce `intake.processing_no_slots` event.
2. Event has `requiresHumanReview = true`.
3. Error array includes structural warning.

## Intake Brain tests

New:

```text
src/lib/intake/brain/__tests__/computeIntakeBrain.test.ts
```

Cases:

1. No slots → structural blocker, readiness state `blocked_structural`.
2. Missing required slot → borrower next best action.
3. Needs-review doc likely satisfying required slot → banker confirmation action outranks borrower request.
4. All required slots filled and no review docs → readiness state `credit_ready`.
5. MVP met but warnings remain → `minimum_viable_package_ready`.

New:

```text
src/lib/intake/brain/__tests__/nextBestAction.test.ts
```

Cases:

1. Critical structural blocker ranks first.
2. Banker classification confirmation ranks before borrower request when it could satisfy a required slot.
3. Missing critical doc outranks optional warning.
4. Auto-executable borrower document request includes endpoint and payload.

New:

```text
src/lib/intake/brain/__tests__/readinessIntelligence.test.ts
```

Cases:

1. Missing current-year BTR creates critical blocker.
2. Unknown doc does not satisfy required slot.
3. Manually confirmed doc can satisfy required slot.
4. Scenario missing falls back to conventional requirements.

## UI tests

New:

```text
src/components/deals/intake/__tests__/NeedsReviewCoachingCard.test.tsx
src/components/deals/intake/__tests__/IntakeBrainSummary.test.tsx
src/components/deals/intake/__tests__/NextBestActionPanel.test.tsx
```

Required assertions:

* OCR snippet renders.
* Candidates render.
* Confirm button posts correct payload.
* Top next best action renders.
* Borrower-only actions are filtered correctly in borrower portal context.

## Cron tests

New:

```text
src/app/api/cron/intake-abandonment-sweep/__tests__/route.test.ts
```

Cases:

1. `BULK_UPLOADED`, 25h old, zero docs → abandoned.
2. `BULK_UPLOADED`, 25h old, docs present → untouched.
3. `BULK_UPLOADED`, 12h old, zero docs → untouched.
4. Already abandoned → untouched.

## Recovery endpoint tests

New:

```text
src/app/api/deals/[dealId]/reactivate-intake/__tests__/route.test.ts
```

Cases:

1. Banker can reactivate abandoned deal.
2. Non-banker cannot reactivate.
3. Non-abandoned deal returns no-op or 409.
4. Ledger event written.

---

# PART F — Files affected

## New files

| Path                                                      | Purpose                            |
| --------------------------------------------------------- | ---------------------------------- |
| `src/lib/intake/brain/computeIntakeBrain.ts`              | Main Intake Brain service          |
| `src/lib/intake/brain/nextBestAction.ts`                  | Next best action ranking           |
| `src/lib/intake/brain/readinessIntelligence.ts`           | Credit-aware readiness logic       |
| `src/lib/intake/brain/minimumViablePackage.ts`            | MVP readiness evaluator            |
| `src/lib/intake/brain/renderIntakeRunSummary.ts`          | Human-readable summary             |
| `src/lib/intake/brain/types.ts`                           | Shared types                       |
| `src/components/deals/intake/NeedsReviewCoachingCard.tsx` | Needs-review coaching surface      |
| `src/components/deals/intake/IntakeBrainSummary.tsx`      | Intake score/readiness panel       |
| `src/components/deals/intake/NextBestActionPanel.tsx`     | Top action panel                   |
| `src/app/api/cron/intake-abandonment-sweep/route.ts`      | Abandonment cron                   |
| `src/app/api/deals/[dealId]/reactivate-intake/route.ts`   | Explicit abandoned intake recovery |
| Test files listed in Part E                               | Coverage                           |

## Modified files

| Path                                                                           | Change                                          | Risk   |
| ------------------------------------------------------------------------------ | ----------------------------------------------- | ------ |
| `src/lib/gatekeeper/geminiClassifierPure.ts`                                   | Prompt edit, version bump, alternatives         | Low    |
| `src/lib/gatekeeper/routing.ts`                                                | BTR routing exception                           | Low    |
| `src/lib/gatekeeper/types.ts`                                                  | Add alternatives/evidence tier types            | Low    |
| `src/lib/gatekeeper/runGatekeeper.ts`                                          | Persist alternatives                            | Low    |
| `src/lib/intake/orchestrateIntake.ts`                                          | Critical/non-critical step contract             | Medium |
| `src/lib/intake/seedIntakePrereqsCoreImpl.ts`                                  | Slot generation repair                          | Medium |
| `src/lib/intake/processing/processConfirmedIntake.ts`                          | Slot assertion + brain computation call         | Low    |
| `src/lib/intake/constants.ts`                                                  | Add `INTAKE_ABANDONED`                          | Low    |
| `src/app/api/deals/[dealId]/documents/[docId]/confirm-classification/route.ts` | Accept candidate confirmation + recompute brain | Low    |
| `vercel.json`                                                                  | Add cron                                        | Low    |
| Active deal listing files                                                      | Filter abandoned phase                          | Low    |

## Migrations

```text
intake_v2_alternatives_column
intake_v2_btr_routing_backfill
```

No new tables.

---

# PART G — Verification checklist

## Pre-implementation

* [ ] PIV-1 BTR confidence query pasted into AAR
* [ ] PIV-2 orchestrator soft-fail grep pasted into AAR
* [ ] PIV-3 slot call chain pasted into AAR
* [ ] PIV-4 slot count query pasted into AAR
* [ ] PIV-5 abandoned phase grep pasted into AAR
* [ ] PIV-6 prompt excerpt pasted into AAR
* [ ] PIV-7 completed-deal coverage query pasted into AAR
* [ ] PIV-8 active surface grep pasted into AAR
* [ ] PIV-9 orchestrator call-site grep pasted into AAR

## Operational fixes

* [ ] BTR prompt updated
* [ ] `GEMINI_PROMPT_VERSION` bumped to `gemini_classifier_v3`
* [ ] BTR routing exception implemented
* [ ] BTR routing tests passing
* [ ] BTR backfill migration applied
* [ ] BTR backfill validation query pasted into AAR
* [ ] Slot generation root cause documented
* [ ] Fallback slot generation repaired
* [ ] Slot idempotency test passing
* [ ] Slot structural assertion added
* [ ] Orchestrator critical-step contract implemented
* [ ] All orchestrator call sites audited
* [ ] Needs Review Coaching Card implemented
* [ ] Alternatives column added
* [ ] Confirm-classification route extended
* [ ] `INTAKE_ABANDONED` constant added
* [ ] Abandonment cron implemented
* [ ] Active surfaces filter abandoned deals
* [ ] Reactivation endpoint implemented

## Intelligence layer

* [ ] `computeIntakeBrain` implemented
* [ ] `computeNextBestActions` implemented
* [ ] `computeReadinessIntelligence` implemented
* [ ] `evaluateMinimumViablePackage` implemented
* [ ] `renderIntakeRunSummary` implemented
* [ ] Intake Brain writes `intake.brain_computed` ledger event
* [ ] Deal `next_action_json` updates after brain computation
* [ ] Brain recomputes after upload/classification/confirmation/processing
* [ ] Intake summary UI implemented
* [ ] Next Best Action panel implemented
* [ ] Borrower portal filters only borrower actions

## Final validation

* [ ] `pnpm tsc --noEmit` clean
* [ ] `pnpm test` clean
* [ ] Existing SPEC-01 / SPEC-04 / SPEC-06 / SPEC-13 tests still pass
* [ ] AAR includes files changed
* [ ] AAR includes before/after completion rate
* [ ] AAR includes before/after BTR review rate
* [ ] AAR includes before/after zombie deal count
* [ ] AAR includes sample `intake.brain_computed` ledger event
* [ ] AAR includes screenshot of Needs Review Coaching Card
* [ ] AAR includes screenshot of Intake Brain Summary
* [ ] AAR includes screenshot of Next Best Action panel

## 24-hour post-deploy check

Run:

```sql
SELECT
  intake_phase,
  COUNT(*) AS deal_count
FROM deals
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY intake_phase
ORDER BY deal_count DESC;
```

Expected:

* `PROCESSING_COMPLETE` exceeds `CLASSIFIED_PENDING_CONFIRMATION`
* `BULK_UPLOADED` empty zombie count trends toward zero

Run:

```sql
SELECT
  canonical_type,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE gatekeeper_needs_review = true) AS needs_review,
  ROUND(AVG(gatekeeper_confidence)::numeric, 2) AS avg_conf
FROM deal_documents
WHERE is_active = true
  AND gatekeeper_classified_at IS NOT NULL
  AND created_at > NOW() - INTERVAL '24 hours'
  AND canonical_type IN ('BUSINESS_TAX_RETURN', 'PERSONAL_TAX_RETURN')
GROUP BY canonical_type;
```

Expected:

* BTR review rate materially lower than pre-deploy
* PTR quality unchanged

---

# PART H — Success metrics

## Operational metrics

| Metric                                   | Current target problem |   Target after deploy |
| ---------------------------------------- | ---------------------: | --------------------: |
| Completion rate                          |                   ~30% |                  85%+ |
| BTR needs-review rate                    |                   ~72% |                  <15% |
| PTR needs-review rate                    |                    ~5% |     unchanged / <=10% |
| Empty zombie `BULK_UPLOADED` deals       |                present |    0 active after 24h |
| Completed deals with zero slots          |                present | 0 silent; all flagged |
| Orchestrator critical failure visibility |                   weak |         100% surfaced |

## Intelligence metrics

| Metric                                     |                           Target |
| ------------------------------------------ | -------------------------------: |
| Deals with computed Intake Brain event     | 100% after material intake event |
| Deals with populated top next action       |         95%+ active intake deals |
| Required slot coverage available in UI     |         100% active intake deals |
| Banker review cards with one-click confirm |           100% needs-review docs |
| MVP readiness computed                     |         100% active intake deals |

---

# PART I — Risk register

| #  | Risk                                                   | Mitigation                                                                       |
| -- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 1  | BTR prompt change worsens confidence                   | Version bump, 24h monitoring, easy rollback                                      |
| 2  | BTR exception lets ambiguous docs through              | Require confidence >= 0.70 plus EIN, form number, tax year                       |
| 3  | Slot repair breaks Quick Look                          | Preserve Quick Look tests and branching                                          |
| 4  | Critical-step contract breaks caller assumptions       | PIV-9 call-site audit required                                                   |
| 5  | Coaching UI overwhelms bankers                         | Add hide-for-session, track dismissal rate                                       |
| 6  | Abandonment sweep hides valid deals                    | Require 24h age and zero active docs, re-check before update                     |
| 7  | Recovery creates messy state                           | Recovery is explicit banker/admin action with ledger event                       |
| 8  | Intake Brain becomes another inconsistent state source | Treat brain output as derived event + next_action projection only                |
| 9  | Readiness logic conflicts with memo readiness          | Do not edit downstream memo readiness; derive from slots and existing policies   |
| 10 | Next best action recommends wrong actor                | Unit test ranking and actor filters; borrower portal only shows borrower actions |

---

# PART J — Implementation sequencing

## PR 1 — Operational safety

* PIV/AAR setup
* Orchestrator critical-step contract
* Slot structural assertion
* Slot wire repair
* Tests

## PR 2 — Gatekeeper throughput

* BTR prompt update
* BTR routing exception
* Alternatives parsing
* Backfill migration
* Tests

## PR 3 — Review resolution UX

* Needs Review Coaching Card
* Confirm route extension
* Alternatives persistence
* UI tests

## PR 4 — Abandonment hygiene

* `INTAKE_ABANDONED`
* Cron sweep
* Active surface filters
* Reactivation endpoint
* Tests

## PR 5 — Intake Brain MVP

* `computeIntakeBrain`
* readiness intelligence
* minimum viable package
* next best action
* ledger event
* `next_action_json`
* core tests

## PR 6 — Intake Brain UI

* Intake Brain Summary
* Next Best Action panel
* borrower action filtering
* screenshots/AAR

---

# PART K — Hand-off prompt for Claude Code

```text
Implement SPEC-INTAKE-V2 God-Tier Intake Engine.

Start with PIV. Do not edit code until all PIV outputs are collected and pasted into the AAR.

Proceed in six PR-sized phases:
1. Operational safety: orchestrator critical-step contract, slot wire repair, slot assertion.
2. Gatekeeper throughput: BTR prompt/version, routing exception, alternatives, backfill.
3. Review UX: NeedsReviewCoachingCard and confirm-classification route extension.
4. Abandonment hygiene: INTAKE_ABANDONED, cron, active-surface filters, reactivation endpoint.
5. Intake Brain MVP: computeIntakeBrain, readiness intelligence, MVP evaluator, next best action, ledger event, next_action_json.
6. Intake Brain UI: summary panel, next action panel, borrower-safe action filtering.

Constraints:
- No new core tables.
- No lifecycle model edits.
- No edits to evaluateMemoInputReadiness.
- Deterministic before generative.
- Critical intake failures must fail closed.
- Needs-review surfaces must be resolution-oriented.
- All new behavior must be covered by tests.

AAR must include:
- all PIV outputs
- files changed
- test results
- before/after BTR review rate
- before/after completion rate
- before/after zombie count
- sample intake.brain_computed event
- screenshots of Needs Review Coaching Card, Intake Brain Summary, and Next Best Action panel
```

---

# Final target

The end state is not merely a cleaner pipeline.

The end state is an intake engine that behaves like an expert credit intake operator:

* it knows what was uploaded,
* knows what is missing,
* knows what matters,
* knows who must act,
* explains its reasoning,
* and always presents the next best action.

That is the bar for god-tier Buddy Intake.
