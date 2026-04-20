# BUSINESS PLAN GOD TIER — PHASE 2: THE LAST MILE

**Status:** ACTIVE — implementation guide for Claude Code  
**Created:** April 20, 2026  
**Depends on:** `specs/BUSINESS_PLAN_GOD_TIER_SPEC.md` (Phase 1 — all 18 steps COMPLETE)  
**Goal:** Transform the system from "correctly wired infrastructure" to "the borrower feels like they just worked with a $5,000 business plan consultant who did all the work for them"

---

## The Four Priorities

| Priority | Name | What it fixes |
|----------|------|---------------|
| A | Smart Prefill | Borrower reviews 80% pre-filled assumptions instead of filling 40 blank fields |
| B | Rich Narrative Injection | Business plan reads like it was written about THIS business, not ANY business |
| C | CCO Review Dashboard | The CCO approves or tweaks in 15 minutes without reading a 16-page PDF |
| D | Auto-Generate with Progress | Clicking "Confirm" immediately starts generation with live progress feedback |

---

## Priority A — Smart Prefill

### Problem

The assumption interview currently pre-fills revenue and COGS from `deal_financial_facts`, but everything else is blank or uses generic defaults (10/8/6% growth, 45-day DSO, 7.25% rate). The borrower has to manually enter growth rates, fixed costs, working capital metrics, planned hires, management team, and equity injection. A first-time franchise buyer has no idea what numbers to put in most of these fields.

The NAICS benchmark data already exists in `sbaAssumptionBenchmarks.ts` (25 NAICS codes with median growth, COGS, DSO, DPO, fixed cost escalation). But it's only used for *validation after entry* — it's never used for *prefill before entry*.

### Solution

When the borrower's NAICS code is known (from `borrower_applications.naics`), auto-fill assumption defaults from NAICS benchmarks instead of hardcoded generic values. Display each pre-filled field with a visual indicator: "Industry typical for [NAICS label]" so the borrower knows why the number is there and feels confident leaving it or adjusting it.

### File: `src/lib/sba/sbaAssumptionsPrefill.ts` (MODIFY)

```typescript
// IMPORT at top of file:
import { findBenchmarkByNaics } from "./sbaAssumptionBenchmarks";

// ADD this new exported function to sbaAssumptionBenchmarks.ts:
// (The BENCHMARKS record and NAICSBenchmark type already exist — just export a lookup)
export function findBenchmarkByNaics(naics: string | null): NAICSBenchmark | null {
  // Same logic as the existing findBenchmark() — rename and export it.
  if (!naics) return null;
  if (BENCHMARKS[naics]) return BENCHMARKS[naics];
  const five = naics.slice(0, 5);
  for (const code of Object.keys(BENCHMARKS)) {
    if (code.startsWith(five)) return BENCHMARKS[code];
  }
  return null;
}
```

In `loadSBAAssumptionsPrefill()`, after the existing fact queries:

```typescript
// NEW: Pull NAICS from borrower_applications
const { data: app } = await sb
  .from("borrower_applications")
  .select("naics, industry")
  .eq("deal_id", dealId)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const naicsCode = (app?.naics as string | null) ?? null;
const industryLabel = (app?.industry as string | null) ?? null;
const bench = findBenchmarkByNaics(naicsCode);

// CHANGE: Use NAICS benchmarks for defaults instead of hardcoded values
const defaultGrowthY1 = bench?.revenueGrowthMedian ?? 0.10;
const defaultGrowthY2 = bench ? bench.revenueGrowthMedian * 0.8 : 0.08;
const defaultGrowthY3 = bench ? bench.revenueGrowthMedian * 0.6 : 0.06;
const defaultDSO = bench?.dsoMedian ?? 45;
const defaultDPO = bench?.dpoMedian ?? 30;

// Use NAICS COGS median if actual COGS fact is zero
const cogsPercent = revenue > 0
  ? Math.min(0.95, cogs / revenue)
  : (bench?.cogsMedian ?? 0.5);

return {
  revenueStreams: revenue > 0 ? [{
    id: "stream_primary",
    name: industryLabel ? `${industryLabel} Revenue` : "Primary Revenue",
    baseAnnualRevenue: revenue,
    growthRateYear1: defaultGrowthY1,
    growthRateYear2: defaultGrowthY2,
    growthRateYear3: defaultGrowthY3,
    pricingModel: "flat",
    seasonalityProfile: null,
  }] : [],
  costAssumptions: {
    cogsPercentYear1: cogsPercent,
    cogsPercentYear2: cogsPercent,
    cogsPercentYear3: cogsPercent,
    fixedCostCategories: [],
    plannedHires: [],
    plannedCapex: [],
  },
  workingCapital: {
    targetDSO: defaultDSO,
    targetDPO: defaultDPO,
    inventoryTurns: null,
  },
  // ... rest unchanged ...

  // NEW: Return metadata about which NAICS benchmark was used
  _prefillMeta: {
    naicsCode,
    naicsLabel: bench?.label ?? null,
    industryLabel,
    benchmarkApplied: bench !== null,
  },
};
```

