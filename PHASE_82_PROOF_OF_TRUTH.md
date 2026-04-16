# Phase 82 — Proof of Truth Layer

**Status:** Spec ready for implementation  
**Prerequisite:** Phase 81 complete  
**Scope:** 6 targeted sprints — evidence coverage metric, coverage gate, inference surfacing,
contradiction quality scoring, golden set expansion, audit CLI

---

## What ChatGPT got wrong (do NOT implement as described)

### Sprint 1 as written is architecturally misframed

ChatGPT proposes building `claimSupport.ts` to match memo claims against evidence rows at claim
level. This requires NLP sentence matching — a second AI call per claim, expensive, slow, and
adds a new dependency that doesn't exist in this architecture.

**What actually exists and what to use instead:**
- `memoEvidenceResolver.ts` already builds `research_trace_json` — a section-level snapshot:
  `{ sections: [{ section_key: string, claim_ids: string[], evidence_count: number }] }`
- `claimLedger.ts` already persists claims to `buddy_research_evidence` with
  `claim_layer: "fact" | "inference" | "narrative"`, `section`, `source_uris`, `source_types`
- `research_trace_json` is already stored in `canonical_memo_narratives`

**Section-level evidence counts give 90% of the value at 10% of the complexity.** A section
with `evidence_count === 0` is unsupported. A section with `evidence_count >= 3` is well-supported.
Use this. Do not build sentence-level claim matching.

### Sprint 2 inference labeling is already done at the data layer

Every BIE thread prompt already enforces "CLAIM LAYER DISCIPLINE: FACT / INFERENCE / NARRATIVE"
with target composition ratios per thread. `claimLedger.ts` already assigns `claim_layer` to
every persisted claim. What's missing is surfacing this in the memo UI. Data-layer: done.
UI-layer: Sprint 3 of this spec.

---

## Sprint 1 — Section-Level Evidence Support Ratio

**Problem:** No metric for "how well-supported is this memo's research?"
**What to use:** `research_trace_json` already stored on `canonical_memo_narratives`

### Step 1a — Add `evidence_support_ratio` computation

Create `src/lib/research/evidenceCoverage.ts`:

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type EvidenceCoverageResult = {
  totalSections: number;
  supportedSections: number;
  unsupportedSections: number;
  supportRatio: number;           // 0.0 – 1.0
  sectionBreakdown: Array<{
    sectionKey: string;
    evidenceCount: number;
    supported: boolean;
  }>;
};

/**
 * Compute evidence coverage from the research_trace_json on the latest
 * generated memo. This does NOT require a new AI call — it reads the
 * evidence snapshot already persisted during memo generation.
 */
