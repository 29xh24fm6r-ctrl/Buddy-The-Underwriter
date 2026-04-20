# Phase 81 — A+ System Certification

**Status:** Spec ready for implementation  
**Prerequisite:** Phases 79, 80, 82 complete  
**Scope:** 7 real sprints — certification, eval, drillthrough, lint, observability, flight deck, plus 2 audit gaps

---

## What is already built and must NOT be rebuilt

Read this section before touching any file.

- **Primary entry point** — `src/app/(app)/deals/[dealId]/credit-memo/page.tsx` is already the canonical
  dealer-facing memo. It renders `CanonicalMemoTemplate` then `SpreadsAppendix`. Do not create
  `entryPolicy.ts` — it adds no logic and the routing is already correct.
- **Florida Armory layout** — `CanonicalMemoTemplate.tsx` (53KB) has the full institutional memo:
  header, financing request box, sources & uses, collateral analysis, eligibility, business &
  industry analysis (with all BIE v3 subsections), management qualifications table, financial
  analysis (debt coverage, proposed debt, global CF, income statement), PFS, strengths/weaknesses,
  risk factors, policy exceptions, recommendation/approval block, signature block.
- **SpreadsAppendix** — `src/components/creditMemo/SpreadsAppendix.tsx` renders after
  `CanonicalMemoTemplate` on both the deal-shell page and the print view.
- **Trust enforcement** — `trustEnforcement.ts` correctly gates memo (`research_failed` blocked),
  committee packet (committee_grade required), and committee approval. Both the memo generate route
  and the committee packet generate route call `loadAndEnforceResearchTrust` and enforce it.
- **Research trace persistence** — `research_trace_json` and `research_trust_grade` are persisted
  on every generated memo in `canonical_memo_narratives`.
- **Subject lock** — `subjectLock.ts` with hard/soft tiers is injected at step 12b in `runMission.ts`.
- **NAICS 999999 guard** — Gate 0 in `completionGate.ts` prevents committee_grade.
- **Contradiction coverage** — Gate 7 with 8 required check keys and pattern-based detection.
- **Three-layer hallucination guard** — Layer 2 in `runMission.ts`, Layer 3 in `loadResearchForMemo.ts`.
- **Circuit breaker on degraded banner** — `useDegradedState.ts` stops polling after 3 failures.

---

## Sprint 1 — Committee Certification Banner

**Why:** Trust enforcement is correctly wired in routes but invisible to the banker. A
preliminary-grade deal and a committee-grade deal currently render identically on the memo page.
The banker has no explicit signal about committee safety.

### Step 1 — Compute `CommitteeCertification` in `buildCanonicalCreditMemo.ts`

Add this type to `src/lib/creditMemo/canonical/types.ts`:

```typescript
export type CommitteeCertification = {
  isCommitteeEligible: boolean;
  renderMode: "committee" | "internal_diagnostic";
  trustGrade: TrustGrade | null;
  trustGradeLabel: string;
  subjectLocked: boolean;
  naicsValid: boolean;
  reasonsBlocked: string[];
  certifiedAt: string | null;
};
```

Add `committee_certification: CommitteeCertification` to `CanonicalCreditMemoV1`.

In `buildCanonicalCreditMemo.ts`, after loading research data, compute certification:

```typescript
// Load trust grade for this deal
const trustGrade = await loadTrustGradeForDeal(args.dealId);
const naicsCode = borrower?.naics_code ?? null;
const naicsValid = !!naicsCode && naicsCode !== "999999";

const reasonsBlocked: string[] = [];
if (!trustGrade) reasonsBlocked.push("Research not yet run");
if (trustGrade && trustGrade !== "committee_grade") {
  reasonsBlocked.push(`Research trust grade is ${trustGrade} — committee_grade required`);
}
if (!naicsValid) reasonsBlocked.push("NAICS is missing or placeholder (999999)");
if (memo.recommendation.verdict === "pending") {
  reasonsBlocked.push("Recommendation is pending — financial data required");
}

const isCommitteeEligible = reasonsBlocked.length === 0;

const committee_certification: CommitteeCertification = {
  isCommitteeEligible,
  renderMode: isCommitteeEligible ? "committee" : "internal_diagnostic",
  trustGrade,
  trustGradeLabel: trustGrade === "committee_grade" ? "Committee Grade"
    : trustGrade === "preliminary" ? "Preliminary"
    : trustGrade === "manual_review_required" ? "Manual Review Required"
    : trustGrade === "research_failed" ? "Research Failed"
    : "Not Run",
  subjectLocked: naicsValid && !!deal.borrower_name,
  naicsValid,
  reasonsBlocked,
  certifiedAt: isCommitteeEligible ? new Date().toISOString() : null,
};
```

