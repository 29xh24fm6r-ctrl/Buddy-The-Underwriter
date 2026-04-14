# Phase: Quick Look — Wire Completion

## Audit Summary

Quick Look is ~60% built. The intake UI toggle, API passthrough, `deals.deal_mode` DB column, and reduced checklist ruleset are all production-ready. The wire goes dead at three independent requirement tracking systems that still block or mis-score Quick Look deals.

**Do NOT touch:**
- `src/app/(app)/deals/new/NewDealClient.tsx` — UI toggle complete
- `src/lib/api/uploads.ts` / `createUploadSessionApi.ts` — passthrough working
- `deals.deal_mode` DB column — exists, defaults to `'full_underwrite'`
- `src/lib/checklist/rules.ts` — `QUICK_LOOK_ITEMS` ruleset correct
- `src/lib/checklist/engine.ts` — routes to QUICK_LOOK ruleset correctly
- Spread extraction pipeline — fires independently of readiness

**DB state:** 165 production deals, all `full_underwrite`. No Quick Look deals have ever been created.

---

## Three Dead Wires to Fix

### Dead Wire 1: `gatekeeper/requirements.ts`
Feeds the gatekeeper readiness % shown in the document readiness header. Always generates 3-BTR + personal + PFS requirements regardless of `deal_mode`. Quick Look deals show ~28% readiness when they should show 100%.

### Dead Wire 2: `documentTruth/requirementRegistry.ts` → `cockpit-state`
The cockpit blocker system uses a completely separate requirement registry (`getRequirementsForDealType`) that reads `deal.deal_type`, not `deal.deal_mode`. It will fire `required_documents_missing` for Quick Look deals because they will never satisfy 3 BTRs + 3 personal + PFS. This is the blocker that prevents the cockpit from showing a clean state.

### Dead Wire 3: `underwrite/state` + `cockpit-state` — no `deal_mode` in response
Neither response includes `deal_mode` or `isQuickLook`. No surface downstream can render the Quick Look banner or restrict the questions panel.

---

## Changes Required

### CHANGE 1 — `src/lib/gatekeeper/requirements.ts`

Add `dealMode` parameter. When `'quick_look'`: 2 BTR years (most recent 2), no personal, no PFS.

```typescript
// FULL FILE — replace existing content

/**
 * Gatekeeper Readiness — Scenario Requirements (PURE)
 *
 * Derives what documents are required to underwrite a deal,
 * based on the intake scenario, current date, and deal mode.
 *
 * SLOT-INDEPENDENT: Requirements derive directly from scenario fields
 * + computeTaxYears(), NOT from generateSlotsForScenario().
 *
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
 * When dealMode === 'quick_look':
 *   - businessTaxYears: 2 most recent filed years only
 *   - personalTaxYears: [] (optional, not required)
 *   - requiresFinancialStatements: true (YTD required)
 *   - requiresPFS: false (optional)
 *
 * When dealMode === 'full_underwrite' (or omitted):
 *   - businessTaxYears: 3 consecutive years
 *   - personalTaxYears: 3 consecutive years (always required)
 *   - requiresFinancialStatements: per scenario
 *   - requiresPFS: true
 */
export function deriveScenarioRequirements(params: {
  scenario: IntakeScenario;
  now?: Date;
  dealMode?: "quick_look" | "full_underwrite" | null;
}): ScenarioRequirements {
  const { scenario, now, dealMode } = params;
  const taxYears = computeTaxYears(now);

  if (dealMode === "quick_look") {
    const quickLookYears = taxYears.slice(0, 2); // [mostRecent, mostRecent - 1]
    return {
      businessTaxYears: scenario.has_business_tax_returns ? quickLookYears : [],
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

### CHANGE 2 — `src/lib/gatekeeper/readinessServer.ts`

Load `deal_mode` from the `deals` table and pass to `deriveScenarioRequirements`.

In `computeGatekeeperDocReadiness`, **after** `const effectiveScenario = scenario ?? CONVENTIONAL_FALLBACK;` add:

```typescript
// Load deal_mode for Quick Look requirement adjustment
const { data: dealRow } = await (sb as any)
  .from("deals")
  .select("deal_mode")
  .eq("id", dealId)
  .maybeSingle();
