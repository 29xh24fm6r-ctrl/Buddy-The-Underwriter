# FEASIBILITY STUDY GOD TIER — PHASE 2: THE LAST MILE

**Status:** ACTIVE — implementation guide for Claude Code / Antigravity  
**Created:** April 21, 2026  
**Depends on:** `specs/FEASIBILITY_STUDY_GOD_TIER_SPEC.md` (Phase 1 — all 14 steps COMPLETE at `421d912e`)  
**Goal:** Transform the system from "elite analytical engine" to "the borrower feels they sat down with a $20,000 consultant who did all the work ahead of time"

---

## The Four Gaps

| Gap | What's missing | What it fixes |
|-----|---------------|---------------|
| A | **Trade Area Intelligence** | Market demand + location scores operate on neutral defaults today because `buildTradeAreaFromResearch` returns null. BIE research already contains demographic and competitive data in prose form — extract it. |
| B | **Cockpit Wiring + UX Polish** | No route exists at `/deals/[dealId]/feasibility`. No tab in DealShell. No SSE streaming progress. No "jaw drop" moment. |
| C | **PDF Elevation** | The renderer is functional but needs the same cover page polish, embedded charts, and professional typesetting that the business plan got in its Phase 2. |
| D | **Research-Grounded Narratives** | Narrative prompts receive dimension scores but don't inject the actual BIE research prose. The business plan's Phase 2 showed that injecting research context is the single biggest quality lever for Gemini output. |

---

## Gap A — Trade Area Intelligence from BIE Research

### Problem

The BIE's Market Intelligence thread (Thread 4 in `buddyIntelligenceEngine.ts`) already runs a Gemini grounded search that returns structured JSON with fields like `local_economic_conditions`, `demographic_trends`, `real_estate_market`, `demand_drivers`, `area_specific_risks`, and `trend_direction`. This data is stored in `buddy_research_missions` → facts/inferences and compiled into `buddy_research_narratives`.

But today the feasibility engine only gets the narrative prose via `extractResearchForBusinessPlan()`. The structured JSON from the BIE market thread — which includes the `trend_direction` enum and quantitative claims — is never extracted for the scoring engine.

### Solution: BIE Structured Market Data Extractor

**New file:** `src/lib/feasibility/bieMarketExtractor.ts`

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Structured market data extracted from BIE research facts/inferences.
 * These are the quantitative and semi-quantitative claims the BIE market
 * thread already produces but the feasibility engine didn't consume in v1.
 */
export interface BIEMarketData {
  // From market intelligence thread JSON output
  trendDirection: "improving" | "stable" | "deteriorating" | "unclear" | null;
  
  // Extracted numeric claims from research facts (if parseable)
  populationMentioned: number | null;         // population figure mentioned in research
  medianIncomeMentioned: number | null;       // median income figure mentioned
  unemploymentRateMentioned: number | null;   // unemployment rate if mentioned
  competitorCountMentioned: number | null;    // number of competitors if enumerated
  
  // Qualitative signals from research prose
  hasCompetitorNames: boolean;                // did research name specific competitors
  competitorNameCount: number;                // how many distinct competitors were named
  hasRealEstateData: boolean;                 // did research discuss RE market
  hasNaturalDisasterRisk: boolean;            // flood/hurricane/wildfire mentioned
  hasEconomicConcentrationRisk: boolean;      // single-employer / concentration mentioned
  hasCrimeRisk: boolean;                      // elevated crime mentioned
  
  // Raw text for narrative injection
  areaSpecificRisksText: string | null;
  realEstateMarketText: string | null;
  demographicTrendsText: string | null;
}

/**
 * Extract structured market data from BIE research for feasibility scoring.
 * 
 * Strategy:
 * 1. Load the latest research mission's facts where thread_origin = 'market'
 * 2. Parse the market intelligence JSON result for trend_direction
 * 3. Scan fact text for numeric patterns (population, income, competitors)
 * 4. Scan for risk keywords
 * 5. Load the narrative sections for prose injection
 */