Add `committee_certification` to the returned `memo` object.

### Step 2 — Add certification banner to `CanonicalMemoTemplate.tsx`

At the very top of the template, before the header box, add:

```tsx
{/* ── COMMITTEE CERTIFICATION BANNER ── */}
{(() => {
  const cert = memo.committee_certification;
  if (!cert) return null;

  if (cert.isCommitteeEligible) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-4 py-2.5">
        <span className="text-emerald-600 text-sm font-bold">✓ COMMITTEE CERTIFIED</span>
        <span className="text-xs text-emerald-700">
          Research: {cert.trustGradeLabel} · {cert.certifiedAt?.slice(0, 10)}
        </span>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-amber-800 text-sm font-bold">
          {cert.trustGrade ? "⚠ INTERNAL DIAGNOSTIC — NOT FOR COMMITTEE" : "⚠ DRAFT — RESEARCH NOT RUN"}
        </span>
        <span className="text-xs text-amber-700">Research: {cert.trustGradeLabel}</span>
      </div>
      {cert.reasonsBlocked.length > 0 && (
        <ul className="text-xs text-amber-800 space-y-0.5 list-disc ml-4">
          {cert.reasonsBlocked.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  );
})()}
```

### Step 3 — Wire render mode to suppress approval language in internal_diagnostic mode

In the Recommendation section of `CanonicalMemoTemplate.tsx`, wrap the approval badge:

```tsx
{memo.committee_certification?.renderMode === "internal_diagnostic" && (
  <div className="mb-3 text-xs text-amber-700 border border-amber-200 rounded px-3 py-2 bg-amber-50">
    Approval recommendation suppressed — memo is internal diagnostic only.
    Resolve blockers above to enable committee certification.
  </div>
)}
{memo.committee_certification?.renderMode !== "internal_diagnostic" && (
  // ... existing approval badge JSX ...
)}
```

Similarly suppress the signature block in internal_diagnostic mode:
```tsx
{memo.committee_certification?.renderMode !== "internal_diagnostic" && (
  <div className="mt-6 border-t border-gray-300 pt-4">
    {/* ... signature block ... */}
  </div>
)}
```

### Acceptance criteria
- Every memo shows exactly one banner: green certified, amber diagnostic, or amber draft
- The banner accurately reflects trust grade and subject lock state
- Approval language and signature block are suppressed in internal_diagnostic mode
- No changes to existing data fetching — certification is computed from existing loaded data

---

## Sprint 2 — Memo Lint Pass

**Why:** Phase 80 added render mode, but there's no formal check that catches edge cases before
committee export.

### File: `src/lib/creditMemo/memoLint.ts`