### File: `src/lib/sba/sbaReadinessTypes.ts` (MODIFY)

Add to the return type of `loadSBAAssumptionsPrefill` (or add as a separate field alongside `GetAssumptionsResponse`):

```typescript
export interface PrefillMeta {
  naicsCode: string | null;
  naicsLabel: string | null;
  industryLabel: string | null;
  benchmarkApplied: boolean;
}
```

### File: `src/app/api/deals/[dealId]/sba/assumptions/route.ts` (MODIFY)

The GET handler should return `prefillMeta` alongside the prefilled assumptions so the UI can display "Industry typical for Full-Service Restaurants" labels.

### File: `src/components/sba/AssumptionInterview.tsx` (MODIFY)

For each field that was pre-filled from NAICS benchmarks, display an inline badge:

```tsx
{prefillMeta?.benchmarkApplied && (
  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400 border border-blue-500/20">
    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>insights</span>
    Industry typical for {prefillMeta.naicsLabel}
  </span>
)}
```

This badge appears next to: growth rates (Y1/Y2/Y3), COGS %, DSO, DPO, and the revenue stream name. The borrower sees at a glance that Buddy pre-filled these from their industry data and can adjust if their specific business differs.

### Management Team Auto-Fill from Ownership Entities

The management team section is currently blank. But `deal_ownership_entities` already has names, titles, and ownership percentages for individuals on the deal. Pre-fill the management team from this table:

```typescript
// In loadSBAAssumptionsPrefill(), add:
const { data: owners } = await sb
  .from("deal_ownership_entities")
  .select("display_name, entity_type")
  .eq("deal_id", dealId)
  .eq("entity_type", "individual");

const { data: interests } = await sb
  .from("deal_ownership_interests")
  .select("owner_entity_id, ownership_pct")
  .eq("deal_id", dealId);

const managementTeam = (owners ?? []).map((owner) => {
  const interest = (interests ?? []).find(
    (i) => i.owner_entity_id === owner.id
  );
  return {
    name: owner.display_name ?? "",
    title: Number(interest?.ownership_pct ?? 0) >= 50 ? "Owner / CEO" : "Partner",
    ownershipPct: Number(interest?.ownership_pct ?? 0),
    yearsInIndustry: 0,  // borrower must fill this
    bio: "",  // borrower must fill this
  };
});
```

This means when the borrower reaches the Management Team step, their names and ownership percentages are already there. They just need to add years of experience and a bio sentence.

---

## Priority B — Rich Narrative Injection

### Problem

The current Gemini prompts receive truncated context:
- `researchSummary` = `JSON.stringify(researchRow.sections).slice(0, 2000)` — that's 2KB out of an 82KB research narrative with 17 sections
- No city/state/market context is passed to the narrative prompts
- No NAICS-specific industry data is injected
- The executive summary prompt doesn't receive the borrower's actual management bios
- The industry analysis doesn't receive the actual "Industry Overview", "Competitive Landscape", or "Market Intelligence" sections from the BIE research

