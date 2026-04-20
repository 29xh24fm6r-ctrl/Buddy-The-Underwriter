import "server-only";

// src/lib/sba/sbaResearchProjectionGenerator.ts
// Phase 85-BPG-ELITE — Research-powered auto-generation of complete SBAAssumptions.
//
// Pulls together:
//   1. BIE research facts + inferences (buddy_research_*)
//   2. NAICS benchmarks (sbaAssumptionBenchmarks)
//   3. Financial-document prefill (sbaAssumptionsPrefill)
//   4. Intake address/owners/loan (deal_builder_sections)
//
// Returns a complete SBAAssumptions object plus a borrower-facing research
// briefing — never blocking, always graceful: missing data sources degrade
// the confidence label but do not throw.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadSBAAssumptionsPrefill } from "./sbaAssumptionsPrefill";
import { findBenchmarkByNaics } from "./sbaAssumptionBenchmarks";
import { MODEL_SBA_NARRATIVE } from "@/lib/ai/models";
import type {
  SBAAssumptions,
  RevenueStream,
  FixedCostCategory,
  ManagementMember,
} from "./sbaReadinessTypes";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export interface ResearchContext {
  // From BIE research facts
  marketSize: number | null;
  marketGrowthRate: number | null;
  establishmentCount: number | null;
  employmentCount: number | null;
  averageWage: number | null;
  medianIncome: number | null;
  population: number | null;
  populationGrowthRate: number | null;

  // From BIE inferences
  competitiveIntensity: string | null;
  marketAttractiveness: string | null;
  growthTrajectory: string | null;
  cyclicalityRisk: string | null;
  demandStability: string | null;

  // From NAICS benchmarks
  naicsCode: string | null;
  naicsLabel: string | null;
  revenueGrowthMedian: number;
  cogsMedian: number;
  dsoMedian: number;
  dpoMedian: number;
  fixedCostEscalationMedian: number;
}

export interface GeneratedProjectionResult {
  assumptions: SBAAssumptions;
  researchContext: ResearchContext;
  researchNarrative: string;
  confidenceLevel: "high" | "medium" | "low";
  dataSources: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * buddy_research_facts.value is jsonb — could be a primitive (number/string),
 * a wrapped object like {value: 4.2, unit: "%"}, or null. Coerce to number
 * defensively; never throw.
 */
function jsonbToNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const stripped = raw.replace(/[,$%\s]/g, "");
    const n = Number(stripped);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("value" in obj) return jsonbToNumber(obj.value);
    if ("amount" in obj) return jsonbToNumber(obj.amount);
    if ("number" in obj) return jsonbToNumber(obj.number);
  }
  return null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Main entry ──────────────────────────────────────────────────────────