```typescript
import type { CanonicalCreditMemoV1 } from "./canonical/types";

export type MemoLintIssue = {
  severity: "error" | "warn";
  field: string;
  message: string;
};

export type MemoLintResult = {
  pass: boolean;
  committeeEligible: boolean;
  issues: MemoLintIssue[];
};

const PENDING_PATTERNS = [/^Pending/i, /^Unknown$/i, /^—$/, /^\s*$/];

function isPending(val: string | null | undefined): boolean {
  if (!val) return true;
  return PENDING_PATTERNS.some((p) => p.test(val.trim()));
}

export function runMemoLint(memo: CanonicalCreditMemoV1): MemoLintResult {
  const issues: MemoLintIssue[] = [];
  const isCommitteeMode = memo.committee_certification?.renderMode === "committee";

  // 1. Borrower name
  if (isPending(memo.header.borrower_name) || memo.header.borrower_name.includes("Unknown")) {
    issues.push({ severity: "error", field: "header.borrower_name", message: "Borrower name is missing or Unknown" });
  }

  // 2. Loan amount
  if (memo.key_metrics.loan_amount.value === null) {
    issues.push({ severity: isCommitteeMode ? "error" : "warn", field: "key_metrics.loan_amount", message: "Loan amount is pending" });
  }

  // 3. NAICS must be valid in committee mode
  if (isCommitteeMode && (!memo.eligibility.naics_code || memo.eligibility.naics_code === "999999")) {
    issues.push({ severity: "error", field: "eligibility.naics_code", message: "NAICS is missing or placeholder in committee mode" });
  }

  // 4. Business description
  if (isPending(memo.business_summary.business_description)) {
    issues.push({ severity: isCommitteeMode ? "error" : "warn", field: "business_summary.business_description", message: "Business description is pending" });
  }

  // 5. Recommendation must not be pending in committee mode
  if (isCommitteeMode && memo.recommendation.verdict === "pending") {
    issues.push({ severity: "error", field: "recommendation.verdict", message: "Recommendation is pending in committee mode" });
  }

  // 6. Principal bios must not contain default placeholder in committee mode
  if (isCommitteeMode) {
    for (const p of memo.management_qualifications.principals) {
      if (p.bio?.includes("Pending — complete borrower interview")) {
        issues.push({ severity: "error", field: `management_qualifications.principals[${p.id}].bio`, message: `Bio for ${p.name} is placeholder text` });
      }
    }
  }

  // 7. DSCR in committee mode
  if (isCommitteeMode && memo.financial_analysis.dscr.value === null) {
    issues.push({ severity: "error", field: "financial_analysis.dscr", message: "DSCR is pending in committee mode" });
  }

  // 8. Strengths in committee mode
  if (isCommitteeMode && memo.strengths_weaknesses.strengths.length === 0) {
    issues.push({ severity: "warn", field: "strengths_weaknesses.strengths", message: "No strengths identified" });
  }

  const errorCount = issues.filter(i => i.severity === "error").length;
  const pass = errorCount === 0;
  const committeeEligible = pass && isCommitteeMode;

  return { pass, committeeEligible, issues };
}
```

Wire this into the committee packet generate route before PDF assembly:

```typescript
// In committee/packet/generate/route.ts, after trust check:
const { runMemoLint } = await import("@/lib/creditMemo/memoLint");
const memoForLint = await buildCanonicalCreditMemo({ dealId, bankId: access.bankId });
if (memoForLint.ok) {
  const lintResult = runMemoLint(memoForLint.memo);
  if (!lintResult.pass) {
    const errorMessages = lintResult.issues
      .filter(i => i.severity === "error")
      .map(i => i.message)
      .join("; ");
    return NextResponse.json(
      { ok: false, error: `Memo failed committee lint: ${errorMessages}` },
      { status: 400 }
    );
  }
}
```

---

## Sprint 3 — Spread-First Exhibit References

**Why:** `SpreadsAppendix` exists and renders correctly. The gap is that the financial analysis
section narrative doesn't cross-reference the underlying exhibits.

**In `CanonicalMemoTemplate.tsx`**, add exhibit index above `SpreadsAppendix` on the memo page.

This is done in `page.tsx`, not `CanonicalMemoTemplate.tsx`:

```tsx
{/* Exhibit index — between CanonicalMemoTemplate and SpreadsAppendix */}
<div className="mt-6 mb-2 border-t border-gray-300 pt-4">
  <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
    Exhibits
  </div>
  <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 text-xs text-gray-600">
    <div>Exhibit A — Debt Service Coverage Analysis</div>
    <div>Exhibit B — Income Statement (Multi-Period)</div>
    <div>Exhibit C — Global Cash Flow Summary</div>
    <div>Exhibit D — Personal Financial Statements</div>
    <div>Exhibit E — Balance Sheet</div>
    <div>Exhibit F — Proposed Debt Structure</div>
  </div>
</div>
<SpreadsAppendix dealId={dealId} bankId={bankId} />
```

**In `CanonicalMemoTemplate.tsx`**, add exhibit reference captions to the financial section headers:

```tsx
{/* In the Debt Coverage Analysis subsection */}
<div className="text-xs font-semibold text-gray-700 mb-1 flex justify-between">
  <span>Debt Coverage Analysis</span>
  <span className="text-gray-400 font-normal">See Exhibit A</span>
</div>

{/* In the Income Statement subsection */}
<div className="mt-4 text-xs font-semibold text-gray-700 mb-1 flex justify-between">
  <span>Income Statement (Multi-Period)</span>
  <span className="text-gray-400 font-normal">See Exhibit B</span>
</div>
```