export async function computeEvidenceCoverage(
  dealId: string,
  bankId: string,
): Promise<EvidenceCoverageResult | null> {
  const sb = supabaseAdmin();

  const { data } = await (sb as any)
    .from("canonical_memo_narratives")
    .select("research_trace_json")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.research_trace_json) return null;

  const trace = data.research_trace_json as {
    sections: Array<{ section_key: string; claim_ids: string[]; evidence_count: number }>;
  };

  if (!trace.sections?.length) return null;

  const MIN_EVIDENCE_FOR_SUPPORTED = 1;
  const breakdown = trace.sections.map((s) => ({
    sectionKey: s.section_key,
    evidenceCount: s.evidence_count,
    supported: s.evidence_count >= MIN_EVIDENCE_FOR_SUPPORTED,
  }));

  const totalSections = breakdown.length;
  const supportedSections = breakdown.filter((s) => s.supported).length;
  const unsupportedSections = totalSections - supportedSections;

  return {
    totalSections,
    supportedSections,
    unsupportedSections,
    supportRatio: totalSections > 0 ? supportedSections / totalSections : 0,
    sectionBreakdown: breakdown,
  };
}
```

### Step 1b — Add to `CommitteeCertification` in `buildCanonicalCreditMemo.ts`

The `CommitteeCertification` type (added in Phase 81) should include:

```typescript
// Add to CommitteeCertification type in types.ts:
evidenceSupportRatio: number | null;    // 0.0–1.0, null if no trace yet
unsupportedSections: string[];          // section keys with zero evidence
```

In `buildCanonicalCreditMemo.ts`, after loading `research_trace_json`, call
`computeEvidenceCoverage(dealId, bankId)` and populate these fields.

Add to `reasonsBlocked` if `evidenceSupportRatio !== null && evidenceSupportRatio < 0.7`:
```typescript
reasonsBlocked.push(
  `Evidence support is ${Math.round(evidenceSupportRatio * 100)}% — 70% required for committee`
);
```

### Step 1c — Expose in memo UI

In `CanonicalMemoTemplate.tsx`, add to the certification banner (Phase 81 Sprint 1):

```tsx
{cert.evidenceSupportRatio !== null && (
  <span className="text-xs ml-2">
    Evidence coverage: {Math.round(cert.evidenceSupportRatio * 100)}%
    {cert.unsupportedSections.length > 0 && (
      <span className="text-amber-600">
        {" "}({cert.unsupportedSections.length} unsupported section{cert.unsupportedSections.length > 1 ? "s" : ""})
      </span>
    )}
  </span>
)}
```

---

## Sprint 2 — Evidence Coverage Gate (Gate 9)

**Problem:** Trust grade not tied to evidence density.
**Depends on:** Sprint 1 (evidence support ratio)

In `completionGate.ts`, after Gate 8 (section source requirements), add Gate 9:

```typescript
// ── Gate 9 (Phase 82): Evidence Coverage ─────────────────────────────────
// If a research_trace_json is available from a previous memo generation,
// check that evidence_count > 0 for each research section.
// NOTE: This gate is informational-only when no memo has been generated yet
// (trace will be null). It only activates when a memo exists.
//
// The supportRatio is passed in via opts — computed by computeEvidenceCoverage()
// before the gate runs.