export async function extractBIEMarketData(dealId: string): Promise<BIEMarketData> {
  const sb = supabaseAdmin();
  
  const defaults: BIEMarketData = {
    trendDirection: null,
    populationMentioned: null,
    medianIncomeMentioned: null,
    unemploymentRateMentioned: null,
    competitorCountMentioned: null,
    hasCompetitorNames: false,
    competitorNameCount: 0,
    hasRealEstateData: false,
    hasNaturalDisasterRisk: false,
    hasEconomicConcentrationRisk: false,
    hasCrimeRisk: false,
    areaSpecificRisksText: null,
    realEstateMarketText: null,
    demographicTrendsText: null,
  };
  
  // Find latest mission
  const { data: mission } = await sb
    .from("buddy_research_missions")
    .select("id")
    .eq("deal_id", dealId)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  
  if (!mission) return defaults;
  
  // Load claim ledger entries for the market thread
  const { data: claims } = await sb
    .from("buddy_research_claim_ledger")
    .select("claim_text, section, thread_origin, confidence")
    .eq("mission_id", mission.id)
    .in("thread_origin", ["market", "competitive"])
    .order("confidence", { ascending: false });
  
  if (!claims || claims.length === 0) return defaults;
  
  const allText = claims.map((c: { claim_text: string }) => c.claim_text).join(" ");
  const lowerText = allText.toLowerCase();
  
  // ── Extract trend direction ────────────────────────────────────
  // The market thread JSON includes trend_direction. Look for it in claims.
  let trendDirection: BIEMarketData["trendDirection"] = null;
  if (lowerText.includes("improving") || lowerText.includes("growth") && lowerText.includes("strong")) {
    trendDirection = "improving";
  } else if (lowerText.includes("deteriorating") || lowerText.includes("declining") || lowerText.includes("contraction")) {
    trendDirection = "deteriorating";
  } else if (lowerText.includes("stable") || lowerText.includes("steady")) {
    trendDirection = "stable";
  } else if (claims.length > 0) {
    trendDirection = "unclear";
  }
  
  // ── Extract numeric claims ─────────────────────────────────────
  
  // Population: look for patterns like "population of 47,000" or "47,000 residents"
  const popMatch = allText.match(/population[^.]*?([\d,]+(?:\.\d+)?)\s*(?:residents|people|population)?/i)
    ?? allText.match(/([\d,]+(?:\.\d+)?)\s*(?:residents|people)/i);
  const populationMentioned = popMatch ? parseNumericClaim(popMatch[1]) : null;
  
  // Median income: "median household income of $75,000" or "$75K median income"
  const incomeMatch = allText.match(/median\s+(?:household\s+)?income[^.]*?\$\s*([\d,.]+\s*[KkMm]?)/i)
    ?? allText.match(/\$\s*([\d,.]+\s*[KkMm]?)\s*median/i);
  const medianIncomeMentioned = incomeMatch ? parseNumericClaim(incomeMatch[1]) : null;
  
  // Unemployment: "unemployment rate of 4.2%" or "4.2% unemployment"
  const ueMatch = allText.match(/unemployment[^.]*?([\d.]+)\s*%/i)
    ?? allText.match(/([\d.]+)\s*%\s*unemployment/i);
  const unemploymentRateMentioned = ueMatch ? parseFloat(ueMatch[1]) / 100 : null;
  
  // Competitor count from competitive thread claims
  const competitiveClaims = claims.filter(
    (c: { thread_origin: string }) => c.thread_origin === "competitive"
  );
  const competitorNameCount = competitiveClaims.length;
  const hasCompetitorNames = competitorNameCount > 0;
  
  // ── Risk keyword scanning ──────────────────────────────────────
  const hasNaturalDisasterRisk = /flood|hurricane|wildfire|tornado|earthquake|storm surge/i.test(lowerText);
  const hasEconomicConcentrationRisk = /single.?employer|economic.?concentration|military.?base|one.?industry/i.test(lowerText);
  const hasCrimeRisk = /crime|high.?crime|elevated.?crime|safety.?concern/i.test(lowerText);
  const hasRealEstateData = /vacancy|commercial.?real.?estate|rent.?per|lease.?rate|office.?market|retail.?market/i.test(lowerText);
  
  // ── Extract prose sections for narrative injection ──────────────
  // Pull from the narrative (already extracted by sbaResearchExtractor)
  // but also build risk-specific text from claims
  const riskClaims = claims.filter((c: { claim_text: string }) => {
    const t = c.claim_text.toLowerCase();
    return t.includes("risk") || t.includes("disaster") || t.includes("flood") 
      || t.includes("crime") || t.includes("concentration") || t.includes("hurricane");
  });
  const areaSpecificRisksText = riskClaims.length > 0
    ? riskClaims.map((c: { claim_text: string }) => c.claim_text).join(" ")
    : null;
  
  const reClaims = claims.filter((c: { claim_text: string }) => {
    const t = c.claim_text.toLowerCase();
    return t.includes("vacancy") || t.includes("real estate") || t.includes("rent") || t.includes("lease");
  });
  const realEstateMarketText = reClaims.length > 0
    ? reClaims.map((c: { claim_text: string }) => c.claim_text).join(" ")
    : null;
  
  const demoClaims = claims.filter((c: { claim_text: string }) => {
    const t = c.claim_text.toLowerCase();
    return t.includes("population") || t.includes("median") || t.includes("demographic") || t.includes("income");
  });
  const demographicTrendsText = demoClaims.length > 0
    ? demoClaims.map((c: { claim_text: string }) => c.claim_text).join(" ")
    : null;
  
  return {
    trendDirection,
    populationMentioned,
    medianIncomeMentioned,
    unemploymentRateMentioned,
    competitorCountMentioned: hasCompetitorNames ? competitorNameCount : null,
    hasCompetitorNames,
    competitorNameCount,
    hasRealEstateData,
    hasNaturalDisasterRisk,
    hasEconomicConcentrationRisk,
    hasCrimeRisk,
    areaSpecificRisksText,
    realEstateMarketText,
    demographicTrendsText,
  };
}

