# Phase: Quick Look — Wire Completion (v2)

> Revised after full repo audit. Corrects five structural errors in v1:
> (1) AnalystWorkbench has no tab strip — questions panel is a conditional body card
> (2) WorkbenchState type must be extended to carry dealMode + isQuickLook
> (3) deal-mode PATCH must block downgrade after underwriting workspace exists
> (4) AI question generation must be formally non-blocking
> (5) Gemini wrapper must be discovered from repo, not assumed

---

## What is already built — DO NOT TOUCH

- `src/app/(app)/deals/new/NewDealClient.tsx` — UI toggle complete and working
- `src/lib/api/uploads.ts` + `createUploadSessionApi.ts` — `dealMode` passthrough to DB working
- `deals.deal_mode` column — exists, TEXT, defaults to `'full_underwrite'`
- `src/lib/checklist/rules.ts` — `QUICK_LOOK_ITEMS` ruleset defined correctly
- `src/lib/checklist/engine.ts` — routes to `QUICK_LOOK` ruleset when `deal_mode = 'quick_look'`
- All spread extraction — fires on any document regardless of readiness state

**DB state:** 165 production deals, all `full_underwrite`. No Quick Look deal has ever been created.

---

## AnalystWorkbench structure — verified from repo

`src/components/underwrite/AnalystWorkbench.tsx` is a **single linear layout**. There is no tab strip, no `activeTab` state, and no tab navigation of any kind. The component renders in this order:

1. Header (deal name, borrower, bank, lifecycle stage)
2. `<SnapshotBanner>`
3. `<DriftBanner>` (conditional)
4. `<UnderwriteTrustLayer>` (conditional)
5. Three `<WorkstreamCard>` components in a 3-column grid: Spreads, Credit Memo, Risk & Structure

The `WorkbenchState` interface currently has:

```typescript
interface WorkbenchState {
  deal: {
    id: string;
    dealName: string;
    borrowerLegalName: string;
    bankName: string;
    lifecycleStage: string;
    // dealMode and isQuickLook are MISSING — must be added
  };
  workspace: { ... } | null;
  activeSnapshot: { ... } | null;
  drift: DriftSummary | null;
  spreadSeed: SpreadSeedPackage | null;
  memoSeed: MemoSeedPackage | null;
  trustLayer: TrustLayerState | null;
}
```

---

## The three dead wires

### Dead Wire 1 — `gatekeeper/requirements.ts`
Always generates 3-BTR + personal + PFS requirements. Quick Look deals show ~28% readiness when they should show 100% after uploading 2 BTRs + YTD.

### Dead Wire 2 — `documentTruth/requirementRegistry.ts` → `cockpit-state`
The cockpit blocker engine reads `deal.deal_type`, not `deal.deal_mode`. For any Quick Look deal it fires `required_documents_missing` because 3 BTRs + 3 personal returns + PFS are never present. This is the blocker preventing the cockpit from reaching a clean state.

### Dead Wire 3 — `underwrite/state` + `cockpit-state` return no mode flags
Neither API response carries `dealMode` or `isQuickLook`. No downstream component can branch on Quick Look behavior.

---

## Changes — backend (Steps 1–7)

### STEP 1 — Replace `src/lib/gatekeeper/requirements.ts`

Replace the entire file:

```typescript
/**
 * Gatekeeper Readiness — Scenario Requirements (PURE)
 * No DB, no IO, no side effects. Fully testable.
 */
import type { IntakeScenario } from "@/lib/intake/slots/types";
import { computeTaxYears } from "@/lib/intake/slots/taxYears";

export type ScenarioRequirements = {
  businessTaxYears: number[];
  personalTaxYears: number[];
  requiresFinancialStatements: boolean;
  requiresPFS: boolean;
};

/**
 * Derive document requirements from an intake scenario.
 *
 * Quick Look: 2 most recent BTR years, no personal, no PFS, YTD required.
 * Full Underwrite (default): 3 BTR years, 3 personal, PFS, per-scenario financials.
 *
 * NOTE: Quick Look is a lower document threshold for preliminary analysis —
 * NOT a lower credit standard. The distinction matters for memo language and audit.
 */
export function deriveScenarioRequirements(params: {
  scenario: IntakeScenario;
  now?: Date;
  dealMode?: "quick_look" | "full_underwrite" | null;
}): ScenarioRequirements {
  const { scenario, now, dealMode } = params;
  const taxYears = computeTaxYears(now);

  if (dealMode === "quick_look") {
    return {
      businessTaxYears: scenario.has_business_tax_returns ? taxYears.slice(0, 2) : [],
      personalTaxYears: [],
      requiresFinancialStatements: true,
      requiresPFS: false,
    };
  }

  return {
    businessTaxYears: scenario.has_business_tax_returns ? taxYears : [],
    personalTaxYears: taxYears,
    requiresFinancialStatements: scenario.has_financial_statements,
    requiresPFS: true,
  };
}
```