if (opts?.evidenceSupportRatio !== null && opts?.evidenceSupportRatio !== undefined) {
  const ratio = opts.evidenceSupportRatio;
  checks.push({
    gate_id: "evidence_coverage",
    label: "Evidence Coverage Density",
    status: ratio >= 0.85 ? "pass" : ratio >= 0.70 ? "warn" : "fail",
    reason: ratio >= 0.85
      ? `Strong evidence coverage — ${Math.round(ratio * 100)}% of sections backed by evidence`
      : ratio >= 0.70
        ? `Moderate evidence coverage — ${Math.round(ratio * 100)}% (85% required for committee_grade)`
        : `Weak evidence coverage — only ${Math.round(ratio * 100)}% of sections have evidence`,
    severity: ratio < 0.70 ? "warn" : "info",
  });

  // Cap trust grade at preliminary if evidence coverage is weak
  if (ratio < 0.85) {
    // This is handled in grade assignment: warnCount will catch it
    // For explicit demotion below committee_grade when coverage is low:
    // Add to the committee_grade condition: opts.evidenceSupportRatio >= 0.85
  }
}
```

Update the `opts` parameter type:
```typescript
opts?: {
  naicsCode?: string | null;
  evidenceSupportRatio?: number | null;
}
```

Update the committee_grade condition to add:
```typescript
&& (opts?.evidenceSupportRatio == null || opts.evidenceSupportRatio >= 0.85)
```

**In `runMission.ts`**, pass the evidence support ratio when calling `evaluateCompletionGate`:
```typescript
// After BIE completes and claim ledger is written,
// compute evidence coverage from the trace that was just built
const coverage = await computeEvidenceCoverage(dealId, bankId ?? "");
const gateResult = evaluateCompletionGate(bieResult, missionId, {
  naicsCode: subject.naics_code,
  evidenceSupportRatio: coverage?.supportRatio ?? null,
});
```

---

## Sprint 3 — Inference Layer Surfacing in Memo UI

**Problem:** Claim layers exist in `buddy_research_evidence` (assigned by `claimLedger.ts`)
but are invisible to the banker in the memo.

### Step 3a — Load inference ratios per section

In `src/app/api/deals/[dealId]/research/evidence/route.ts` (created in Phase 81), extend
the response to include per-section inference ratios:

```typescript
// For each section in the evidence results, compute:
const sectionStats = groupedBySection.map(([section, rows]) => {
  const total = rows.length;
  const facts = rows.filter(r => r.evidence_type === "fact").length;
  const inferences = rows.filter(r => r.evidence_type === "inference").length;
  const narratives = rows.filter(r => r.evidence_type === "narrative").length;
  return {
    section,
    total,
    facts,
    inferences,
    narratives,
    inferenceRatio: total > 0 ? inferences / total : 0,
    isInferenceDominated: total > 0 && (inferences / total) > 0.6,
  };
});
```

### Step 3b — Surface in `CanonicalMemoTemplate.tsx`

The `EvidenceTag` component (added in Phase 81) currently shows evidence count. Extend it
to show inference dominance when applicable:

```tsx
function EvidenceTag({ sectionKey, trace }: { sectionKey: string; trace: ResearchTrace }) {
  if (!trace) return null;
  const section = trace.sections?.find(s => s.section_key === sectionKey);
  if (!section) return (
    <span className="text-[10px] text-gray-300 ml-2">No linked evidence</span>
  );

  const isInferenceDominated = section.inferenceRatio !== undefined && section.inferenceRatio > 0.6;

  return (
    <details className="inline-block ml-2">
      <summary className={`text-[10px] cursor-pointer hover:opacity-80 ${isInferenceDominated ? "text-amber-500" : "text-sky-500"}`}>
        {section.evidence_count} evidence
        {isInferenceDominated && " · analyst inference"}
      </summary>
      {/* ... existing drawer content ... */}
      {isInferenceDominated && (
        <div className="text-[10px] text-amber-700 mt-1 border-t border-amber-100 pt-1">
          This section is primarily analyst inference based on available evidence,
          not independently verifiable public records.
        </div>
      )}
    </details>
  );
}
```

**Which sections get inference labels:**
Apply to `Credit Thesis`, `Transaction Analysis`, `Structure Implications`, and
`Underwriting Questions` — these are always inference-dominated by design.

---

## Sprint 4 — Contradiction Quality Scoring

**Problem:** Gate 7 checks presence of 8 contradiction checks but not quality.
**Correct approach:** Score quality using thread source types, not by linking to specific
claim IDs (which would require NLP sentence matching that doesn't exist).

### Step 4a — Add `ContradictionStrength` to gate output

In `completionGate.ts`, extend `evaluateContradictionCoverage` to return per-check strength:

```typescript
export type ContradictionCheckResult = {
  checkKey: ContradictionCheckKey;
  detected: boolean;
  strength: "strong" | "weak" | "none";
  strengthReason: string;
};

// Thread-to-contradiction-check mapping for source quality lookup
const THREAD_FOR_CONTRADICTION_CHECK: Record<ContradictionCheckKey, keyof ThreadSources> = {
  identity_mismatch: "borrower",
  dba_mismatch: "borrower",
  geography_mismatch: "market",
  scale_plausibility: "borrower",
  management_history_conflict: "management",
  regulatory_vs_margin: "industry",
  competitive_position_conflict: "competitive",
  repayment_story_conflict: "transaction",
};