function parseNumericClaim(raw: string): number | null {
  if (!raw) return null;
  let cleaned = raw.replace(/,/g, "").trim();
  let multiplier = 1;
  if (/[Kk]$/.test(cleaned)) { multiplier = 1000; cleaned = cleaned.slice(0, -1); }
  if (/[Mm]$/.test(cleaned)) { multiplier = 1_000_000; cleaned = cleaned.slice(0, -1); }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n * multiplier : null;
}
```

### Integration: Wire into feasibilityEngine.ts

**File:** `src/lib/feasibility/feasibilityEngine.ts` (MODIFY)

After the existing research extraction (step 3), add:

```typescript
// ── 3b. BIE structured market data ───────────────────────────
import { extractBIEMarketData } from "./bieMarketExtractor";

const bieMarket = await extractBIEMarketData(dealId).catch(() => null);
```

Then replace the `tradeArea: null` and `research` inputs across all 4 analysis calls with enriched data:

```typescript
// Build trade area from BIE extracted data
const tradeArea: TradeAreaData | null = bieMarket ? {
  populationRadius5mi: bieMarket.populationMentioned,
  populationRadius10mi: null,
  medianHouseholdIncome: bieMarket.medianIncomeMentioned,
  populationGrowthRate5yr: null,
  competitorCount: bieMarket.competitorCountMentioned,
  totalBusinesses: null,
} : null;

// Market demand — now receives trade area + competitor data
const marketDemand = analyzeMarketDemand({
  // ... existing params ...
  tradeArea,
});

// Location suitability — now receives trend direction + risk data
const locationSuitability = analyzeLocationSuitability({
  // ... existing params ...
  research: {
    marketIntelligence: research.marketIntelligence,
    areaSpecificRisks: bieMarket?.areaSpecificRisksText ?? null,
    realEstateMarket: bieMarket?.realEstateMarketText ?? null,
    trendDirection: bieMarket?.trendDirection ?? null,
  },
  tradeArea: tradeArea ? {
    unemploymentRate: bieMarket?.unemploymentRateMentioned ?? null,
    medianHouseholdIncome: tradeArea.medianHouseholdIncome,
    populationGrowthRate5yr: null,
    commercialVacancyRate: null,
    medianRentPsf: null,
  } : null,
});
```

**Impact:** This is the single highest-ROI change. It takes data that already exists in the BIE claim ledger and feeds it into the scoring engine. Market demand and location suitability scores go from neutral defaults to actual data-driven scores on every deal that has a completed research mission.

---

## Gap B — Cockpit Wiring + UX Polish

### B.1 Feasibility Route Page

**New file:** `src/app/(app)/deals/[dealId]/feasibility/page.tsx`

```typescript
import { clerkAuth } from "@/lib/auth/clerkServer";
import { redirect } from "next/navigation";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { DealPageErrorState } from "@/components/deals/DealPageErrorState";
import FeasibilityDashboard from "@/components/feasibility/FeasibilityDashboard";

export default async function DealFeasibilityPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  const { dealId } = await params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="p-6">
        <DealPageErrorState
          title={access.error === "deal_not_found" ? "Deal Not Found" : "Access Denied"}
          message={
            access.error === "deal_not_found"
              ? "This deal does not exist or has been deleted."
              : "You do not have permission to view this deal."
          }
          backHref="/deals"
          backLabel="Back to Deals"
          dealId={dealId}
          surface="feasibility"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Feasibility Study</h1>
      </div>
      <FeasibilityDashboard dealId={dealId} />
    </div>
  );
}
```

### B.2 Add Tab to DealShell

**File:** `src/app/(app)/deals/[dealId]/DealShell.tsx` (MODIFY)

In the `tabs` array, add the Feasibility tab. Insert it after "Borrower" and before "Portal":

```typescript
// Find this line:
    { label: "Borrower", href: `${base}/borrower` },