### Solution: Structured Research Extraction

**New file:** `src/lib/sba/sbaResearchExtractor.ts`

Instead of dumping 82KB of raw JSON into a prompt, extract the specific research sections that matter for each narrative call and format them as clean prose.

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ExtractedResearch {
  industryOverview: string | null;         // from "Industry Overview" section
  industryOutlook: string | null;          // from "Industry Outlook" section
  competitiveLandscape: string | null;     // from "Competitive Landscape" section
  marketIntelligence: string | null;       // from "Market Intelligence" section
  borrowerProfile: string | null;          // from "Borrower Profile" section
  managementIntelligence: string | null;   // from "Management Intelligence" section
  regulatoryEnvironment: string | null;    // from "Regulatory Environment" section
  creditThesis: string | null;             // from "Credit Thesis" section
  threeToFiveYearOutlook: string | null;   // from "3-Year and 5-Year Outlook" section
}

/**
 * Extract structured research sections from buddy_research_narratives.
 * The sections array contains objects with { title: string, sentences: Array<{ text: string, citations: [] }> }.
 * We extract the sentence texts for each relevant section and join them into prose paragraphs.
 */
export async function extractResearchForBusinessPlan(
  dealId: string,
): Promise<ExtractedResearch> {
  const sb = supabaseAdmin();

  const { data: researchRow } = await sb
    .from("buddy_research_narratives")
    .select("sections")
    .eq("deal_id", dealId)
    .order("compiled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!researchRow?.sections || !Array.isArray(researchRow.sections)) {
    return {
      industryOverview: null,
      industryOutlook: null,
      competitiveLandscape: null,
      marketIntelligence: null,
      borrowerProfile: null,
      managementIntelligence: null,
      regulatoryEnvironment: null,
      creditThesis: null,
      threeToFiveYearOutlook: null,
    };
  }

  const sections = researchRow.sections as Array<{
    title: string;
    sentences?: Array<{ text: string }>;
  }>;

  function extractSection(title: string, maxChars: number = 3000): string | null {
    const section = sections.find(
      (s) => s.title.toLowerCase() === title.toLowerCase(),
    );
    if (!section?.sentences || section.sentences.length === 0) return null;
    const text = section.sentences
      .map((s) => s.text)
      .filter((t) => t && t.length > 10)
      .join(" ");
    // Truncate to maxChars at a sentence boundary
    if (text.length <= maxChars) return text;
    const truncated = text.slice(0, maxChars);
    const lastPeriod = truncated.lastIndexOf(".");
    return lastPeriod > maxChars * 0.5 ? truncated.slice(0, lastPeriod + 1) : truncated;
  }

  return {
    industryOverview: extractSection("Industry Overview"),
    industryOutlook: extractSection("Industry Outlook"),
    competitiveLandscape: extractSection("Competitive Landscape"),
    marketIntelligence: extractSection("Market Intelligence"),
    borrowerProfile: extractSection("Borrower Profile"),
    managementIntelligence: extractSection("Management Intelligence"),
    regulatoryEnvironment: extractSection("Regulatory Environment"),
    creditThesis: extractSection("Credit Thesis"),
    threeToFiveYearOutlook: extractSection("3-Year and 5-Year Outlook"),
  };
}
```

### File: `src/lib/sba/sbaPackageOrchestrator.ts` (MODIFY)

Replace the current research loading:

```typescript
// REMOVE this:
const researchSummary = researchRow?.sections
  ? JSON.stringify(researchRow.sections).slice(0, 2000)
  : undefined;

// REPLACE with:
import { extractResearchForBusinessPlan } from "./sbaResearchExtractor";