const PRIMARY_SOURCE_TYPES: SourceType[] = [
  "court_record", "regulatory_filing", "government_data", "company_primary",
  "news_primary", "market_research", "trade_publication",
];
```

Compute strength per detected check:
```typescript
function computeContradictionStrength(
  checkKey: ContradictionCheckKey,
  bieResult: BIEResult,
): "strong" | "weak" | "none" {
  const relevantThread = THREAD_FOR_CONTRADICTION_CHECK[checkKey];
  const threadUrls = bieResult.thread_sources[relevantThread] ?? [];

  if (threadUrls.length === 0) return "none";

  const primarySourceCount = threadUrls.filter((url) => {
    const type = classifySourceUrl(url);
    return PRIMARY_SOURCE_TYPES.includes(type as SourceType);
  }).length;

  if (primarySourceCount >= 2) return "strong";
  if (primarySourceCount >= 1) return "weak";
  return "none";
}
```

### Step 4b — Downgrade trust on weak contradiction coverage

In `evaluateContradictionCoverage`, after computing covered/missing, add:

```typescript
const strengthCounts = covered.map(checkKey => computeContradictionStrength(checkKey, bieResult));
const strongChecks = strengthCounts.filter(s => s === "strong").length;
const weakOrNoneChecks = covered.length - strongChecks;

// Committee-grade requires 70% of addressed checks to be "strong"
const strengthRatio = covered.length > 0 ? strongChecks / covered.length : 0;
const contradictionQualityFail = covered.length >= 4 && strengthRatio < 0.7;
```

Add to the gate check reason:
```typescript
reason: `${covered.length}/${REQUIRED_CONTRADICTION_CHECKS.length} checks addressed (${strongChecks} strong, ${weakOrNoneChecks} weak/none)`
```

Add `contradictionQualityFail` as input to the grade assignment: if true, cap at `preliminary`.

---

## Sprint 5 — Golden Set Expansion

**Problem:** 6 cases is not a statistical benchmark. Need 20+ sanitized deals.

**What Claude Code can do:** Add placeholder cases with full expectation metadata.
**What Matt must do:** Populate real deal IDs from production.

### Extend `src/lib/research/evals/goldenSet.ts`

Add these 14 placeholder cases (populate dealId from production):

```typescript
// --- ADDITIONAL CASES (populate dealId from production) ---
{
  id: "cre-stabilized",
  name: "CRE Stabilized — Investment Property",
  description: "Stabilized multifamily or retail with full rent roll, strong sponsor",
  // ...full GoldenSetCase fields, dealId: "POPULATE_FROM_PROD"
},
{
  id: "cre-transitional",
  name: "CRE Transitional — Value-Add",
  description: "Properties undergoing lease-up or renovation, lender takes construction risk",
  // ...
},
{
  id: "sba-7a-service",
  name: "SBA 7(a) Service Business",
  description: "Operating service company using SBA 7(a), strong web presence",
  // ...
},
{
  id: "sba-504-owner-occupied",
  name: "SBA 504 Owner-Occupied CRE",
  description: "504 with 10% equity, CDC involvement, equipment component",
  // ...
},
{
  id: "dba-mismatch",
  name: "DBA Mismatch — Legal vs. Operating Name",
  description: "Borrower operates under a completely different DBA, research may drift",
  // DBA mismatch should trigger contradiction check B
  // ...
},
{
  id: "operating-strong-web",
  name: "Operating Company — Strong Web Presence",
  description: "Well-known regional brand with reviews, press, clear web footprint",
  // Should produce committee_grade easily
  // ...
},
{
  id: "hospitality-marine",
  name: "Marine / Hospitality — Niche Industry",
  description: "Charter, marina, or hospitality. Adjacent to the yacht-charter failure.",
  expected: {
    subjectLockPasses: false,  // if no NAICS/description
    maxTrustGrade: "preliminary",
    // ...
  }
},
{
  id: "franchise-deal",
  name: "Franchise — Established Brand",
  description: "Named franchise with royalty structure, national franchisor, FDD on file",
  // ...
},
{
  id: "healthcare-dental",
  name: "Healthcare Practice Acquisition",
  description: "Dental or medical practice acquisition, HIPAA, licensing, patient base",
  // ...
},
{
  id: "fraud-unresolved-entity",
  name: "Unresolvable Entity — Fraud-Like Pattern",
  description: "Company name returns no public records, address is a UPS Store",
  expected: {
    subjectLockPasses: false,
    maxTrustGrade: "research_failed",
    memoShouldBeCommitteeEligible: false,
  }
},
```

### Extend `runGoldenSetEval.ts` to include evidence coverage

```typescript
// In EvalResult type, add:
evidenceSupportRatio: number | null;
contradictionStrength: "strong" | "weak" | "none" | null;
```

In the eval loop, after building the memo:
```typescript
const coverage = await computeEvidenceCoverage(deal.dealId, bankId);
result.evidenceSupportRatio = coverage?.supportRatio ?? null;
```

Add regression assertions:
```typescript
// Regression: evidence support ratio must not drop below 0.5 on any passing deal
if (deal.expected.memoShouldBeCommitteeEligible && (coverage?.supportRatio ?? 0) < 0.5) {
  failures.push(`Evidence support dropped below 50% on a committee-eligible deal`);
}
```

---

## Sprint 6 — Memo Truth Audit CLI

**File:** `src/lib/research/evals/auditMemo.ts`

```typescript
/**
 * Phase 82: Memo Truth Audit CLI
 *
 * Usage: node --import tsx src/lib/research/evals/auditMemo.ts <dealId> <bankId>
 *
 * Outputs:
 * - Evidence coverage by section
 * - Inference-dominated sections
 * - Contradiction check strength breakdown
 * - Unsupported section list
 * - Golden-set regression status (if deal is in golden set)
 */