const dealMode = (dealRow?.deal_mode as "quick_look" | "full_underwrite" | null) ?? null;
```

Then update the `deriveScenarioRequirements` call:

```typescript
const requirements = deriveScenarioRequirements({
  scenario: effectiveScenario,
  dealMode, // ← ADD
});
```

---

### CHANGE 3 — `src/lib/documentTruth/requirementRegistry.ts`

Add a `getRequirementsForDealMode` function that returns a reduced set for Quick Look. This is the fix for the cockpit blocker system.

Add at the bottom of the file (after the existing `getRequirementsForDealType` function):

```typescript
/**
 * Get applicable requirements based on deal mode.
 * Quick Look uses a reduced set — only 2 BTR years and YTD financials required.
 * All other requirements become optional.
 */
export function getRequirementsForDealMode(
  dealType: string,
  dealMode: string | null | undefined,
): RequirementDefinition[] {
  const base = getRequirementsForDealType(dealType);

  if (dealMode !== "quick_look") return base;

  // Quick Look: make personal_tax_returns and personal_financial_statement optional.
  // Reduce business_tax_returns to 2-year requirement.
  // Everything else is unchanged.
  return base.map((r) => {
    if (
      r.code === "financials.personal_tax_returns" ||
      r.code === "financials.personal_financial_statement"
    ) {
      return { ...r, required: false };
    }
    if (r.code === "financials.business_tax_returns") {
      return { ...r, requiredCount: 2, yearCount: 2, label: "Business Tax Returns (2 years)" };
    }
    return r;
  });
}
```

---

### CHANGE 4 — `src/app/api/deals/[dealId]/cockpit-state/route.ts`

**Problem:** Reads `deal.deal_type` but not `deal.deal_mode`. Passes wrong requirements to `computeReadinessAndBlockers`, generates wrong blockers.

**Two changes in this file:**

**4a.** Add `deal_mode` to the deal select:
```typescript
// BEFORE
const { data: deal } = await sb
  .from("deals")
  .select("id, name, borrower_name, borrower_id, bank_id, stage, deal_type, intake_phase")
  .eq("id", dealId)
  .single();

// AFTER
const { data: deal } = await sb
  .from("deals")
  .select("id, name, borrower_name, borrower_id, bank_id, stage, deal_type, intake_phase, deal_mode")
  .eq("id", dealId)
  .single();
```

**4b.** Replace `getRequirementsForDealType` call with `getRequirementsForDealMode`:

```typescript
// BEFORE
import { getRequirementsForDealType } from "@/lib/documentTruth/requirementRegistry";
// ...
const applicableRequirements = getRequirementsForDealType(dealType);

// AFTER
import { getRequirementsForDealMode } from "@/lib/documentTruth/requirementRegistry";
// ...
const dealMode = (deal as any).deal_mode as string | null;
const applicableRequirements = getRequirementsForDealMode(dealType, dealMode);
```

**4c.** Add `dealMode` and `isQuickLook` to the response `deal` object:
```typescript
deal: {
  id: deal.id,
  dealName: deal.name,
  borrower: borrower ? { id: borrower.id, legalName: borrower.legal_name } : null,
  bank: bank ? { id: bank.id, name: bank.name } : null,
  lifecycleStage: (deal as any).stage ?? (deal as any).intake_phase ?? "draft",
  cockpitPhase,
  dealMode: dealMode ?? "full_underwrite",   // ← ADD
  isQuickLook: dealMode === "quick_look",     // ← ADD
},
```

---

### CHANGE 5 — `src/app/api/deals/[dealId]/underwrite/state/route.ts`

Add `deal_mode` to deal query and expose in response.

```typescript
// BEFORE
const { data: deal } = await sb.from("deals")
  .select("id, name, borrower_id, bank_id, stage")
  .eq("id", dealId).single();

// AFTER
const { data: deal } = await sb.from("deals")
  .select("id, name, borrower_id, bank_id, stage, deal_mode")
  .eq("id", dealId).single();
```

In the return payload:
```typescript
deal: {
  id: deal.id,
  dealName: deal.name,
  borrowerLegalName: borrower?.legal_name ?? "",
  bankName: bank?.name ?? "",
  lifecycleStage: deal.stage,
  dealMode: (deal as any).deal_mode ?? "full_underwrite",  // ← ADD
  isQuickLook: (deal as any).deal_mode === "quick_look",   // ← ADD
},
```

---

### CHANGE 6 — `src/lib/underwritingLaunch/types.ts`

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

### CHANGE 7 — `src/lib/underwritingLaunch/computeEligibility.ts`

For Quick Look deals, exclude `required_documents_missing` from blocking. The checklist engine already enforces reduced requirements correctly.

```typescript
// BEFORE
const BLOCKING_BLOCKER_CODES = new Set([
  "loan_request_missing",
  "loan_request_incomplete",
  "documents_require_review",
  "required_documents_missing",
]);