---

### STEP 2 — Edit `src/lib/gatekeeper/readinessServer.ts`

In `computeGatekeeperDocReadiness`, immediately after:
```typescript
const effectiveScenario = scenario ?? CONVENTIONAL_FALLBACK;
```

Add:
```typescript
// Load deal_mode so Quick Look gets reduced requirements
const { data: dealRow } = await (sb as any)
  .from("deals")
  .select("deal_mode")
  .eq("id", dealId)
  .maybeSingle();
const dealMode =
  (dealRow?.deal_mode as "quick_look" | "full_underwrite" | null) ?? null;
```

Then change the `deriveScenarioRequirements` call to:
```typescript
const requirements = deriveScenarioRequirements({
  scenario: effectiveScenario,
  dealMode,
});
```

---

### STEP 3 — Edit `src/lib/documentTruth/requirementRegistry.ts`

Add this function at the bottom of the file, after the existing `getRequirementsForDealType`:

```typescript
/**
 * Get applicable requirements adjusted for deal mode.
 *
 * Quick Look reduces required document threshold — not credit standards.
 * Personal tax returns and PFS become optional.
 * Business tax return requirement reduces to 2 years.
 * All other requirements are unchanged.
 *
 * For full_underwrite (or null/undefined), delegates to getRequirementsForDealType
 * unchanged — no behavioral difference for existing deals.
 */
export function getRequirementsForDealMode(
  dealType: string,
  dealMode: string | null | undefined,
): RequirementDefinition[] {
  const base = getRequirementsForDealType(dealType);
  if (dealMode !== "quick_look") return base;

  return base.map((r) => {
    if (
      r.code === "financials.personal_tax_returns" ||
      r.code === "financials.personal_financial_statement"
    ) {
      return { ...r, required: false };
    }
    if (r.code === "financials.business_tax_returns") {
      return {
        ...r,
        requiredCount: 2,
        yearCount: 2,
        label: "Business Tax Returns (2 years — Quick Look)",
      };
    }
    return r;
  });
}
```

---

### STEP 4 — Edit `src/app/api/deals/[dealId]/cockpit-state/route.ts`

**4a.** Change the import:
```typescript
// BEFORE
import { getRequirementsForDealType } from "@/lib/documentTruth/requirementRegistry";
// AFTER
import { getRequirementsForDealMode } from "@/lib/documentTruth/requirementRegistry";
```

**4b.** Add `deal_mode` to the deal select:
```typescript
// BEFORE
.select("id, name, borrower_name, borrower_id, bank_id, stage, deal_type, intake_phase")
// AFTER
.select("id, name, borrower_name, borrower_id, bank_id, stage, deal_type, intake_phase, deal_mode")
```

**4c.** After `const dealType = ...`, add:
```typescript
const dealMode = (deal as any).deal_mode as string | null ?? null;
```

**4d.** Change the requirements lookup:
```typescript
// BEFORE
const applicableRequirements = getRequirementsForDealType(dealType);
// AFTER
const applicableRequirements = getRequirementsForDealMode(dealType, dealMode);
```

**4e.** In the return payload, add two fields to the `deal:` object:
```typescript
dealMode: dealMode ?? "full_underwrite",
isQuickLook: dealMode === "quick_look",
```

---

### STEP 5 — Edit `src/app/api/deals/[dealId]/underwrite/state/route.ts`

**5a.** Add `deal_mode` to the deal select:
```typescript
// BEFORE
.select("id, name, borrower_id, bank_id, stage")
// AFTER
.select("id, name, borrower_id, bank_id, stage, deal_mode")
```