import { computeEvidenceCoverage } from "@/lib/research/evidenceCoverage";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { lintCanonicalMemo } from "@/lib/creditMemo/memoLint";
import { GOLDEN_SET } from "./goldenSet";

async function auditMemo(dealId: string, bankId: string) {
  console.log(`\n=== BUDDY MEMO TRUTH AUDIT ===`);
  console.log(`Deal: ${dealId}`);
  console.log(`Bank: ${bankId}\n`);

  // 1. Trust grade
  const trustGrade = await loadTrustGradeForDeal(dealId);
  console.log(`Trust Grade: ${trustGrade ?? "not run"}`);

  // 2. Evidence coverage
  const coverage = await computeEvidenceCoverage(dealId, bankId);
  if (coverage) {
    console.log(`\nEvidence Coverage: ${Math.round(coverage.supportRatio * 100)}%`);
    console.log(`  Supported sections: ${coverage.supportedSections}/${coverage.totalSections}`);
    if (coverage.unsupportedSections > 0) {
      const unsupported = coverage.sectionBreakdown
        .filter(s => !s.supported)
        .map(s => s.sectionKey);
      console.log(`  Unsupported: ${unsupported.join(", ")}`);
    }
    console.log(`\nSection Detail:`);
    for (const s of coverage.sectionBreakdown) {
      const icon = s.supported ? "✓" : "✗";
      console.log(`  ${icon} ${s.sectionKey}: ${s.evidenceCount} evidence rows`);
    }
  } else {
    console.log("\nEvidence coverage: not available (no memo generated yet)");
  }

  // 3. Memo lint
  const memoResult = await buildCanonicalCreditMemo({ dealId, bankId });
  if (memoResult.ok) {
    const lint = lintCanonicalMemo(memoResult.memo);
    console.log(`\nMemo Lint: ${lint.passed ? "PASS" : "FAIL"} (${lint.errorCount} errors, ${lint.warningCount} warnings)`);
    if (!lint.passed) {
      for (const issue of lint.issues) {
        const icon = issue.severity === "error" ? "✗" : "⚠";
        console.log(`  ${icon} [${issue.section}] ${issue.message}`);
      }
    }

    // 4. Committee certification
    const cert = memoResult.memo.certification;
    if (cert) {
      console.log(`\nCommittee Eligible: ${cert.isCommitteeEligible ? "YES" : "NO"}`);
      if (!cert.isCommitteeEligible && cert.blockers.length > 0) {
        console.log("Blockers:");
        for (const b of cert.blockers) {
          console.log(`  - ${b}`);
        }
      }
    }
  }

  // 5. Golden set check
  const goldenCase = GOLDEN_SET.find(c => c.id === dealId || c.subject.company_name === dealId);
  if (goldenCase) {
    console.log(`\nGolden Set: ${goldenCase.name}`);
    console.log(`  Expected trust grade: ${goldenCase.expected.maxTrustGrade}`);
    console.log(`  Expected committee eligible: ${goldenCase.expected.memoShouldBeCommitteeEligible}`);
  }

  console.log(`\n=== END AUDIT ===\n`);
}