export async function generateProjectionsFromResearch(
  dealId: string,
): Promise<GeneratedProjectionResult> {
  const sb = supabaseAdmin();

  // 1. Document-derived prefill (revenue streams, COGS, fixed costs from facts)
  const prefill = await loadSBAAssumptionsPrefill(dealId);

  // 2. Deal + business context
  const { data: deal } = await sb
    .from("deals")
    .select("id, name, deal_type, loan_amount, borrower_id")
    .eq("id", dealId)
    .maybeSingle();

  const { data: app } = await sb
    .from("borrower_applications")
    .select("naics, industry, business_legal_name")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const naicsCode: string | null = app?.naics ?? null;
  const industryDesc: string | null = app?.industry ?? null;
  const businessName: string =
    app?.business_legal_name ?? deal?.name ?? "Business";

  // 3. Address / owners / loan from intake sections
  const { data: addrSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", dealId)
    .eq("section_key", "address")
    .maybeSingle();
  const addrData = (addrSection?.data ?? {}) as Record<string, unknown>;
  const city = typeof addrData.city === "string" ? addrData.city : null;
  const state = typeof addrData.state === "string" ? addrData.state : null;
  const geography =
    city && state ? `${city}, ${state}` : (state ?? null);

  const { data: ownerSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", dealId)
    .eq("section_key", "owners")
    .maybeSingle();
  const intakeOwners = Array.isArray(
    (ownerSection?.data as { owners?: unknown })?.owners,
  )
    ? ((ownerSection!.data as { owners: Array<Record<string, unknown>> }).owners)
    : [];

  const { data: loanSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", dealId)
    .eq("section_key", "loan")
    .maybeSingle();
  const loanData = (loanSection?.data ?? {}) as Record<string, unknown>;
  const rawAmount = loanData.amount;
  const loanAmount =
    typeof rawAmount === "number"
      ? rawAmount
      : typeof rawAmount === "string"
        ? parseFloat(rawAmount.replace(/[^0-9.]/g, "")) || 0
        : (deal?.loan_amount ?? 0);
  const loanPurpose =
    typeof loanData.purpose === "string" ? loanData.purpose : "business purposes";

  // 4. BIE research mission (most recent completed)
  const { data: mission } = await sb
    .from("buddy_research_missions")
    .select("id, status")
    .eq("deal_id", dealId)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  type FactRow = { fact_type: string; value: unknown; confidence: number | null };
  type InfRow = { inference_type: string; conclusion: string };
  let researchFacts: FactRow[] = [];
  let researchInferences: InfRow[] = [];

  if (mission?.id) {
    const { data: facts } = await sb
      .from("buddy_research_facts")
      .select("fact_type, value, confidence")
      .eq("mission_id", mission.id);
    researchFacts = (facts as FactRow[] | null) ?? [];

    const { data: inferences } = await sb
      .from("buddy_research_inferences")
      .select("inference_type, conclusion")
      .eq("mission_id", mission.id);
    researchInferences = (inferences as InfRow[] | null) ?? [];
  }

  const factNum = (type: string): number | null => {
    const f = researchFacts.find((x) => x.fact_type === type);
    return f ? jsonbToNumber(f.value) : null;
  };
  const inference = (type: string): string | null => {
    const i = researchInferences.find((x) => x.inference_type === type);
    return i?.conclusion ?? null;
  };

  // 5. NAICS benchmark (defaults if no match)
  const benchmark = findBenchmarkByNaics(naicsCode);

  const researchContext: ResearchContext = {
    marketSize: factNum("market_size"),
    marketGrowthRate: factNum("market_growth_rate"),
    establishmentCount: factNum("establishment_count"),
    employmentCount: factNum("employment_count"),
    averageWage: factNum("average_wage"),
    medianIncome: factNum("median_income"),
    population: factNum("population"),
    populationGrowthRate: factNum("population_growth_rate"),
    competitiveIntensity: inference("competitive_intensity"),
    marketAttractiveness: inference("market_attractiveness"),
    growthTrajectory: inference("growth_trajectory"),
    cyclicalityRisk: inference("cyclicality_risk"),
    demandStability: inference("demand_stability"),
    naicsCode,
    naicsLabel: benchmark?.label ?? industryDesc ?? null,
    revenueGrowthMedian: benchmark?.revenueGrowthMedian ?? 0.05,
    cogsMedian: benchmark?.cogsMedian ?? 0.4,
    dsoMedian: benchmark?.dsoMedian ?? 30,
    dpoMedian: benchmark?.dpoMedian ?? 25,
    fixedCostEscalationMedian: benchmark?.fixedCostEscalationMedian ?? 0.03,
  };

  // 6. Derive growth rates: NAICS median, modulated by BIE inferences
  let growthY1 = researchContext.revenueGrowthMedian;
  let growthY2 = researchContext.revenueGrowthMedian * 0.85;
  let growthY3 = researchContext.revenueGrowthMedian * 0.75;

  const trajectory = researchContext.growthTrajectory?.toLowerCase() ?? "";
  if (trajectory.includes("rapid")) {
    growthY1 = clamp(growthY1 * 1.5, -0.05, 0.25);
    growthY2 = clamp(growthY2 * 1.3, -0.05, 0.2);
    growthY3 = clamp(growthY3 * 1.2, -0.05, 0.15);
  } else if (trajectory.includes("declining")) {
    growthY1 = clamp(growthY1 * 0.5, -0.05, 0.25);
    growthY2 = clamp(growthY2 * 0.6, -0.03, 0.2);
    growthY3 = clamp(growthY3 * 0.7, 0, 0.15);
  }

  const attractiveness = researchContext.marketAttractiveness?.toLowerCase() ?? "";
  if (attractiveness.includes("high") || attractiveness.includes("strong")) {
    growthY1 = clamp(growthY1 * 1.15, -0.05, 0.25);
    growthY2 = clamp(growthY2 * 1.1, -0.05, 0.2);
  }

  const competition = researchContext.competitiveIntensity?.toLowerCase() ?? "";
  if (competition.includes("high") || competition.includes("intense")) {
    growthY1 = clamp(growthY1 * 0.85, -0.05, 0.25);
    growthY2 = clamp(growthY2 * 0.9, -0.05, 0.2);
  }

  // 7. Build assumptions
  const revenueStreams: RevenueStream[] =
    prefill.revenueStreams && prefill.revenueStreams.length > 0
      ? prefill.revenueStreams.map((s) => ({
          ...s,
          growthRateYear1: growthY1,
          growthRateYear2: growthY2,
          growthRateYear3: growthY3,
        }))
      : [
          {
            id: "stream_auto",
            name: industryDesc ? `${industryDesc} Revenue` : "Primary Revenue",
            baseAnnualRevenue: 0,
            growthRateYear1: growthY1,
            growthRateYear2: growthY2,
            growthRateYear3: growthY3,
            pricingModel: "flat",
            seasonalityProfile: null,
          },
        ];

  const cogsFromPrefill = prefill.costAssumptions?.cogsPercentYear1;
  const cogsBase =
    cogsFromPrefill != null && cogsFromPrefill > 0 && cogsFromPrefill < 0.95
      ? cogsFromPrefill
      : researchContext.cogsMedian;

  // Fixed costs: prefer prefill, else seed default categories with $0 amounts
  // (borrower fills these in; presence of categories nudges them).
  let fixedCosts: FixedCostCategory[] = [];
  if (
    prefill.costAssumptions?.fixedCostCategories &&
    prefill.costAssumptions.fixedCostCategories.length > 0
  ) {
    fixedCosts = prefill.costAssumptions.fixedCostCategories;
  } else {
    if (researchContext.averageWage) {
      fixedCosts.push({
        name: "Payroll & Benefits",
        annualAmount: researchContext.averageWage * 5,
        escalationPctPerYear: researchContext.fixedCostEscalationMedian,
      });
    }
    fixedCosts.push(
      { name: "Rent / Occupancy", annualAmount: 0, escalationPctPerYear: 0.03 },
      { name: "Insurance", annualAmount: 0, escalationPctPerYear: 0.04 },
      { name: "Utilities", annualAmount: 0, escalationPctPerYear: 0.03 },
    );
  }

  const managementTeam: ManagementMember[] = intakeOwners.map((o) => {
    const fullName = typeof o.full_name === "string" ? o.full_name : "";
    const title = typeof o.title === "string" ? o.title : "Owner";
    const ownershipPctRaw = o.ownership_pct;
    const ownershipPct =
      typeof ownershipPctRaw === "number"
        ? ownershipPctRaw
        : typeof ownershipPctRaw === "string"
          ? parseFloat(ownershipPctRaw)
          : undefined;
    const yearsRaw = o.years_in_industry;
    const yearsInIndustry =
      typeof yearsRaw === "number"
        ? yearsRaw
        : typeof yearsRaw === "string"
          ? parseInt(yearsRaw, 10) || 0
          : 0;
    return {
      name: fullName,
      title,
      ownershipPct: Number.isFinite(ownershipPct as number)
        ? (ownershipPct as number)
        : undefined,
      yearsInIndustry,
      bio: "",
    };
  });

  const assumptions: SBAAssumptions = {
    dealId,
    status: "draft",
    revenueStreams,
    costAssumptions: {
      cogsPercentYear1: cogsBase,
      cogsPercentYear2: Math.max(cogsBase - 0.01, 0.1),
      cogsPercentYear3: Math.max(cogsBase - 0.02, 0.1),
      fixedCostCategories: fixedCosts,
      plannedHires: prefill.costAssumptions?.plannedHires ?? [],
      plannedCapex: prefill.costAssumptions?.plannedCapex ?? [],
    },
    workingCapital: {
      targetDSO: researchContext.dsoMedian,
      targetDPO: researchContext.dpoMedian,
      inventoryTurns: null,
    },
    loanImpact: {
      loanAmount,
      termMonths: prefill.loanImpact?.termMonths ?? 120,
      interestRate: prefill.loanImpact?.interestRate ?? 0.0725,
      existingDebt: prefill.loanImpact?.existingDebt ?? [],
      // Phase BPG Sources of Funds — passed through from prefill when known,
      // else zeroed (borrower / banker can edit downstream).
      equityInjectionAmount: prefill.loanImpact?.equityInjectionAmount ?? 0,
      equityInjectionSource:
        prefill.loanImpact?.equityInjectionSource ?? "cash_savings",
      sellerFinancingAmount: prefill.loanImpact?.sellerFinancingAmount ?? 0,
      sellerFinancingTermMonths:
        prefill.loanImpact?.sellerFinancingTermMonths ?? 0,
      sellerFinancingRate: prefill.loanImpact?.sellerFinancingRate ?? 0,
      otherSources: prefill.loanImpact?.otherSources ?? [],
    },
    managementTeam,
  };

  // 8. Data sources + confidence
  const dataSources: string[] = [];
  if (mission) dataSources.push("BIE Industry Research");
  if (benchmark) dataSources.push(`NAICS ${naicsCode} Benchmarks`);
  if ((prefill.revenueStreams?.length ?? 0) > 0)
    dataSources.push("Extracted Financial Statements");
  if (intakeOwners.length > 0) dataSources.push("Borrower Intake (Ownership)");

  const confidenceLevel: "high" | "medium" | "low" =
    mission && benchmark && (prefill.revenueStreams?.length ?? 0) > 0
      ? "high"
      : benchmark || (prefill.revenueStreams?.length ?? 0) > 0
        ? "medium"
        : "low";

  // 9. Narrative — Gemini briefing if available, else factual fallback
  let researchNarrative = "";
  if (GEMINI_API_KEY) {
    try {
      researchNarrative = await generateResearchBriefing({
        businessName,
        naicsLabel: researchContext.naicsLabel ?? industryDesc ?? "your industry",
        geography: geography ?? "your market",
        researchContext,
        hasFinancialDocs: (prefill.revenueStreams?.length ?? 0) > 0,
        loanAmount,
        loanPurpose,
      });
    } catch {
      // Non-fatal — fall through to factual narrative.
    }
  }
  if (!researchNarrative) {
    researchNarrative = buildFactualNarrative(researchContext, naicsCode);
  }

  return {
    assumptions,
    researchContext,
    researchNarrative,
    confidenceLevel,
    dataSources,
  };
}

// ─── Narrative builders ──────────────────────────────────────────────────

function buildFactualNarrative(
  ctx: ResearchContext,
  naicsCode: string | null,
): string {
  const parts: string[] = [];
  parts.push(
    `Industry: ${ctx.naicsLabel ?? "Not specified"} (NAICS ${naicsCode ?? "N/A"})`,
  );
  if (ctx.marketGrowthRate != null)
    parts.push(`Industry growth rate: ${(ctx.marketGrowthRate * 100).toFixed(1)}%`);
  if (ctx.establishmentCount != null)
    parts.push(`Local establishments: ${ctx.establishmentCount.toLocaleString()}`);
  if (ctx.medianIncome != null)
    parts.push(`Median household income: $${ctx.medianIncome.toLocaleString()}`);
  if (ctx.population != null)
    parts.push(`Market population: ${ctx.population.toLocaleString()}`);
  parts.push(`Typical cost of goods: ${(ctx.cogsMedian * 100).toFixed(0)}% of revenue`);
  parts.push(
    `Industry median growth: ${(ctx.revenueGrowthMedian * 100).toFixed(0)}% per year`,
  );
  return parts.join("\n");
}

async function generateResearchBriefing(params: {
  businessName: string;
  naicsLabel: string;
  geography: string;
  researchContext: ResearchContext;
  hasFinancialDocs: boolean;
  loanAmount: number;
  loanPurpose: string;
}): Promise<string> {
  const ctx = params.researchContext;
  const dataLines: string[] = [];
  if (ctx.marketGrowthRate != null)
    dataLines.push(
      `- Industry growth rate: ${(ctx.marketGrowthRate * 100).toFixed(1)}%`,
    );
  if (ctx.establishmentCount != null)
    dataLines.push(
      `- Local establishments in market: ${ctx.establishmentCount.toLocaleString()}`,
    );
  if (ctx.medianIncome != null)
    dataLines.push(
      `- Median household income: $${ctx.medianIncome.toLocaleString()}`,
    );
  if (ctx.population != null)
    dataLines.push(`- Market population: ${ctx.population.toLocaleString()}`);
  if (ctx.populationGrowthRate != null)
    dataLines.push(
      `- Population growth: ${(ctx.populationGrowthRate * 100).toFixed(1)}%`,
    );
  if (ctx.competitiveIntensity)
    dataLines.push(`- Competitive intensity: ${ctx.competitiveIntensity}`);
  if (ctx.growthTrajectory)
    dataLines.push(`- Growth trajectory: ${ctx.growthTrajectory}`);
  if (ctx.demandStability)
    dataLines.push(`- Demand stability: ${ctx.demandStability}`);
  dataLines.push(
    `- Typical cost of goods: ${(ctx.cogsMedian * 100).toFixed(0)}% of revenue`,
  );
  dataLines.push(
    `- Industry median growth: ${(ctx.revenueGrowthMedian * 100).toFixed(0)}%/year`,
  );
  dataLines.push(`- Typical receivables cycle: ${ctx.dsoMedian} days`);
  dataLines.push(
    params.hasFinancialDocs
      ? "- I have analyzed your uploaded financial documents"
      : "- No financial documents uploaded yet",
  );

  const prompt = `You are the world's leading business projections expert. A borrower named "${params.businessName}" in the ${params.naicsLabel} industry (${params.geography}) has come to you for an SBA loan of $${params.loanAmount.toLocaleString()} for: ${params.loanPurpose}.

You have already completed exhaustive research on their industry and market. Present your findings in 2-3 paragraphs as a confident expert who has done their homework. Speak directly to the borrower in second person.

RESEARCH DATA YOU HAVE:
${dataLines.join("\n")}

RULES:
- Sound like an expert who has done exhaustive research, not a chatbot
- Be specific with numbers and data points
- Don't use superlatives or marketing language
- Don't mention SBA compliance, DSCR thresholds, or banking jargon
- End with "Based on this research, I've built your 3-year financial projection."

Return ONLY the narrative text. No JSON. No markdown headers.`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_SBA_NARRATIVE}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );

  if (!resp.ok) return "";
  const json = (await resp.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
}