const research = await extractResearchForBusinessPlan(dealId);
```

### File: `src/lib/sba/sbaPackageNarrative.ts` (MODIFY — upgrade all prompts)

Each Gemini call now receives the specific, relevant research section instead of a generic 2KB blob.

#### Executive Summary — inject deal-specific numbers and names

```typescript
export async function generateExecutiveSummary(params: {
  // ... existing params ...
  // ADD:
  managementBios: string;           // actual bios from assumptions, not just names
  city: string | null;
  state: string | null;
  borrowerProfile: string | null;   // from research extractor
  creditThesis: string | null;      // from research extractor
}): Promise<string> {

  const prompt = `You are writing the executive summary for an SBA ${params.loanType} business plan.
${STANDARD_GUARDRAILS}
Maximum 500 words. Third person. Professional.

CRITICAL INSTRUCTION: This must read like it was written specifically about ${params.dealName}. Use the borrower's name, their specific loan amount, their specific city/state, their specific management team members by name, and their specific DSCR. A reader should know within the first sentence exactly which business this plan is about.

Borrower: ${params.dealName}
Location: ${params.city ? `${params.city}, ${params.state}` : "Location not specified"}
Industry: ${params.industryDescription}
Years in business: ${params.yearsInBusiness ?? "Not specified"}
Requested loan: $${params.loanAmount.toLocaleString()}
Use of proceeds: ${params.useOfProceedsDescription}
Revenue streams: ${params.revenueStreamNames.join(", ")}

Management team with bios:
${params.managementBios}

Projected Year 1 revenue: $${Math.round(params.projectedRevenueYear1).toLocaleString()}
Year 1 DSCR: ${params.dscrYear1.toFixed(2)}x (SBA minimum: 1.25x — ${params.dscrYear1 >= 1.25 ? "PASSES" : "BELOW THRESHOLD"})
Equity injection: ${params.equityInjectionPct ? `${(params.equityInjectionPct * 100).toFixed(1)}%` : "Not specified"}

${params.borrowerProfile ? `Borrower research context:\n${params.borrowerProfile}` : ""}
${params.creditThesis ? `Credit thesis:\n${params.creditThesis}` : ""}

Structure the narrative as:
1. Opening sentence: "[Borrower Name], a [industry] business located in [city, state], is requesting a $[amount] SBA [type] loan to [purpose]."
2. Business overview and operating history (2-3 sentences)
3. Revenue model and year-1 projected performance (2-3 sentences with actual numbers)
4. Management strength — reference each team member by name with their relevant experience
5. Debt service capacity — state the projected DSCR as a fact, note the cushion above SBA minimum
6. Closing statement on why this request is structured to succeed

Return ONLY valid JSON: { "executiveSummary": "..." }`;
```

#### Industry Analysis — inject actual research sections

```typescript
export async function generateIndustryAnalysis(params: {
  // ... existing params ...
  // ADD:
  industryOverview: string | null;       // from extractResearchForBusinessPlan
  industryOutlook: string | null;
  competitiveLandscape: string | null;
  regulatoryEnvironment: string | null;
  marketIntelligence: string | null;
}): Promise<string> {

  const prompt = `You are writing the industry analysis for an SBA business plan.
${STANDARD_GUARDRAILS}

CRITICAL: Use ONLY the research data provided below. Do NOT invent any statistics, market sizes, growth rates, or competitor names that are not explicitly stated in the research context. If a research section says "data not available" or similar, acknowledge the gap honestly rather than filling it with generic filler.

Borrower: ${params.dealName}
NAICS: ${params.naicsCode ?? "Not provided"}
Industry: ${params.industryDescription}

${params.industryOverview ? `=== INDUSTRY OVERVIEW (from Buddy research) ===\n${params.industryOverview}\n` : ""}
${params.industryOutlook ? `=== INDUSTRY OUTLOOK ===\n${params.industryOutlook}\n` : ""}
${params.competitiveLandscape ? `=== COMPETITIVE LANDSCAPE ===\n${params.competitiveLandscape}\n` : ""}
${params.regulatoryEnvironment ? `=== REGULATORY ENVIRONMENT ===\n${params.regulatoryEnvironment}\n` : ""}
${params.marketIntelligence ? `=== LOCAL MARKET INTELLIGENCE ===\n${params.marketIntelligence}\n` : ""}

Write 4-5 paragraphs covering:
1. Industry landscape and size (from research ONLY — no invented numbers)
2. Growth drivers and demand trends
3. Competitive positioning for ${params.dealName}
4. Regulatory or input-cost considerations
5. Local market context if geographic data is available

Return ONLY valid JSON: { "industryAnalysis": "..." }`;
```

#### SWOT Analysis — inject management bios, research risk factors

```typescript
// In the SWOT prompt, ADD:
${params.managementBios ? `Management team detail:\n${params.managementBios}` : ""}
${params.borrowerProfile ? `Borrower profile from research:\n${params.borrowerProfile}` : ""}
${params.competitiveLandscape ? `Competitive landscape:\n${params.competitiveLandscape}` : ""}
${params.industryOutlook ? `Industry outlook:\n${params.industryOutlook}` : ""}

// And strengthen the output instruction:
CRITICAL: Strengths and weaknesses must reference specific facts about THIS business — team members by name, specific DSCR numbers, specific margin of safety percentage. Generic SWOT items like "strong management team" without naming anyone are unacceptable.
```

### Orchestrator Wiring

In `sbaPackageOrchestrator.ts`, update the parallel narrative calls to pass the extracted research:

```typescript
// Build management bios string for prompts
const managementBios = assumptions.managementTeam
  .map(m => `${m.name} (${m.title}, ${m.ownershipPct ?? 0}% ownership, ${m.yearsInIndustry} years in industry): ${m.bio}`)
  .join("\n");

// Update generateExecutiveSummary call:
generateExecutiveSummary({
  // ... existing params ...
  managementBios,
  city: deal?.city ?? null,
  state: deal?.state ?? null,
  borrowerProfile: research.borrowerProfile,
  creditThesis: research.creditThesis,
  equityInjectionPct: sourcesAndUses.equityInjection.actualPct,
}),

// Update generateIndustryAnalysis call:
generateIndustryAnalysis({
  // ... existing params ...
  industryOverview: research.industryOverview,
  industryOutlook: research.industryOutlook,
  competitiveLandscape: research.competitiveLandscape,
  regulatoryEnvironment: research.regulatoryEnvironment,
  marketIntelligence: research.marketIntelligence,
}),

// Update generateSWOTAnalysis call:
generateSWOTAnalysis({
  // ... existing params ...
  managementBios,
  borrowerProfile: research.borrowerProfile,
  competitiveLandscape: research.competitiveLandscape,
  industryOutlook: research.industryOutlook,
}),
```

### Model Upgrade for Narratives

The current `MODEL_SBA_NARRATIVE = GEMINI_FLASH` is optimized for speed but produces generic prose. For a god-tier business plan, the narrative quality matters more than latency (the borrower is already waiting for generation).

**File:** `src/lib/ai/models.ts` (MODIFY)

```typescript
// CHANGE:
export const MODEL_SBA_NARRATIVE = GEMINI_FLASH;
// TO:
export const MODEL_SBA_NARRATIVE = GEMINI_PRO;  // "gemini-3.1-pro-preview"
```

This gives the narrative generator the same deep-reasoning model used for credit memo narratives. The tradeoff is ~10-15 seconds more per call, but since the 4 new calls run in parallel via `Promise.allSettled`, the total wall-clock time increase is ~15 seconds max on top of the existing ~30 second generation.

**IMPORTANT:** `GEMINI_PRO` is `gemini-3.1-pro-preview` which is a Gemini 3.x model. The existing `callGeminiJSON()` in `sbaPackageNarrative.ts` uses `thinkingConfig: { thinkingBudget: 0 }`. For gemini-3.x models, this must be adjusted — set `thinkingBudget: 1024` to enable reasoning without excessive token usage. Also, `temperature` must NOT be set for gemini-3.x models (per the `isGemini3Model()` predicate in models.ts).

Update `callGeminiJSON()`:

```typescript
import { isGemini3Model } from "@/lib/ai/models";

async function callGeminiJSON(prompt: string): Promise<string> {
  // ... existing code ...
  const isGemini3 = isGemini3Model(GEMINI_MODEL);
  
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,  // INCREASED from 4096 — longer, richer narratives
      ...(isGemini3
        ? { thinkingConfig: { thinkingBudget: 1024 } }
        : { thinkingConfig: { thinkingBudget: 0 } }),
      // NO temperature field for gemini-3.x
      ...(!isGemini3 ? { temperature: 0.7 } : {}),
    },
  }),