// Add immediately after:
    { label: "Feasibility", href: `${base}/feasibility` },
```

### B.3 SSE Streaming Progress

**File:** `src/app/api/deals/[dealId]/feasibility/generate/route.ts` (MODIFY)

Replace the current synchronous POST with an SSE streaming response that sends progress events:

```typescript
import { NextRequest } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractResearchForBusinessPlan } from "@/lib/sba/sbaResearchExtractor";
import { extractBIEMarketData } from "@/lib/feasibility/bieMarketExtractor";
import { findBenchmarkByNaics } from "@/lib/sba/sbaAssumptionBenchmarks";
import { analyzeMarketDemand } from "@/lib/feasibility/marketDemandAnalysis";
import { analyzeFinancialViability } from "@/lib/feasibility/financialViabilityAnalysis";
import { analyzeOperationalReadiness } from "@/lib/feasibility/operationalReadinessAnalysis";
import { analyzeLocationSuitability } from "@/lib/feasibility/locationSuitabilityAnalysis";
import { computeCompositeFeasibility } from "@/lib/feasibility/feasibilityScorer";
import { generateFeasibilityNarratives } from "@/lib/feasibility/feasibilityNarrative";
import { renderFeasibilityPDF } from "@/lib/feasibility/feasibilityRenderer";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