Apply the same pattern to Global Cash Flow (Exhibit C) and PFS (Exhibit D).

---

## Sprint 4 — Evidence Drillthrough UI

**Why:** `research_trace_json` is persisted on every generated memo. The UI never exposes it.

### Step 1 — Fetch research trace in `page.tsx`

Add to the parallel queries:

```typescript
const { data: memoNarrative } = await sb
  .from("canonical_memo_narratives")
  .select("narratives, research_trace_json, research_trust_grade")
  .eq("deal_id", dealId)
  .eq("bank_id", bankId)
  .order("generated_at", { ascending: false })
  .limit(1)
  .maybeSingle();
```

Pass `researchTrace={memoNarrative?.research_trace_json}` as a prop to `CanonicalMemoTemplate`.

### Step 2 — Add `researchTrace` prop to `CanonicalMemoTemplate`

```typescript
type ResearchTraceSection = {
  section_key: string;
  claim_ids: string[];
  evidence_count: number;
};

type ResearchTrace = {
  sections: ResearchTraceSection[];
} | null;

export default function CanonicalMemoTemplate({
  memo,
  researchTrace,
}: {
  memo: CanonicalCreditMemoV1;
  researchTrace?: ResearchTrace;
}) {
```

### Step 3 — Add EvidenceTag component

```tsx
function EvidenceTag({ sectionKey, trace }: { sectionKey: string; trace: ResearchTrace }) {
  if (!trace) return null;
  const section = trace.sections?.find(s => s.section_key === sectionKey);
  if (!section) return (
    <span className="text-[10px] text-gray-300 ml-2">No linked evidence</span>
  );
  return (
    <details className="inline-block ml-2">
      <summary className="text-[10px] text-sky-500 cursor-pointer hover:text-sky-700">
        {section.evidence_count} evidence row{section.evidence_count !== 1 ? "s" : ""}
      </summary>
      <div className="absolute z-10 mt-1 w-72 rounded border border-gray-200 bg-white shadow-lg p-3 text-xs">
        <div className="font-semibold text-gray-700 mb-1">Evidence: {sectionKey}</div>
        <div className="text-gray-500">{section.evidence_count} linked claims</div>
        <div className="text-gray-400 mt-1 font-mono text-[9px] truncate">
          {section.claim_ids.slice(0, 3).join(", ")}
          {section.claim_ids.length > 3 && ` +${section.claim_ids.length - 3} more`}
        </div>
      </div>
    </details>
  );
}
```

### Step 4 — Wire EvidenceTag to research-backed sections

Add to the Business & Industry Analysis section header:
```tsx
<div className="text-xs font-semibold text-gray-600 mb-1 flex items-center">
  Industry Overview
  <EvidenceTag sectionKey="industry_overview" trace={researchTrace ?? null} />
</div>
```

Apply the same pattern to: `market_dynamics`, `competitive_positioning`, `regulatory_environment`,
`management_intelligence`, `credit_thesis`, `transaction_analysis`.

---

## Sprint 5 — Operational Observability

**Why:** Subject lock failures, trust downgrades, and committee blocks are logged to `console.warn`
or persisted to `buddy_research_quality_gates` but not emitted to the canonical event ledger in
a structured way that supports aggregation.

### Events to add to `writeEvent` calls:

**In `runMission.ts` — subject lock failure (already logs warn, add event):**
```typescript
void writeEvent({
  dealId,
  kind: "research.subject_lock.failed",
  scope: "research",
  meta: {
    mission_id: missionId,
    reasons: subjectLockResult.reasons,
    naics_code: subject.naics_code,
    has_company_name: !!subject.company_name,
  },
});
```

**In `runMission.ts` — BIE blocked by NAICS 999999:**
```typescript
// In the hasCompany/hasNaics check:
if (!hasNaics) {
  void writeEvent({
    dealId,
    kind: "research.bie.blocked_naics_placeholder",
    scope: "research",
    meta: { mission_id: missionId, naics_code: subject.naics_code },
  });
}
```