```

---

## Priority C — CCO Review Dashboard

### Problem

After the business plan is generated, the CCO (reviewer) needs to approve it before submission to a lender. Currently they have to download a 16-page PDF and read it end-to-end. For a 15-20 minute review cycle, they need a purpose-built screen that surfaces the key decision points at a glance.

### New Component: `src/components/sba/SBACCOReviewDashboard.tsx`

```typescript
"use client";

import { useState, useEffect } from "react";
import type { SBAPackageData, BenchmarkWarning, GlobalCashFlowResult, SourcesAndUsesResult } from "@/lib/sba/sbaReadinessTypes";

interface Props {
  dealId: string;
  packageId: string;
}

// Fetches the full package data and renders a review dashboard with:
// 1. VERDICT HEADER — large green/amber/red indicator:
//    - GREEN: DSCR passes all years, equity meets minimum, no critical benchmark warnings
//    - AMBER: DSCR passes but downside is tight, OR equity is marginal, OR benchmark warnings exist
//    - RED: DSCR fails in any year, OR equity below minimum
//
// 2. KEY METRICS ROW — 4 cards:
//    - DSCR Y1 Base (with color + SBA threshold)
//    - Global DSCR (if guarantor data exists)
//    - Break-Even Margin of Safety (with % and flag if <10%)
//    - Equity Injection (with % and pass/fail)
//
// 3. RISK FLAGS — expandable list of:
//    - Benchmark warnings from sbaAssumptionBenchmarks (amber/red severity)
//    - Package warnings (franchise eligibility, etc.)
//    - DSCR below threshold in any scenario
//    - Negative guarantor personal cash flow
//
// 4. NARRATIVE PREVIEW — collapsible sections for each narrative:
//    - Executive Summary (first 200 chars visible, click to expand)
//    - Industry Analysis
//    - SWOT (4 quadrant mini-display)
//    - Sensitivity Commentary
//    Each with an "Edit" button that opens inline editing (text area with save)
//
// 5. FINANCIAL SNAPSHOT — mini-tables:
//    - P&L summary (Revenue, EBITDA, Net Income, DSCR for base year + Y1-Y3)
//    - Sources & Uses summary with equity callout
//    - Monthly CF Year 1 — highlight minimum cumulative cash month
//
// 6. ACTION BAR — bottom sticky:
//    - "Download PDF" button
//    - "Request Changes" button (sets status to 'revision_requested', adds note)
//    - "Approve for Submission" button (sets status to 'reviewed')
//    - "Submit to Lender" button (sets status to 'submitted', only enabled if reviewed)
```

### New API Route: `src/app/api/deals/[dealId]/sba/review/route.ts`

```typescript
// GET: Returns full package data for review dashboard
//   - Package record from buddy_sba_packages
//   - Benchmark warnings
//   - Global cash flow data
//   - Sources and uses
//   - All narrative sections