**5b.** In the return payload, add to the `deal:` object:
```typescript
dealMode: (deal as any).deal_mode ?? "full_underwrite",
isQuickLook: (deal as any).deal_mode === "quick_look",
```

---

### STEP 6 — Edit `src/lib/underwritingLaunch/types.ts`

Add `dealMode` to `EligibilityInput`:
```typescript
export type EligibilityInput = {
  blockers: Array<{ code: string }>;
  loanRequestStatus: "missing" | "draft" | "complete";
  hasDealName: boolean;
  hasBorrowerId: boolean;
  hasBankId: boolean;
  applicableRequiredSatisfiedCount: number;
  applicableRequiredTotalCount: number;
  hasExistingWorkspace: boolean;
  hasDrift: boolean;
  dealMode?: "quick_look" | "full_underwrite" | null;  // ← ADD
};
```

---

### STEP 7 — Edit `src/lib/underwritingLaunch/computeEligibility.ts`

**7a.** After the existing `BLOCKING_BLOCKER_CODES` Set, add:
```typescript
// Quick Look never hard-blocks on required_documents_missing.
// The checklist engine already enforces the reduced requirement set.
// This is a phase-safe fix; future cleanup should derive blocking entirely
// from canonical applicable requirements rather than manual exception sets.
const QUICK_LOOK_BLOCKING_CODES = new Set([
  "loan_request_missing",
  "loan_request_incomplete",
  "documents_require_review",
]);
```

**7b.** In `computeUnderwritingEligibility`, change:
```typescript
const blockingBlockers = input.blockers.filter((b) =>
  BLOCKING_BLOCKER_CODES.has(b.code),
);
```
To:
```typescript
const effectiveCodes =
  input.dealMode === "quick_look"
    ? QUICK_LOOK_BLOCKING_CODES
    : BLOCKING_BLOCKER_CODES;
const blockingBlockers = input.blockers.filter((b) =>
  effectiveCodes.has(b.code),
);
```

**7c.** Find every call site of `computeUnderwritingEligibility` in the codebase:
```bash
grep -r "computeUnderwritingEligibility" src/ --include="*.ts" --include="*.tsx" -l
```
At each call site, read `deals.deal_mode` for the deal and pass it as `dealMode` in the input object.

---

## New files — API (Steps 8–9)