**In `completionGate.ts` return path — when trust grade is downgraded by NAICS:**
The calling code in `runMission.ts` already persists the gate result. Add:
```typescript
if (naicsIsPlaceholder) {
  void writeEvent({
    dealId,
    kind: "research.trust_grade.naics_capped",
    scope: "research",
    meta: { mission_id: missionId, naics_code, trust_grade: trustGrade },
  });
}
```

**In `credit-memo/generate/route.ts` — when trust blocks memo:**
```typescript
// After trustCheck.allowed === false:
void writeEvent({
  dealId,
  kind: "memo.generation.blocked_trust",
  scope: "memo",
  meta: { trust_grade: trustGrade, reason: trustCheck.reason },
});
```

**In `committee/packet/generate/route.ts` — when trust blocks packet:**
Already has `packet.generation.failed` but add the trust-specific event before the 400 return:
```typescript
void writeEvent({
  dealId,
  kind: "committee.packet.blocked_trust",
  scope: "committee",
  meta: { reason: trustCheck.reason },
});
```

These events all flow to the canonical `buddy_signal_ledger` / `buddy_ledger_events` table and
can be queried for weekly operational metrics.

---

## Sprint 6 — Human Review Flight Deck

**Why:** The current blocked-memo state shows a generic red error box. A banker can't tell which
specific items need resolution.

### File: `src/components/creditMemo/BlockedMemoRecoveryPanel.tsx`

```tsx
"use client";

import React from "react";
import type { CommitteeCertification } from "@/lib/creditMemo/canonical/types";

export function BlockedMemoRecoveryPanel({
  dealId,
  certification,
  missingMetrics,
}: {
  dealId: string;
  certification: CommitteeCertification | null | undefined;
  missingMetrics: string[];
}) {
  if (!certification || certification.isCommitteeEligible) return null;

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <div className="text-sm font-semibold text-amber-900 mb-3">
        This memo is not committee-ready. Resolve the following to certify:
      </div>

      {certification.reasonsBlocked.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-1">
            Blockers
          </div>
          <ul className="text-sm text-amber-800 space-y-1 list-disc ml-4">
            {certification.reasonsBlocked.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {missingMetrics.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-1">
            Missing Financial Data
          </div>
          <ul className="text-xs text-amber-700 space-y-0.5 list-disc ml-4">
            {missingMetrics.slice(0, 6).map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <a
          href={`/api/deals/${dealId}/research/run`}
          className="inline-flex items-center rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
        >
          Run Research
        </a>
        <span className="text-xs text-amber-600">
          Research must reach committee_grade to certify this memo.
        </span>
      </div>
    </div>
  );
}
```

Wire into `page.tsx`:

```tsx
<BlockedMemoRecoveryPanel
  dealId={dealId}
  certification={res.memo.committee_certification}
  missingMetrics={res.memo.meta.readiness.missing_metrics}
/>
```

Place immediately before `<CanonicalMemoTemplate>`.

---

## Sprint 7 — Audit Gaps from Full System Audit

These two gaps were found during the full codebase audit and are NOT in ChatGPT's spec.

### Gap A — Section-level source requirements (Gate 3b in `completionGate.ts`)

`SECTION_SOURCE_REQUIREMENTS` in `sourcePolicy.ts` defines per-section minimums but the completion
gate only evaluates source quality globally. A deal with no primary sources on the litigation
section can pass Gate 3 if global quality is adequate.

**Add Gate 3b to `completionGate.ts`:**

```typescript
import { SECTION_SOURCE_REQUIREMENTS } from "./sourcePolicy";

// ── Gate 3b: Section-Level Source Requirements ──────────────────────────
// Check that research-intensive sections meet minimum authoritative source
// requirements. Global source quality alone is not sufficient.
const sectionSourceFailures: string[] = [];

for (const req of SECTION_SOURCE_REQUIREMENTS) {
  // Check if BIE produced content for this section
  const hasSection = bieResult.synthesis !== null; // conservative: if synthesis ran, sections may exist
  if (!hasSection) continue;

  const sectionSources = allSourceUrls.filter((url) => {
    const t = classifySourceUrl(url);
    return req.required_source_types.includes(t as any);
  });

  if (sectionSources.length < req.minimum_sources) {
    sectionSourceFailures.push(
      `${req.section}: needs ${req.minimum_sources} authoritative source(s), found ${sectionSources.length}`
    );
  }
}

checks.push({
  gate_id: "section_source_requirements",
  label: "Section-Level Source Requirements",
  status: sectionSourceFailures.length === 0 ? "pass"
        : sectionSourceFailures.length <= 2 ? "warn" : "fail",
  reason: sectionSourceFailures.length === 0
    ? "All sections meet minimum source requirements"
    : `Section source gaps: ${sectionSourceFailures.join("; ")}`,
  severity: sectionSourceFailures.length > 2 ? "warn" : "info",
});
```