// PUT: Updates package status and adds reviewer notes
//   Body: { action: 'approve' | 'request_changes' | 'submit', notes?: string }
//   - 'approve': sets status = 'reviewed', reviewed_at = now()
//   - 'request_changes': sets status = 'revision_requested', stores notes
//   - 'submit': sets status = 'submitted', submitted_at = now()
//     GATE: can only submit if status is 'reviewed'

// PATCH: Inline narrative edits
//   Body: { field: 'executive_summary' | 'industry_analysis' | ..., value: string }
//   - Updates the specific narrative column on the package
//   - Regenerates PDF with updated narrative (non-blocking — PDF regenerates async)
```

### DB Schema

```sql
ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS reviewer_notes text,
  ADD COLUMN IF NOT EXISTS revision_requested_at timestamptz;
```

### Route Integration

Add a tab/link to the CCO review dashboard from the existing SBA Package tab in the underwrite cockpit. When the CCO clicks "Review Package" from `SBAPackageViewer.tsx`, it navigates to `/(app)/deals/[dealId]/underwrite?tab=sba-review` or opens the `SBACCOReviewDashboard` in a modal.

---

## Priority D — Auto-Generate with Progress

### Problem

Currently: borrower fills assumptions → clicks "Confirm" → manually navigates to generate → clicks "Generate" → waits with no feedback → sees result.

God tier: borrower clicks "Confirm Assumptions" → generation starts immediately → live progress indicator shows each step → PDF appears when done.

### File: `src/app/api/deals/[dealId]/sba/generate/route.ts` (MODIFY)

Change the generation endpoint to return a streaming response with progress events:

```typescript
export async function POST(req: NextRequest, ctx: { params: Params }) {
  // ... existing gates ...

  // Return a streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendProgress(step: string, pct: number) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ step, pct })}\n\n`)
        );
      }

      try {
        sendProgress("Loading financial data...", 5);
        // ... fact loading ...

        sendProgress("Building financial projections...", 15);
        // ... model passes ...

        sendProgress("Computing break-even analysis...", 25);
        // ... break even + sensitivity ...

        sendProgress("Building Sources & Uses...", 30);
        // ... S&U, balance sheet, global CF ...

        sendProgress("Writing Executive Summary...", 40);
        // ... Gemini calls (parallel) ...
        // Each call can update individually:
        sendProgress("Writing Industry Analysis...", 50);
        sendProgress("Writing Marketing Strategy...", 55);
        sendProgress("Writing SWOT Analysis...", 60);

        sendProgress("Rendering PDF...", 80);
        // ... PDF render ...

        sendProgress("Cross-filling SBA forms...", 90);
        // ... form cross-fill ...

        sendProgress("Complete!", 100);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            step: "complete",
            pct: 100,
            result: { ok: true, packageId, dscrYear1Base, pdfUrl, versionNumber }
          })}\n\n`)
        );
      } catch (e) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            step: "error",
            pct: 0,
            error: e instanceof Error ? e.message : "Unknown error"
          })}\n\n`)
        );
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