### STEP 8 — Create `src/app/api/deals/[dealId]/deal-mode/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const newMode = body.deal_mode;
  if (newMode !== "full_underwrite" && newMode !== "quick_look") {
    return NextResponse.json({ ok: false, error: "invalid_mode" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Downgrade guard: prevent quick_look downgrade once an underwriting workspace exists.
  // Upgrade (quick_look → full_underwrite) is always allowed.
  // Downgrade (full_underwrite → quick_look) is blocked after formal underwriting launch.
  if (newMode === "quick_look") {
    const { data: workspace } = await sb
      .from("underwriting_workspaces")
      .select("id")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (workspace) {
      return NextResponse.json(
        {
          ok: false,
          error: "downgrade_blocked",
          reason:
            "Cannot change to Quick Look after underwriting has been formally launched. " +
            "The underwriting workspace must remain in Full Underwrite mode for audit integrity.",
        },
        { status: 409 },
      );
    }
  }

  const { error } = await sb
    .from("deals")
    .update({ deal_mode: newMode })
    .eq("id", dealId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Re-seed checklist so required items adjust immediately to new mode
  const { reconcileDealChecklist } = await import("@/lib/checklist/engine");
  await reconcileDealChecklist(dealId);

  await logLedgerEvent({
    dealId,
    bankId: access.bankId,
    eventKey: "deal.mode.changed",
    uiState: "done",
    uiMessage: `Deal mode changed to ${newMode}`,
    meta: { new_mode: newMode, previous_mode: body.previous_mode ?? null },
  });

  return NextResponse.json({ ok: true, deal_mode: newMode });
}
```

---

### STEP 9 — Create `src/app/api/deals/[dealId]/quick-look/questions/route.ts`

**PRE-FLIGHT REQUIRED — run before implementing:**
```bash
grep -r "export.*function\|export const\|export default" src/lib/ai/ --include="*.ts" | head -20
```
Identify the exact Gemini function name and import path. Use it in the route. Do not create a new wrapper or a second Gemini client abstraction.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { computeGatekeeperDocReadiness } from "@/lib/gatekeeper/readinessServer";
// ⚠️ REPLACE THIS IMPORT with the actual Gemini wrapper found in pre-flight grep:
// import { generateContent } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = Promise<{ dealId: string }>;

export type QuickLookQuestion = {
  category: "financial_clarity" | "data_gaps" | "risk_factors";
  question: string;
  context: string;
  priority: "high" | "medium";
};

export type QuickLookQuestionsResponse = {
  ok: true;
  borrowerName: string;
  dealMode: "quick_look";
  readinessPct: number;
  missingDocs: string[];
  /** Always present. Empty array when generation fails — never a 500. */
  questions: QuickLookQuestion[];
  generationStatus: "success" | "failed" | "empty";
  generatedAt: string;
};

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: 403 });

  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("name, deal_mode, borrower_id")
    .eq("id", dealId)
    .maybeSingle();

  if (deal?.deal_mode !== "quick_look") {
    return NextResponse.json(
      { ok: false, error: "quick_look_questions only available for quick_look deals" },
      { status: 400 },
    );
  }

  const { data: borrower } = await sb
    .from("borrowers")
    .select("legal_name")
    .eq("id", deal.borrower_id)
    .maybeSingle();

  // Load financial facts for context
  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end, confidence")
    .eq("deal_id", dealId)
    .eq("is_superseded", false)
    .not("fact_value_num", "is", null)
    .order("fact_period_end", { ascending: false })
    .limit(60);

  // Load readiness gaps
  const readiness = await computeGatekeeperDocReadiness(dealId);
  const missingDocs = [
    ...readiness.missing.businessTaxYears.map((y) => `Business Tax Return ${y}`),
    ...readiness.missing.personalTaxYears.map((y) => `Personal Tax Return ${y}`),
    readiness.missing.financialStatementsMissing ? "YTD Financial Statement" : null,
    readiness.missing.pfsMissing ? "Personal Financial Statement" : null,
  ].filter(Boolean) as string[];

  // Build facts summary grouped by period
  const factsByPeriod = new Map<string, string[]>();
  for (const f of facts ?? []) {
    const period = f.fact_period_end ?? "unknown";
    if (!factsByPeriod.has(period)) factsByPeriod.set(period, []);
    factsByPeriod
      .get(period)!
      .push(
        `  ${f.fact_key}: ${Number(f.fact_value_num).toLocaleString("en-US", { maximumFractionDigits: 0 })} (conf: ${Math.round(Number(f.confidence ?? 0) * 100)}%)`,
      );
  }

  const factsSummary = Array.from(factsByPeriod.entries())
    .slice(0, 3)
    .map(([p, lines]) => `Period ${p}:\n${lines.slice(0, 10).join("\n")}`)
    .join("\n\n");

  const prompt = `You are a senior commercial banking credit officer preparing for a borrower meeting.
You have completed a preliminary (Quick Look) analysis of ${borrower?.legal_name ?? "the borrower"}.
This is an incomplete package — the full underwriting package has not yet been assembled.

AVAILABLE FINANCIAL DATA:
${factsSummary || "No financial facts extracted yet — documents may still be processing."}

DOCUMENTS STILL MISSING FROM PACKAGE:
${missingDocs.length > 0 ? missingDocs.join(", ") : "None identified"}

MEETING PURPOSE: Clarify anomalies in partial data, get commitments on missing documents, surface credit concerns early.

Generate exactly 9-12 targeted questions. Categorize as:

FINANCIAL_CLARITY (3-4): Reference specific numbers from the data. Ask about anomalies, revenue changes, unusual expenses. If no facts are available, ask about general business performance.

DATA_GAPS (2-3): Ask specifically about each missing document — why it is unavailable and when it will be provided.

RISK_FACTORS (3-4): Forward-looking credit questions — key person risk, customer concentration, debt obligations not visible in this package, contingent liabilities, guarantor capacity.

Rules:
- Every question must be specific. Generic questions are not acceptable.
- Financial clarity questions must reference actual dollar amounts or percentages when facts are available.
- Write as if you are speaking directly in the meeting.
- Questions about the incomplete package should convey urgency without being adversarial.

Respond ONLY with a valid JSON array. No markdown, no preamble. Schema:
[{
  "category": "financial_clarity" | "data_gaps" | "risk_factors",
  "question": "Exact question text",
  "context": "One sentence explaining the credit relevance",
  "priority": "high" | "medium"
}]`;

  // Generation is non-blocking. A failure returns ok:true with empty questions.
  let questions: QuickLookQuestion[] = [];
  let generationStatus: "success" | "failed" | "empty" = "empty";

  try {
    // Replace the import below with the actual Gemini wrapper discovered in pre-flight grep
    const { generateContent } = await import("@/lib/ai/gemini");
    const raw = await generateContent({ prompt, maxTokens: 2000 });
    const cleaned = (raw ?? "").replace(/```json|```/g, "").trim();
    if (cleaned.startsWith("[")) {
      questions = JSON.parse(cleaned);
      generationStatus = questions.length > 0 ? "success" : "empty";
    }
  } catch (e) {
    console.error("[quick-look/questions] Gemini generation failed (non-fatal):", e);
    generationStatus = "failed";
    // Return ok:true with empty questions — never fail the workbench surface
  }

  const response: QuickLookQuestionsResponse = {
    ok: true,
    borrowerName: borrower?.legal_name ?? "",
    dealMode: "quick_look",
    readinessPct: readiness.readinessPct,
    missingDocs,
    questions,
    generationStatus,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
```

---

## New files — components (Steps 10–11)

### STEP 10 — Create `src/components/deals/quickLook/QuickLookBanner.tsx`

```tsx
"use client";

import { useState } from "react";

interface QuickLookBannerProps {
  dealId: string;
  onUpgraded?: () => void;
}

export function QuickLookBanner({ dealId, onUpgraded }: QuickLookBannerProps) {
  const [upgrading, setUpgrading] = useState(false);
  const [upgraded, setUpgraded] = useState(false);

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/deal-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_mode: "full_underwrite" }),
      });
      if (res.ok) {
        setUpgraded(true);
        onUpgraded?.();
      }
    } finally {
      setUpgrading(false);
    }
  };

  if (upgraded) return null;

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5
                    bg-amber-500/10 border border-amber-500/25 rounded-xl">
      <div className="flex items-center gap-2.5">
        <span className="material-symbols-outlined text-amber-400 text-[18px] flex-shrink-0">
          preview
        </span>
        <div>
          <span className="text-sm font-semibold text-amber-300">Quick Look — Incomplete Package</span>
          <span className="text-sm text-amber-200/60 ml-2">
            Preliminary analysis available. Not committee-ready until upgraded to Full Underwrite.
          </span>
        </div>
      </div>
      <button
        onClick={handleUpgrade}
        disabled={upgrading}
        className="flex-shrink-0 px-3 py-1 text-xs font-medium rounded-md
                   border border-amber-400/40 text-amber-200
                   hover:bg-amber-400/10 hover:border-amber-400/70
                   transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {upgrading ? "Upgrading…" : "Upgrade to Full Underwrite"}
      </button>
    </div>
  );
}
```

---

### STEP 11 — Create `src/components/deals/quickLook/QuickLookQuestionsPanel.tsx`

```tsx
"use client";

import { useState } from "react";
import type { QuickLookQuestion } from "@/app/api/deals/[dealId]/quick-look/questions/route";

interface QuickLookQuestionsPanelProps {
  dealId: string;
}

const CATEGORIES = {
  financial_clarity: {
    label: "Financial Clarity",
    icon: "query_stats",
    color: "text-blue-300",
    border: "border-blue-500/20",
    bg: "bg-blue-500/5",
    badge: "bg-blue-500/20 text-blue-300",
  },
  data_gaps: {
    label: "Document Gaps",
    icon: "folder_open",
    color: "text-amber-300",
    border: "border-amber-500/20",
    bg: "bg-amber-500/5",
    badge: "bg-amber-500/20 text-amber-300",
  },
  risk_factors: {
    label: "Risk Factors",
    icon: "warning",
    color: "text-rose-300",
    border: "border-rose-500/20",
    bg: "bg-rose-500/5",
    badge: "bg-rose-500/20 text-rose-300",
  },
} as const;

type CategoryKey = keyof typeof CATEGORIES;

interface QuestionsData {
  questions: QuickLookQuestion[];
  missingDocs: string[];
  readinessPct: number;
  borrowerName: string;
  generationStatus: "success" | "failed" | "empty";
}

export function QuickLookQuestionsPanel({ dealId }: QuickLookQuestionsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<QuestionsData | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/quick-look/questions`);
      const json = await res.json();
      if (json.ok) setData(json);
    } catch {
      // silent — non-blocking
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    if (!data?.questions?.length) return;
    const text = (Object.keys(CATEGORIES) as CategoryKey[])
      .map((cat) => {
        const qs = data.questions.filter((q) => q.category === cat);
        if (!qs.length) return "";
        return `${CATEGORIES[cat].label.toUpperCase()}\n${qs.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Borrower Meeting Questions</h3>
          <p className="text-xs text-white/40 mt-0.5">
            Targeted questions from available financial data and document gaps
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.questions?.length ? (
            <button
              onClick={copyAll}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-white/10
                         text-white/50 hover:text-white hover:border-white/20 transition-colors"
            >
              {copied ? "Copied!" : "Copy All"}
            </button>
          ) : null}
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                       bg-primary hover:bg-primary/90 text-white transition-colors disabled:opacity-50"
          >
            {loading && (
              <span className="animate-spin material-symbols-outlined text-[14px]">
                progress_activity
              </span>
            )}
            {loading ? "Generating…" : data ? "Regenerate" : "Generate Questions"}
          </button>
        </div>
      </div>

      {/* Context bar */}
      {data && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 rounded-lg
                        bg-white/[0.03] border border-white/[0.06] text-xs text-white/50">
          <span>
            Package readiness:{" "}
            <span className="text-white font-medium">{data.readinessPct}%</span>
          </span>
          {data.missingDocs.length > 0 && (
            <span>
              Still needed:{" "}
              <span className="text-amber-300">{data.missingDocs.join(", ")}</span>
            </span>
          )}
          {data.generationStatus === "failed" && (
            <span className="text-rose-300/70">AI generation failed — retry to try again</span>
          )}
        </div>
      )}

      {/* Question sections */}
      {data?.questions?.length ? (
        <div className="space-y-4">
          {(Object.keys(CATEGORIES) as CategoryKey[]).map((cat) => {
            const qs = data.questions.filter((q) => q.category === cat);
            if (!qs.length) return null;
            const meta = CATEGORIES[cat];
            return (
              <div key={cat} className={`rounded-xl border p-4 ${meta.border} ${meta.bg}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`material-symbols-outlined text-[16px] ${meta.color}`}>
                    {meta.icon}
                  </span>
                  <span className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.badge}`}>
                    {qs.length}
                  </span>
                </div>
                <div className="space-y-3.5">
                  {qs.map((q, i) => (
                    <div key={i} className="space-y-0.5">
                      <div className="flex items-start gap-2">
                        {q.priority === "high" && (
                          <span className="material-symbols-outlined text-[13px] text-rose-400 mt-0.5 flex-shrink-0">
                            priority_high
                          </span>
                        )}
                        <p className="text-sm text-white leading-snug">{q.question}</p>
                      </div>
                      <p className="text-xs text-white/30 leading-snug pl-5">{q.context}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : data && !loading ? (
        <p className="text-xs text-white/40 text-center py-4">
          {data.generationStatus === "failed"
            ? "Question generation failed. Click Regenerate to try again."
            : "No questions generated. Click Regenerate to try again."}
        </p>
      ) : null}

      {/* Empty state — before first generation */}
      {!data && !loading && (
        <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
          <span className="material-symbols-outlined text-[28px] text-white/20">quiz</span>
          <p className="text-sm text-white/40">Prepare for your borrower meeting</p>
          <p className="text-xs text-white/20 max-w-xs">
            Buddy analyzes available financial data and document gaps to generate targeted questions.
          </p>
        </div>
      )}
    </div>
  );
}
```

---

## STEP 12 — Wire into `AnalystWorkbench.tsx`

This is a targeted edit to `src/components/underwrite/AnalystWorkbench.tsx`.

**12a. Extend the `WorkbenchState` interface** — add `dealMode` and `isQuickLook` to the `deal` sub-type:

```typescript
interface WorkbenchState {
  deal: {
    id: string;
    dealName: string;
    borrowerLegalName: string;
    bankName: string;
    lifecycleStage: string;
    dealMode: "quick_look" | "full_underwrite";   // ← ADD
    isQuickLook: boolean;                          // ← ADD
  };
  // ...rest unchanged
}
```

**12b. Add the imports** at the top of the file:

```typescript
import { QuickLookBanner } from "@/components/deals/quickLook/QuickLookBanner";
import { QuickLookQuestionsPanel } from "@/components/deals/quickLook/QuickLookQuestionsPanel";
```

**12c. Add `isQuickLook` derived variable** after the existing destructuring block:

```typescript
const { deal, workspace, activeSnapshot, drift, spreadSeed, memoSeed } = state;
const isQuickLook = deal.isQuickLook ?? false;  // ← ADD
```

**12d. Render the Quick Look Banner** as the first element inside the top-level `<div className="space-y-4">`, before the header block:

```tsx
{/* Quick Look mode indicator — renders above header when package is incomplete */}
{isQuickLook && (
  <QuickLookBanner
    dealId={dealId}
    onUpgraded={fetchState}
  />
)}
```

**12e. Render the Questions Panel** as a new card after the Trust Layer and before the Workstream Cards grid:

```tsx
{/* Quick Look Meeting Prep — only visible for preliminary analysis deals */}
{isQuickLook && (
  <QuickLookQuestionsPanel dealId={dealId} />
)}

{/* Workstream Cards */}
<div className="grid grid-cols-3 gap-4">
  ...existing cards unchanged...
</div>
```

The final AnalystWorkbench render order for a Quick Look deal will be:
1. QuickLookBanner (amber, with upgrade action)
2. Header (deal name, borrower, bank, stage)
3. SnapshotBanner
4. DriftBanner (conditional)
5. UnderwriteTrustLayer (conditional)
6. **QuickLookQuestionsPanel** ← new, Quick Look only
7. Workstream Cards grid (unchanged)

---

## Verification checklist

Run these checks after all files are saved. Do not mark complete until every item passes.

- [ ] **TypeScript:** `npx tsc --noEmit` — zero errors in all changed files
- [ ] **DB write:** Create a deal at `/deals/new` with Quick Look selected → `SELECT deal_mode FROM deals ORDER BY created_at DESC LIMIT 1` returns `'quick_look'`
- [ ] **Checklist seed:** `SELECT checklist_key, required FROM deal_checklist_items WHERE deal_id = '<id>'` → exactly 4 rows: `IRS_BUSINESS_2Y` (required=true), `FIN_STMT_YTD` (required=true), `IRS_PERSONAL_3Y` (required=false), `PFS_CURRENT` (required=false)
- [ ] **Readiness %:** Upload 2023 + 2024 BTR + YTD P&L → `GET /api/deals/<id>/gatekeeper-readiness` shows readiness at or near 100%, not 33%
- [ ] **No false cockpit blocker:** `GET /api/deals/<id>/cockpit-state` returns no `required_documents_missing` blocker once Quick Look required items are received
- [ ] **Mode flags in responses:** Both `GET /api/deals/<id>/cockpit-state` and `GET /api/deals/<id>/underwrite/state` return `dealMode: "quick_look"` and `isQuickLook: true`
- [ ] **Quick Look Banner renders:** AnalystWorkbench shows amber banner for Quick Look deals — above the header
- [ ] **Upgrade works:** Clicking "Upgrade to Full Underwrite" → `deal_mode` changes to `full_underwrite` in DB → checklist re-seeds to `UNIVERSAL_V1` → banner disappears on re-fetch
- [ ] **Downgrade blocked after launch:** For a deal with `underwriting_workspaces` row, `PATCH /api/deals/<id>/deal-mode` with `{ deal_mode: "quick_look" }` returns 409 with `downgrade_blocked`
- [ ] **Questions Panel renders:** `GET /api/deals/<id>/quick-look/questions` returns `{ ok: true, questions: [...] }` — questions array present
- [ ] **Non-blocking generation:** If Gemini fails, response is still `{ ok: true, questions: [], generationStatus: "failed" }` — never a 500
- [ ] **Full Underwrite unaffected:** Create a standard Full Underwrite deal — all behavior identical to pre-change. Run existing regression tests.

---

## Full Underwrite regression guard

Every backend change is guarded by `if (dealMode !== "quick_look") return base;` or equivalent. The behavioral branches only activate when `deal.deal_mode = 'quick_look'` is explicitly set. The default for all 165 existing deals is `'full_underwrite'`. No existing deal should be affected.