export async function POST(req: NextRequest, ctx: { params: Params }) {
  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return new Response(JSON.stringify({ ok: false, error: access.error }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("bank_id, name, city, state")
    .eq("id", dealId)
    .maybeSingle();
  const bankId = (deal as any)?.bank_id;
  if (!bankId) {
    return new Response(JSON.stringify({ ok: false, error: "No bank_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check if client wants SSE
  const wantsStream = req.headers.get("accept")?.includes("text/event-stream");

  if (!wantsStream) {
    // Fallback: synchronous (for backward compat)
    const { generateFeasibilityStudy } = await import(
      "@/lib/feasibility/feasibilityEngine"
    );
    const result = await generateFeasibilityStudy({ dealId, bankId });
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // SSE streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(step: string, pct: number, extra?: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ step, pct, ...extra })}\n\n`)
        );
      }

      try {
        send("Loading deal data…", 5);
        // ... gather all inputs (same as feasibilityEngine.ts steps 1-9) ...

        send("Extracting research intelligence…", 15);
        const research = await extractResearchForBusinessPlan(dealId).catch(() => ({
          industryOverview: null, industryOutlook: null, competitiveLandscape: null,
          marketIntelligence: null, borrowerProfile: null, managementIntelligence: null,
          regulatoryEnvironment: null, creditThesis: null, threeToFiveYearOutlook: null,
        }));
        const bieMarket = await extractBIEMarketData(dealId).catch(() => null);

        send("Analyzing market demand…", 25);
        // ... run marketDemand ...

        send("Evaluating financial viability…", 35);
        // ... run financialViability ...

        send("Assessing operational readiness…", 45);
        // ... run operationalReadiness + locationSuitability ...

        send("Computing composite feasibility score…", 55);
        // ... compute composite ...

        send("Writing executive summary…", 60);
        send("Writing market analysis…", 65);
        send("Writing financial assessment…", 70);
        send("Writing operational review…", 75);
        // ... run narrative generation ...

        send("Rendering feasibility report…", 85);
        // ... render PDF + upload ...

        send("Saving results…", 95);
        // ... insert into buddy_feasibility_studies ...

        send("Complete!", 100, {
          result: {
            ok: true,
            studyId: study?.id,
            compositeScore: composite.overallScore,
            recommendation: composite.recommendation,
          },
        });
      } catch (err) {
        send("Error", 0, {
          error: err instanceof Error ? err.message : "Generation failed",
        });
      } finally {
        controller.close();
      }
    },
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

**NOTE:** The full inline orchestration duplicates logic from `feasibilityEngine.ts`. To avoid duplication, the cleaner approach is to refactor `generateFeasibilityStudy` to accept an optional `onProgress` callback. The route passes the callback for SSE mode:

```typescript
// In feasibilityEngine.ts, change signature:
export async function generateFeasibilityStudy(params: {
  dealId: string;
  bankId: string;
  onProgress?: (step: string, pct: number) => void;
}): Promise<FeasibilityResult> {
  const progress = params.onProgress ?? (() => {});
  
  progress("Loading deal data…", 5);
  // ... existing step 1 ...
  
  progress("Extracting research intelligence…", 15);
  // ... existing step 3 ...
  
  // ... etc for each step ...
}
```

Then the route just passes the SSE sender:

```typescript
const result = await generateFeasibilityStudy({
  dealId,
  bankId,
  onProgress: (step, pct) => send(step, pct),
});
```

### B.4 Dashboard Progress Overlay

**File:** `src/components/feasibility/FeasibilityDashboard.tsx` (MODIFY)

Replace the current `onGenerate` with SSE-consuming logic:

```typescript
const onGenerate = useCallback(async () => {
  setGenerating(true);
  setError(null);
  setProgressStep("Starting…");
  setProgressPct(0);

  try {
    const res = await fetch(`/api/deals/${dealId}/feasibility/generate`, {
      method: "POST",
      headers: { Accept: "text/event-stream" },
    });

    if (!res.body) {
      // Fallback: non-streaming response
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "Failed");
      await load();
      setGenerating(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split("\n\n").filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            setProgressStep(data.step);
            setProgressPct(data.pct);
            if (data.step === "Complete!") {
              await load();
              setGenerating(false);
            }
            if (data.error) {
              setError(data.error);
              setGenerating(false);
            }
          } catch { /* malformed SSE event, skip */ }
        }
      }
    }
  } catch {
    setError("Network error");
  } finally {
    setGenerating(false);
  }
}, [dealId, load]);
```

Add a progress overlay component (same pattern as the SBA `SBAGenerationProgress.tsx`):

```typescript
// Inside the FeasibilityDashboard return, when generating:
{generating && (
  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 space-y-4">
    <div className="text-center">
      <div className="text-sm font-semibold uppercase tracking-wider text-blue-400">
        Buddy The Underwriter
      </div>
      <h2 className="mt-2 text-lg font-bold text-white">
        Running Feasibility Analysis
      </h2>
    </div>

    {/* Progress bar */}
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
        style={{ width: `${progressPct}%` }}
      />
    </div>

    <div className="flex items-center justify-between text-sm">
      <span className="text-white/70">{progressStep}</span>
      <span className="font-mono text-white/50">{progressPct}%</span>
    </div>

    {/* Step checklist */}
    <div className="space-y-2">
      {[
        { label: "Loading deal data", threshold: 5 },
        { label: "Extracting research intelligence", threshold: 15 },
        { label: "Analyzing market demand", threshold: 25 },
        { label: "Evaluating financial viability", threshold: 35 },
        { label: "Assessing readiness & location", threshold: 45 },
        { label: "Computing composite score", threshold: 55 },
        { label: "Writing consultant narratives", threshold: 60 },
        { label: "Rendering feasibility report", threshold: 85 },
      ].map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-xs">
          {progressPct >= item.threshold + 15 ? (
            <span className="text-emerald-400">✓</span>
          ) : progressPct >= item.threshold ? (
            <span className="animate-pulse text-blue-400">●</span>
          ) : (
            <span className="text-white/20">○</span>
          )}
          <span className={progressPct >= item.threshold ? "text-white/70" : "text-white/30"}>
            {item.label}
          </span>
        </div>
      ))}
    </div>

    <p className="text-center text-xs text-white/40">
      This typically takes 45–90 seconds
    </p>
  </div>
)}
```

### B.5 Feasibility Score Badge in DealShell Header

**File:** `src/app/(app)/deals/[dealId]/DealShell.tsx` (MODIFY)

Add a feasibility score capsule in the header metrics row (alongside the financial snapshot capsule):

**New component:** `src/components/feasibility/FeasibilityScoreCapsule.tsx`

```typescript
"use client";

import { useEffect, useState } from "react";

function colorFor(score: number): string {
  if (score >= 80) return "bg-emerald-600/20 text-emerald-300 border-emerald-500/30";
  if (score >= 65) return "bg-blue-600/20 text-blue-300 border-blue-500/30";
  if (score >= 50) return "bg-amber-600/20 text-amber-200 border-amber-500/30";
  if (score >= 35) return "bg-orange-600/20 text-orange-200 border-orange-500/30";
  return "bg-rose-600/20 text-rose-200 border-rose-500/30";
}

export function FeasibilityScoreCapsule({ dealId }: { dealId: string }) {
  const [data, setData] = useState<{
    score: number;
    recommendation: string;
    confidence: string;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/deals/${dealId}/feasibility/latest`)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.study) {
          setData({
            score: json.study.composite_score,
            recommendation: json.study.recommendation,
            confidence: json.study.confidence_level,
          });
        }
      })
      .catch(() => {});
  }, [dealId]);

  if (!data) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <span className="text-xs text-white/60">Feasibility</span>
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${colorFor(data.score)}`}
      >
        {data.score}/100
      </span>
      <span className="text-xs text-white/60">{data.recommendation}</span>
    </div>
  );
}
```