Add `!naicsIsPlaceholder` condition already handles committee_grade. Gate 3b adds per-section
authority checking. Committee_grade requires section_source_requirements status !== "fail".

### Gap B — Audit all PDF export routes for trust gating

Check and harden these routes:

**`src/app/api/deals/[dealId]/credit-memo/export/route.ts`** (if exists)  
**`src/app/api/deals/[dealId]/credit-memo/pdf/route.ts`** (if exists)

For each export/PDF route found, add trust enforcement at the top:

```typescript
const trustCheck = await loadAndEnforceResearchTrust(dealId, "memo");
if (!trustCheck.allowed) {
  return NextResponse.json(
    { ok: false, error: trustCheck.reason },
    { status: 400 }
  );
}
```

For routes that export a formal committee-looking document, use `"committee_packet"` instead
of `"memo"` as the action, which requires committee_grade.

---

## Sprint 8 — Golden-Set Evaluation Harness

**This is the biggest remaining gap. Without it there is no regression protection.**

### Files to create:

**`src/lib/research/evals/goldenSet.ts`**
```typescript
export type GoldenDeal = {
  dealId: string;                    // real or sanitized deal ID
  label: string;                     // human description e.g. "CRE with strong sponsor"
  category:
    | "cre_clean"
    | "operating_strong_web"
    | "dba_mismatch"
    | "weak_subject"
    | "service_business"
    | "niche_equipment"
    | "hospitality_yacht"           // yacht-charter regression
    | "sparse_doc_quick_look";
  expectedTrustGrade: "committee_grade" | "preliminary" | "manual_review_required";
  expectedSubjectLock: boolean;
  expectedNaicsValid: boolean;
  minExpectedContradictionChecks: number; // out of 8
  shouldBlockCommittee: boolean;
};

export const GOLDEN_SET: GoldenDeal[] = [
  // The yacht-charter failure is a permanent regression test.
  // Add the deal ID once a sanitized version exists in the test environment.
  {
    dealId: "REPLACE_WITH_YACHT_CHARTER_DEAL_ID",
    label: "Yacht Charter — ambiguous subject, NAICS 999999 (must block)",
    category: "hospitality_yacht",
    expectedTrustGrade: "manual_review_required",
    expectedSubjectLock: false,
    expectedNaicsValid: false,
    minExpectedContradictionChecks: 0,
    shouldBlockCommittee: true,
  },
  // Add 20-30 more deals from production once sanitized
];
```

**`src/lib/research/evals/runGoldenSetEval.ts`**
```typescript
import { GOLDEN_SET, type GoldenDeal } from "./goldenSet";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { runMemoLint } from "@/lib/creditMemo/memoLint";

export type EvalResult = {
  deal: GoldenDeal;
  pass: boolean;
  failures: string[];
  trustGrade: string | null;
  isCommitteeEligible: boolean;
  lintPassed: boolean;
};

export async function runGoldenSetEval(bankId: string): Promise<{
  passed: number;
  failed: number;
  results: EvalResult[];
}> {
  const results: EvalResult[] = [];

  for (const deal of GOLDEN_SET) {
    const failures: string[] = [];

    // 1. Load trust grade
    const trustGrade = await loadTrustGradeForDeal(deal.dealId);
    if (trustGrade !== deal.expectedTrustGrade) {
      failures.push(
        `Trust grade: expected ${deal.expectedTrustGrade}, got ${trustGrade}`
      );
    }

    // 2. Build memo and check certification
    const memoResult = await buildCanonicalCreditMemo({ dealId: deal.dealId, bankId });
    let isCommitteeEligible = false;
    let lintPassed = false;

    if (memoResult.ok) {
      isCommitteeEligible = memoResult.memo.committee_certification?.isCommitteeEligible ?? false;

      if (deal.shouldBlockCommittee && isCommitteeEligible) {
        failures.push("Deal should block committee but was marked eligible");
      }
      if (!deal.shouldBlockCommittee && !isCommitteeEligible) {
        failures.push("Deal should allow committee but was blocked");
      }

      const lintResult = runMemoLint(memoResult.memo);
      lintPassed = lintResult.pass;
    } else {
      failures.push(`Memo build failed: ${memoResult.error}`);
    }

    results.push({
      deal,
      pass: failures.length === 0,
      failures,
      trustGrade,
      isCommitteeEligible,
      lintPassed,
    });
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  return { passed, failed, results };
}
```