const [, , dealId, bankId] = process.argv;
if (!dealId || !bankId) {
  console.error("Usage: node --import tsx auditMemo.ts <dealId> <bankId>");
  process.exit(1);
}
auditMemo(dealId, bankId).catch(console.error);
```

Add to `package.json` scripts:
```json
"audit:memo": "node --import tsx src/lib/research/evals/auditMemo.ts"
```

---

## Implementation Order

1. **Sprint 1** — `src/lib/research/evidenceCoverage.ts` + update `CommitteeCertification` type +
   update `buildCanonicalCreditMemo.ts` to compute and expose `evidenceSupportRatio`
2. **Sprint 1 UI** — Extend certification banner in `CanonicalMemoTemplate.tsx` to show coverage %
3. **Sprint 2** — Gate 9 in `completionGate.ts` + update `runMission.ts` to pass coverage ratio
4. **Sprint 3** — Extend evidence route to return inference ratios + extend `EvidenceTag` component
5. **Sprint 4** — `computeContradictionStrength` in `completionGate.ts` + strengthen gate 7 output
6. **Sprint 5** — Add 14 placeholder cases to `goldenSet.ts` + extend `runGoldenSetEval.ts`
7. **Sprint 6** — `auditMemo.ts` CLI + package.json script

After each sprint: `npx tsc --noEmit` — zero new errors required.

---

## Key Decision Notes for Claude Code

### On Sprint 1 — Do NOT build sentence-level claim matching

The existing `research_trace_json` gives section-level evidence counts. Use those. Do not
attempt to match memo prose sentences to specific evidence row IDs — that requires NLP
semantic matching that doesn't exist in this codebase.

### On Sprint 2 — Gate 9 pass-through when no memo exists

If `evidenceSupportRatio` is `null` (no memo generated yet, no trace available), Gate 9
must not fire. The `null` check is critical — new deals with no memo should not be penalized.

### On Sprint 4 — Contradiction strength is informational, not a hard blocker

Keep Gate 7 status as `"pass" | "warn" | "fail"` based on presence count. Contradiction
strength is additional metadata that informs the quality score and a `warn` nudge, not a
new binary blocker. Don't add a hard `fail` for weak contradiction coverage — that would
block too many legitimate deals in early research runs.

### On Sprint 5 — Matt must populate real deal IDs

Add 14 placeholder `GoldenSetCase` objects with full expectation metadata and
`dealId: "POPULATE_FROM_PROD_${caseId}"`. When Matt runs the eval suite, he replaces
these with actual sanitized production deal IDs from Old Glory Bank.

---

## Definition of Phase 82 Complete

- [x] `evidenceSupportRatio` computed per memo and exposed in certification banner
- [x] Gate 9 (evidence coverage) active in `completionGate.ts`
- [x] Inference-dominated sections labeled in memo UI
- [x] Contradiction strength scores computed per check
- [x] Golden set has 20+ cases (6 existing + 14 new placeholders)
- [x] `npm run audit:memo <dealId> <bankId>` works and produces useful output
- [x] `npx tsc --noEmit` zero new errors

## What this phase does NOT change

- BIE architecture (no changes to `buddyIntelligenceEngine.ts`)
- Trust enforcement routing (no changes to `trustEnforcement.ts`)
- Florida Armory layout (no changes to `CanonicalMemoTemplate.tsx` section structure)
- Memo builder logic (only `CommitteeCertification` extended, not rebuilt)