Import and render in DealShell's hidden lg header metrics row, after `<MatchedLendersCapsule>`:

```typescript
import { FeasibilityScoreCapsule } from "@/components/feasibility/FeasibilityScoreCapsule";

// In the metrics row:
<FeasibilityScoreCapsule dealId={dealId} />
```

---

## Gap C — PDF Elevation

### C.1 Cover Page Polish

**File:** `src/lib/feasibility/feasibilityRenderer.ts` (MODIFY)

The cover page is already built and looks good. Enhancements:

```typescript
// In renderCoverPage, add a top branding bar (matching SBA business plan cover):
// Before the title block:
doc.rect(0, 0, doc.page.width, 80).fill(BRAND_NAVY);
doc.font(FONT_BOLD).fontSize(11).fillColor("#ffffff");
doc.text("BUDDY THE UNDERWRITER", PAGE_MARGIN, 30, {
  width: doc.page.width - PAGE_MARGIN * 2,
});
doc.text("FEASIBILITY STUDY", doc.page.width - PAGE_MARGIN - 200, 30, {
  width: 200,
  align: "right",
});
doc.fillColor("#000000");

// Shift all subsequent cover page elements down by 80px to account for the bar
```

### C.2 Scorecard Page — Radar Chart

**File:** `src/lib/feasibility/feasibilityRenderer.ts` (MODIFY)

In `renderScorecardPage`, after the 4 score bars, add a radar/spider chart showing the 4 dimensions:

```typescript
function renderRadarChart(s: DocState) {
  const { doc, input } = s;
  const cx = doc.page.width / 2;
  const cy = s.y + 100;
  const radius = 80;
  
  const dims = [
    { label: "Market", score: input.composite.marketDemand.score },
    { label: "Financial", score: input.composite.financialViability.score },
    { label: "Operations", score: input.composite.operationalReadiness.score },
    { label: "Location", score: input.composite.locationSuitability.score },
  ];
  
  // Draw concentric rings at 25, 50, 75, 100
  for (const ring of [25, 50, 75, 100]) {
    const r = (ring / 100) * radius;
    doc.save();
    doc.opacity(0.15);
    // Draw diamond shape (4 points)
    const points = dims.map((_, i) => {
      const angle = (Math.PI / 2) + (i * Math.PI * 2) / dims.length;
      return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
    });
    doc.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      doc.lineTo(points[i].x, points[i].y);
    }
    doc.closePath().stroke("#666666");
    doc.restore();
  }
  
  // Draw score polygon
  const scorePoints = dims.map((d, i) => {
    const r = (d.score / 100) * radius;
    const angle = (Math.PI / 2) + (i * Math.PI * 2) / dims.length;
    return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  });
  
  doc.save();
  doc.opacity(0.25);
  doc.moveTo(scorePoints[0].x, scorePoints[0].y);
  for (let i = 1; i < scorePoints.length; i++) {
    doc.lineTo(scorePoints[i].x, scorePoints[i].y);
  }
  doc.closePath().fill(scoreColor(input.composite.overallScore));
  doc.restore();
  
  // Score polygon outline
  doc.moveTo(scorePoints[0].x, scorePoints[0].y);
  for (let i = 1; i < scorePoints.length; i++) {
    doc.lineTo(scorePoints[i].x, scorePoints[i].y);
  }
  doc.closePath().lineWidth(2).stroke(scoreColor(input.composite.overallScore));
  
  // Labels
  const labelOffset = radius + 20;
  for (let i = 0; i < dims.length; i++) {
    const angle = (Math.PI / 2) + (i * Math.PI * 2) / dims.length;
    const lx = cx + labelOffset * Math.cos(angle);
    const ly = cy - labelOffset * Math.sin(angle);
    doc.font(FONT_BOLD).fontSize(8).fillColor("#374151");
    doc.text(`${dims[i].label} (${dims[i].score})`, lx - 35, ly - 4, {
      width: 70,
      align: "center",
    });
  }
  
  doc.fillColor("#000000");
  s.y = cy + radius + 40;
}
```

### C.3 Risk Matrix Visualization