**Usage:** Call `runGoldenSetEval(bankId)` from a test script or admin route. No CI integration
required initially — run manually before any merge that touches research, memo, or trust code.

---

## Implementation Order (strictly follow this sequence)

1. **Sprint 7A** — `completionGate.ts` Gate 3b section-level source requirements (surgical, low risk)
2. **Sprint 7B** — Audit and harden PDF export routes (find the files, add trust checks)
3. **Sprint 1** — `CommitteeCertification` type + computation in `buildCanonicalCreditMemo.ts`
4. **Sprint 1 continued** — Certification banner in `CanonicalMemoTemplate.tsx`
5. **Sprint 2** — `memoLint.ts` + wire into committee packet route
6. **Sprint 6** — `BlockedMemoRecoveryPanel.tsx` + wire into `page.tsx`
7. **Sprint 3** — Exhibit index in `page.tsx` + exhibit references in `CanonicalMemoTemplate.tsx`
8. **Sprint 4** — `researchTrace` prop + `EvidenceTag` component in `CanonicalMemoTemplate.tsx`
9. **Sprint 5** — Observability events in `runMission.ts`, generate route, committee route
10. **Sprint 8** — Golden-set eval files (create the framework; populate with real deals separately)

After each sprint: `npx tsc --noEmit` — fix all new errors before proceeding to the next sprint.

---

## Definition of Done

### Research
- [x] Subject lock required before full-underwrite BIE *(Phase 80)*
- [x] NAICS 999999 cannot reach committee_grade *(Phase 80)*
- [x] Contradiction coverage enforced as Gate 7 *(Phase 79)*
- [x] Trust grade governs memo and committee packet *(Phase 79)*
- [ ] Section-level source requirements enforced in Gate 3b *(Sprint 7A)*

### Memo
- [x] Florida Armory canonical layout is always the banker-facing memo *(Phase 80)*
- [x] AI only supplies section content, never structure *(Phase 80)*
- [ ] Committee vs internal_diagnostic is explicit on every memo *(Sprint 1)*
- [ ] Committee memos pass lint before packet export *(Sprint 2)*

### Financial Package
- [x] SpreadsAppendix renders on canonical page and print view *(existing)*
- [ ] Inline exhibit cross-references in narrative sections *(Sprint 3)*
- [ ] Exhibit index above SpreadsAppendix *(Sprint 3)*

### Auditability
- [x] Research trace persisted on every generated memo *(Phase 79)*
- [ ] Evidence drillthrough in memo UI *(Sprint 4)*
- [ ] PDF export routes all trust-gated *(Sprint 7B)*

### Proof
- [ ] Golden-set eval harness passes on yacht-charter regression *(Sprint 8)*
- [ ] Operational events allow "why are memos blocked?" queries *(Sprint 5)*
- [ ] Human review flight deck guides recovery *(Sprint 6)*

---

## Commit Message Template

```
feat(phase-81): A+ System Certification

Sprint 7A: completionGate.ts Gate 3b — section-level source requirements
Sprint 7B: PDF export route trust gating audit
Sprint 1: CommitteeCertification type + banner in CanonicalMemoTemplate
Sprint 2: memoLint.ts + committee packet lint gate
Sprint 6: BlockedMemoRecoveryPanel — banker recovery guidance
Sprint 3: Exhibit index + inline cross-references in memo template
Sprint 4: EvidenceTag + researchTrace drillthrough in UI
Sprint 5: Operational observability events
Sprint 8: Golden-set eval framework (yacht-charter regression test)
```