### File: `src/components/sba/AssumptionInterview.tsx` (MODIFY)

On the final "Confirm" step, after saving assumptions with status 'confirmed':

```typescript
// Instead of just showing "Confirmed! Go generate.", immediately trigger generation:
async function handleConfirmAndGenerate() {
  // 1. Save assumptions as confirmed
  await fetch(`/api/deals/${dealId}/sba/assumptions`, {
    method: "PUT",
    body: JSON.stringify({ ...assumptions, status: "confirmed" }),
  });

  // 2. Immediately start generation with SSE streaming
  setGenerating(true);
  setGenerationStep("Starting...");
  setGenerationPct(0);

  const eventSource = new EventSource(`/api/deals/${dealId}/sba/generate-stream`);
  // NOTE: EventSource only works with GET. For POST, use fetch with ReadableStream:

  const response = await fetch(`/api/deals/${dealId}/sba/generate`, {
    method: "POST",
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    const lines = text.split("\n\n").filter(Boolean);
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        setGenerationStep(data.step);
        setGenerationPct(data.pct);
        if (data.step === "complete") {
          setGenerating(false);
          setPackageResult(data.result);
          // Auto-navigate to package viewer or CCO review
        }
        if (data.step === "error") {
          setGenerating(false);
          setError(data.error);
        }
      }
    }
  }
}
```

### New Component: `src/components/sba/SBAGenerationProgress.tsx`