In the Risk Assessment page, before the flag list, add a severity × dimension matrix:

```typescript
function renderRiskMatrix(s: DocState) {
  const { doc, input } = s;
  const flags = input.composite.allFlags;
  if (!flags.length) return;
  
  const dims = ["populationAdequacy", "incomeAlignment", "competitiveDensity", "demandTrend",
    "debtServiceCoverage", "breakEvenMargin", "capitalizationAdequacy", "cashRunway", "downsideResilience",
    "managementExperience", "industryKnowledge", "staffingReadiness", "franchiseSupport",
    "economicHealth", "realEstateMarket", "accessAndVisibility", "riskExposure"];
  
  // Count flags per severity
  const critical = flags.filter(f => f.severity === "critical").length;
  const warning = flags.filter(f => f.severity === "warning").length;
  const info = flags.filter(f => f.severity === "info").length;
  
  doc.font(FONT_BOLD).fontSize(FONT_SIZE_BODY).fillColor("#000000");
  doc.text(`Risk Summary: ${critical} critical, ${warning} warning, ${info} informational`, PAGE_MARGIN, s.y);
  s.y += 20;
  
  // Visual severity bar
  const totalFlags = flags.length;
  const barW = 300;
  const barH = 12;
  const x = PAGE_MARGIN;
  
  if (critical > 0) {
    const w = (critical / totalFlags) * barW;
    doc.rect(x, s.y, w, barH).fill("#dc2626");
  }
  if (warning > 0) {
    const w = (warning / totalFlags) * barW;
    const offset = (critical / totalFlags) * barW;
    doc.rect(x + offset, s.y, w, barH).fill("#d97706");
  }
  if (info > 0) {
    const w = (info / totalFlags) * barW;
    const offset = ((critical + warning) / totalFlags) * barW;
    doc.rect(x + offset, s.y, w, barH).fill("#2563eb");
  }
  
  doc.fillColor("#000000");
  s.y += barH + 16;
}
```

---

## Gap D — Research-Grounded Narratives

### Problem

The narrative prompts in `feasibilityNarrative.ts` receive the dimension scores and their detail strings, but they don't receive the actual BIE research prose. The business plan's Phase 2 proved that injecting `research.marketIntelligence`, `research.competitiveLandscape`, etc. into the Gemini prompts is the single biggest quality differentiator — it turns generic prose into deal-specific analysis.

### Solution

**File:** `src/lib/feasibility/feasibilityNarrative.ts` (MODIFY)

Add research injection to every narrative prompt. The function signature already accepts `research: ExtractedResearch` — it just isn't being used in the prompt text.

For each Gemini call, add the relevant research section at the end of the prompt:

```typescript
// Executive Summary — add research context:
${params.research.borrowerProfile ? `\n\nBorrower Research Context:\n${params.research.borrowerProfile.slice(0, 2000)}` : ""}
${params.research.creditThesis ? `\n\nCredit Thesis from Research:\n${params.research.creditThesis.slice(0, 1500)}` : ""}

// Market Demand — add competitive + market intelligence:
${params.research.marketIntelligence ? `\n\nBIE Market Intelligence (use specific claims from this):\n${params.research.marketIntelligence.slice(0, 3000)}` : ""}
${params.research.competitiveLandscape ? `\n\nBIE Competitive Landscape (name competitors from this):\n${params.research.competitiveLandscape.slice(0, 2000)}` : ""}

// Financial Viability — add industry context:
${params.research.industryOverview ? `\n\nIndustry Context:\n${params.research.industryOverview.slice(0, 1500)}` : ""}

// Operational Readiness — add management intelligence:
${params.research.managementIntelligence ? `\n\nManagement Intelligence from Research:\n${params.research.managementIntelligence.slice(0, 2000)}` : ""}

// Location Suitability — add market + regulatory:
${params.research.marketIntelligence ? `\n\nLocal Market Research:\n${params.research.marketIntelligence.slice(0, 2000)}` : ""}
${params.research.regulatoryEnvironment ? `\n\nRegulatory Context:\n${params.research.regulatoryEnvironment.slice(0, 1000)}` : ""}

// Risk Assessment — add all available research for context:
${params.research.creditThesis ? `\n\nCredit Thesis:\n${params.research.creditThesis.slice(0, 1500)}` : ""}
${params.research.threeToFiveYearOutlook ? `\n\n3-5 Year Outlook:\n${params.research.threeToFiveYearOutlook.slice(0, 1500)}` : ""}

// Recommendation — add credit thesis + outlook:
${params.research.creditThesis ? `\n\nCredit Thesis:\n${params.research.creditThesis.slice(0, 1000)}` : ""}
```