export function computeUnderwritingEligibility(
  input: EligibilityInput,
): UnderwritingEligibility {
  const blockingBlockers = input.blockers.filter((b) =>
    BLOCKING_BLOCKER_CODES.has(b.code),
  );

// AFTER
const BLOCKING_BLOCKER_CODES = new Set([
  "loan_request_missing",
  "loan_request_incomplete",
  "documents_require_review",
  "required_documents_missing",
]);

// Quick Look never blocks on required_documents_missing — the checklist engine
// enforces reduced requirements (2 BTRs + YTD). Trust checklist satisfaction.
const QUICK_LOOK_BLOCKING_CODES = new Set([
  "loan_request_missing",
  "loan_request_incomplete",
  "documents_require_review",
]);

export function computeUnderwritingEligibility(
  input: EligibilityInput,
): UnderwritingEligibility {
  const effectiveCodes =
    input.dealMode === "quick_look" ? QUICK_LOOK_BLOCKING_CODES : BLOCKING_BLOCKER_CODES;

  const blockingBlockers = input.blockers.filter((b) =>
    effectiveCodes.has(b.code),
  );
```

**Additionally:** Find all call sites of `computeUnderwritingEligibility` in the codebase (grep for the function name). At each call site, read `deals.deal_mode` and pass it as `dealMode` in the input object. There should be 1-3 call sites, likely in cockpit-state assembly or a dedicated eligibility endpoint.

---

## New Files to Create

### NEW FILE 1 — `src/app/api/deals/[dealId]/deal-mode/route.ts`

PATCH endpoint to upgrade Quick Look → Full Underwrite (and downgrade if needed). Called by the banner.

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
  const { error } = await sb
    .from("deals")
    .update({ deal_mode: newMode })
    .eq("id", dealId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Re-seed checklist for new mode so required items adjust immediately
  const { reconcileDealChecklist } = await import("@/lib/checklist/engine");
  await reconcileDealChecklist(dealId);

  await logLedgerEvent({
    dealId,
    bankId: access.bankId,
    eventKey: "deal.mode.changed",
    uiState: "done",
    uiMessage: `Deal mode changed to ${newMode}`,
    meta: { new_mode: newMode },
  });

  return NextResponse.json({ ok: true, deal_mode: newMode });
}
```

---

### NEW FILE 2 — `src/app/api/deals/[dealId]/quick-look/questions/route.ts`

Generates the borrower meeting question set from available facts + gaps + anomalies.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { computeGatekeeperDocReadiness } from "@/lib/gatekeeper/readinessServer";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = Promise<{ dealId: string }>;

export type QuickLookQuestion = {
  category: "financial_clarity" | "data_gaps" | "risk_factors";
  question: string;
  context: string;
  priority: "high" | "medium";
};

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ ok: false }, { status: 403 });

  const sb = supabaseAdmin();

  // Load deal + borrower
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

  // Load key financial facts (most recent period)
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

  // Build facts summary — group by period for trend context
  const factsByPeriod = new Map<string, Array<{ key: string; value: number; confidence: number }>>();
  for (const f of facts ?? []) {
    const period = f.fact_period_end ?? "unknown";
    if (!factsByPeriod.has(period)) factsByPeriod.set(period, []);
    factsByPeriod.get(period)!.push({
      key: f.fact_key,
      value: Number(f.fact_value_num),
      confidence: Number(f.confidence ?? 0),
    });
  }

  const factsSummary = Array.from(factsByPeriod.entries())
    .slice(0, 3)
    .map(([period, periodFacts]) => {
      const lines = periodFacts
        .slice(0, 10)
        .map((f) => `  ${f.key}: ${f.value.toLocaleString("en-US", { maximumFractionDigits: 0 })} (conf: ${Math.round(f.confidence * 100)}%)`);
      return `Period ${period}:\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const missingDocsSummary =
    missingDocs.length > 0 ? missingDocs.join(", ") : "None";

  // Use Gemini via the existing AI wrapper.
  // IMPORTANT: Find the correct import path for the Gemini wrapper in src/lib/ai/.
  // Common names: generateContent, callGemini, geminiGenerate, generateWithGemini.
  // Do NOT create a new wrapper. Import whatever exists.
  const prompt = `You are a senior commercial banking credit officer preparing for a borrower meeting.
You have completed a Quick Look (preliminary) analysis of ${borrower?.legal_name ?? "the borrower"}.

AVAILABLE FINANCIAL DATA:
${factsSummary || "No financial facts extracted yet — documents may still be processing."}

MISSING DOCUMENTS THAT STILL NEED TO BE COLLECTED:
${missingDocsSummary}

CONTEXT: This is a Quick Look analysis — a preliminary assessment before the full underwriting package is assembled. The purpose of the borrower meeting is to:
1. Clarify anomalies visible in the partial data
2. Understand why documents are missing and get commitment to provide them
3. Surface credit concerns early so they can be addressed before full underwriting

Generate exactly 9-12 targeted questions for the borrower meeting. Categorize them:

FINANCIAL_CLARITY (3-4 questions): Reference specific numbers or trends visible in the extracted data. Ask the borrower to explain unusual items, revenue changes, specific expense categories, or anything that stands out. Be concrete — use actual numbers when available.

DATA_GAPS (2-3 questions): Ask about missing documents specifically. Ask why they are missing and get a commitment timeline. For each missing item, understand if there is a reason it might not be available.

RISK_FACTORS (3-4 questions): Forward-looking credit questions — key person dependency, customer concentration, debt obligations not visible in the package, contingent liabilities, personal financial capacity to guarantee, business continuity.

Requirements:
- Every question must be specific, not generic
- Financial clarity questions MUST reference actual numbers if facts are available
- Risk factor questions should reflect the specific industry/business type if inferrable from the data
- Write as if you are actually going to ask this in a meeting — natural, direct language

Respond ONLY with a valid JSON array. No markdown, no preamble, no explanation. Schema:
[{
  "category": "financial_clarity" | "data_gaps" | "risk_factors",
  "question": "The exact question to ask",
  "context": "One sentence explaining why this question matters for credit analysis",
  "priority": "high" | "medium"
}]`;

  let questions: QuickLookQuestion[] = [];
  try {
    // Find and import the existing Gemini wrapper from src/lib/ai/
    // Replace this import with whatever the actual wrapper export is
    const { generateContent } = await import("@/lib/ai/gemini");
    const raw = await generateContent({ prompt, maxTokens: 2000 });
    const cleaned = (raw ?? "").replace(/```json|```/g, "").trim();
    if (cleaned.startsWith("[")) {
      questions = JSON.parse(cleaned);
    }
  } catch (e) {
    console.error("[quick-look/questions] generation failed:", e);
    // Return empty questions rather than error — generation is additive, not blocking
  }

  return NextResponse.json({
    ok: true,
    borrowerName: borrower?.legal_name ?? "",
    dealMode: "quick_look",
    readinessPct: readiness.readinessPct,
    missingDocs,
    questions,
    generatedAt: new Date().toISOString(),
  });
}
```

**NOTE on Gemini import:** Before implementing, check `src/lib/ai/` for the existing wrapper file. Use whatever export exists there. Do NOT create a new wrapper or a new file in `src/lib/ai/`.

---

### NEW FILE 3 — `src/components/deals/quickLook/QuickLookBanner.tsx`

Amber banner rendered at the top of the AnalystWorkbench when `isQuickLook === true`.

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
    <div className="flex items-center justify-between gap-4 px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/25">
      <div className="flex items-center gap-2.5">
        <span className="material-symbols-outlined text-amber-400 text-[18px] flex-shrink-0">
          preview
        </span>
        <span className="text-sm font-semibold text-amber-300">Quick Look</span>
        <span className="text-sm text-amber-200/60">
          Preliminary analysis — spreads and insights are available, but this deal cannot advance
          to committee until upgraded to Full Underwrite.
        </span>
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

### NEW FILE 4 — `src/components/deals/quickLook/QuickLookQuestionsPanel.tsx`

Renders the generated question set. Belongs as a tab in the AnalystWorkbench (only visible when `isQuickLook === true`).

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
}

export function QuickLookQuestionsPanel({ dealId }: QuickLookQuestionsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<QuestionsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/quick-look/questions`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Generation failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    if (!data?.questions?.length) return;
    const sections = (Object.keys(CATEGORIES) as CategoryKey[])
      .map((cat) => {
        const qs = data.questions.filter((q) => q.category === cat);
        if (!qs.length) return "";
        return `${CATEGORIES[cat].label.toUpperCase()}\n${qs.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`;
      })
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard.writeText(sections);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5 py-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Borrower Meeting Questions</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Targeted questions generated from available data and document gaps
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <button
              onClick={copyAll}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-700
                         text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
            >
              {copied ? "Copied!" : "Copy All"}
            </button>
          )}
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                       bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 rounded-lg
                        bg-gray-800/40 border border-gray-700/50 text-xs text-gray-400">
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
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Question sections */}
      {data?.questions && (
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
                      <p className="text-xs text-gray-600 leading-snug pl-5">{q.context}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
          <span className="material-symbols-outlined text-[32px] text-gray-700">quiz</span>
          <p className="text-sm text-gray-400">Prepare for your borrower meeting</p>
          <p className="text-xs text-gray-600 max-w-xs">
            Buddy analyzes your available financial data and document gaps to generate the right
            questions to ask before submitting the full package.
          </p>
        </div>
      )}
    </div>
  );
}
```

---

## Wiring Instructions for AnalystWorkbench

After creating the components above, find the AnalystWorkbench component (under `src/app/(app)/deals/[dealId]/underwrite/`). Make two additions:

**1. Quick Look Banner** — Render at the very top of the workbench, before any tab strip, when `isQuickLook === true`:
```tsx
import { QuickLookBanner } from "@/components/deals/quickLook/QuickLookBanner";
// ...
{stateData?.deal?.isQuickLook && (
  <QuickLookBanner dealId={dealId} onUpgraded={() => router.refresh()} />
)}
```

**2. Questions Tab** — Add a "Questions" tab to the workbench tab strip, only when `isQuickLook === true`. When selected, render:
```tsx
import { QuickLookQuestionsPanel } from "@/components/deals/quickLook/QuickLookQuestionsPanel";
// ...
{activeTab === "questions" && <QuickLookQuestionsPanel dealId={dealId} />}
```

---

## Gemini Wrapper Discovery

Before implementing `quick-look/questions/route.ts`, run the following to identify the correct import:

```bash
# In the repo root, find the existing Gemini wrapper
find src/lib/ai -type f -name "*.ts" | head -20
grep -r "export.*function.*gemini\|export.*function.*generate\|export.*function.*callGemini" src/lib/ai/ --include="*.ts" -l
```

Use whatever function you find. Do not create a new one.

---

## Verification Checklist

Run each of these after implementation. Do not mark complete until all pass.

- [ ] **DB write:** Create new deal with Quick Look → confirm `SELECT deal_mode FROM deals WHERE id = '<id>'` returns `'quick_look'`
- [ ] **Checklist seed:** Confirm `deal_checklist_items` for the deal has exactly 4 rows: `IRS_BUSINESS_2Y` (required=true), `FIN_STMT_YTD` (required=true), `IRS_PERSONAL_3Y` (required=false), `PFS_CURRENT` (required=false)
- [ ] **Readiness % correct:** Upload 2023 + 2024 BTR + YTD P&L. Gatekeeper readiness should reach 100%, not 33%
- [ ] **Cockpit no false blocker:** Cockpit-state should NOT show `required_documents_missing` when Quick Look required items are satisfied
- [ ] **Activation succeeds:** Quick Look deal with 2 BTRs + YTD received should allow underwriting activation without block
- [ ] **`deal_mode` in API responses:** `GET /api/deals/[id]/cockpit-state` and `GET /api/deals/[id]/underwrite/state` both return `dealMode: "quick_look"` and `isQuickLook: true`
- [ ] **Quick Look banner visible:** AnalystWorkbench shows amber banner for Quick Look deals
- [ ] **Upgrade works:** Clicking "Upgrade to Full Underwrite" in the banner → deal_mode changes to `full_underwrite` → checklist re-seeds to `UNIVERSAL_V1` → banner disappears
- [ ] **Questions generate:** `GET /api/deals/[id]/quick-look/questions` returns structured questions with all three categories
- [ ] **Full Underwrite unaffected:** Create a standard Full Underwrite deal and confirm all behavior is identical to pre-change

## Full Underwrite Regression Guard

The only files that change existing behavior for Full Underwrite deals are:
- `requirements.ts` — only branches on `dealMode === 'quick_look'`, otherwise identical
- `readinessServer.ts` — passes `null` for Full Underwrite deals (same behavior)  
- `requirementRegistry.ts` — `getRequirementsForDealMode` delegates to `getRequirementsForDealType` when not Quick Look
- `cockpit-state` — uses `getRequirementsForDealMode` which is identical to `getRequirementsForDealType` for non-Quick-Look
- `computeEligibility.ts` — only branches when `dealMode === 'quick_look'`, otherwise identical

If any existing tests fail for Full Underwrite scenarios, the branching logic has a bug.