```typescript
"use client";

interface Props {
  step: string;
  pct: number;
  generating: boolean;
}

export default function SBAGenerationProgress({ step, pct, generating }: Props) {
  if (!generating) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0f1a] p-8 shadow-2xl">
        {/* Buddy branding */}
        <div className="mb-6 text-center">
          <div className="text-sm font-semibold uppercase tracking-wider text-blue-400">
            Buddy The Underwriter
          </div>
          <h2 className="mt-2 text-xl font-bold text-white">
            Building Your Business Plan
          </h2>
        </div>

        {/* Progress bar */}
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Step label */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/70">{step}</span>
          <span className="font-mono text-white/50">{pct}%</span>
        </div>

        {/* Step detail animation */}
        <div className="mt-6 space-y-2">
          {[
            { label: "Financial Projections", threshold: 15 },
            { label: "Break-Even & Sensitivity", threshold: 25 },
            { label: "Executive Summary", threshold: 40 },
            { label: "Industry Analysis", threshold: 50 },
            { label: "Marketing & SWOT", threshold: 60 },
            { label: "PDF Generation", threshold: 80 },
            { label: "SBA Form Cross-Fill", threshold: 90 },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-xs">
              {pct >= item.threshold + 10 ? (
                <span className="text-emerald-400">✓</span>
              ) : pct >= item.threshold ? (
                <span className="animate-pulse text-blue-400">●</span>
              ) : (
                <span className="text-white/20">○</span>
              )}
              <span className={pct >= item.threshold ? "text-white/70" : "text-white/30"}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          This typically takes 30–60 seconds
        </p>
      </div>
    </div>
  );
}
```

---

## Implementation Order

1. **`sbaResearchExtractor.ts`** — new file, pure function + 1 DB query, no dependencies
2. **Export `findBenchmarkByNaics` from `sbaAssumptionBenchmarks.ts`** — rename existing private function
3. **Update `sbaAssumptionsPrefill.ts`** — NAICS-driven defaults + management team from ownership entities
4. **Update `sbaReadinessTypes.ts`** — add `PrefillMeta` interface
5. **Update assumptions API route** — return `prefillMeta`
6. **Update `sbaPackageNarrative.ts`** — richer prompts with research injection, management bios, city/state, model upgrade
7. **Update `callGeminiJSON()`** — handle gemini-3.x thinking config and temperature
8. **Update `sbaPackageOrchestrator.ts`** — use `extractResearchForBusinessPlan()`, pass richer data to all narrative calls
9. **Migration** — add `reviewer_notes`, `revision_requested_at` to `buddy_sba_packages`
10. **`SBAGenerationProgress.tsx`** — progress overlay component
11. **Update `generate/route.ts`** — streaming SSE response with progress events
12. **Update `AssumptionInterview.tsx`** — NAICS badges, auto-generate on confirm, progress display
13. **`SBACCOReviewDashboard.tsx`** — full review dashboard
14. **`sba/review/route.ts`** — review API with approve/reject/submit/inline-edit

---

## Verification

After implementation, test this end-to-end flow:

1. Open an SBA deal with financial facts and a completed research mission
2. Navigate to the SBA tab → Assumption Interview
3. **VERIFY:** Growth rates, COGS %, DSO, DPO are pre-filled from NAICS benchmarks (not 10/8/6 generic defaults)
4. **VERIFY:** Management team names are pre-filled from ownership entities
5. **VERIFY:** Each pre-filled field shows "Industry typical for [NAICS label]" badge
6. Click through to Confirm → generation starts immediately
7. **VERIFY:** Progress overlay appears with step-by-step updates
8. Wait for completion (~45 seconds)
9. **VERIFY:** Executive summary names the actual borrower, city, management team members, and states the specific DSCR
10. **VERIFY:** Industry analysis contains content from the BIE research sections (not generic filler)
11. **VERIFY:** SWOT references specific team members and specific financial metrics
12. Navigate to CCO Review Dashboard
13. **VERIFY:** Verdict header shows correct color (green/amber/red)
14. **VERIFY:** Key metrics cards display DSCR, global DSCR, break-even, equity injection
15. **VERIFY:** Risk flags show any benchmark warnings
16. **VERIFY:** CCO can inline-edit a narrative section and save
17. **VERIFY:** CCO can approve → submit flow works

---

*End of spec. These four priorities close the gap from "good system" to "the borrower can't believe this just happened."*