Also add to each prompt:

```
CRITICAL: When research context is provided, reference specific facts from it — named competitors, specific demographic data, specific industry trends. The reader should feel that the analyst studied this specific business and market deeply. Generic statements like "the local economy appears healthy" when the research says "Flowery Branch median household income is $78,400 and population grew 12% from 2020-2025" are unacceptable.
```

---

## Migration Summary

**No new migrations required.** All changes operate within the existing `buddy_feasibility_studies` schema and existing BIE tables.

---

## New Files (3)

| File | Gap | Purpose |
|------|-----|---------|
| `src/lib/feasibility/bieMarketExtractor.ts` | A | Extracts structured market data from BIE claim ledger for scoring |
| `src/app/(app)/deals/[dealId]/feasibility/page.tsx` | B | Route page — auth + tenant gate + renders FeasibilityDashboard |
| `src/components/feasibility/FeasibilityScoreCapsule.tsx` | B | Compact score badge for DealShell header |

## Modified Files (5)

| File | Gap | Changes |
|------|-----|---------|
| `src/lib/feasibility/feasibilityEngine.ts` | A | Add BIE market data extraction, build trade area from extracted data, add onProgress callback |
| `src/app/(app)/deals/[dealId]/DealShell.tsx` | B | Add Feasibility tab + FeasibilityScoreCapsule import |
| `src/app/api/deals/[dealId]/feasibility/generate/route.ts` | B | SSE streaming progress via onProgress callback |
| `src/components/feasibility/FeasibilityDashboard.tsx` | B | SSE-consuming progress overlay with step checklist |
| `src/lib/feasibility/feasibilityNarrative.ts` | D | Inject BIE research prose into all 8 narrative prompts |
| `src/lib/feasibility/feasibilityRenderer.ts` | C | Branding bar on cover, radar chart on scorecard, risk matrix visualization |

---

## Implementation Order

1. **`bieMarketExtractor.ts`** — new file, pure function + 2 DB queries. Test with a deal that has a completed research mission.
2. **`feasibilityEngine.ts`** — add BIE market extraction + onProgress callback. Run `tsc --noEmit`.
3. **`feasibilityNarrative.ts`** — inject research prose into all prompts. No structural changes, just prompt text additions.
4. **`feasibilityRenderer.ts`** — branding bar, radar chart, risk matrix. Test PDF output visually.
5. **`feasibility/page.tsx`** — new route page. Verify it renders at `/deals/[dealId]/feasibility`.
6. **`DealShell.tsx`** — add tab + capsule. Verify tab appears and links correctly.
7. **`FeasibilityScoreCapsule.tsx`** — new component. Verify it renders in the DealShell header.
8. **`generate/route.ts`** — SSE streaming. Verify progress events arrive in the dashboard.
9. **`FeasibilityDashboard.tsx`** — SSE consumer + progress overlay. Full end-to-end test.

**Each step is independently testable. No step breaks the existing generate flow.** The onProgress callback defaults to no-op, so the existing synchronous path works unchanged until the route is upgraded.

---

## Verification

After implementation, test this end-to-end:

1. Open a deal with a completed BIE research mission and SBA projections
2. Navigate to the **Feasibility** tab (should appear in DealShell tab bar)
3. Click **Run Feasibility Study**
4. **VERIFY:** Progress overlay appears with step-by-step updates
5. **VERIFY:** Steps complete in sequence with percentage advancing
6. Wait for completion (~60-90 seconds)
7. **VERIFY:** Composite score gauge renders with correct color
8. **VERIFY:** All 4 dimension bars show non-default scores (not all 50s)
9. **VERIFY:** Market demand score reflects BIE-extracted population/income/competitor data
10. **VERIFY:** Location suitability shows trend direction from BIE research
11. **VERIFY:** Flags panel shows any critical/warning flags from the data
12. **VERIFY:** Expandable sub-dimensions show data sources and detail text
13. Click **Download Full Report (PDF)**
14. **VERIFY:** Cover page has navy branding bar + large score badge
15. **VERIFY:** Scorecard page has radar chart
16. **VERIFY:** Narrative sections reference specific BIE research findings (named competitors, demographic figures)
17. **VERIFY:** Risk assessment page has severity bar + individual flag mitigations
18. Return to deal header
19. **VERIFY:** FeasibilityScoreCapsule shows score/100 + recommendation in the metrics row

---

*End of spec. These four gaps close the distance from "elite engine" to "the borrower's jaw drops." Copy-pasteable for Claude Code.*
