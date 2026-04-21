import "server-only";

// src/lib/sba/sbaAssumptionDrafter.ts
// Phase 3 — The "magic moment". One Gemini Pro call that takes ALL available
// deal context (financials, ownership, research, NAICS benchmarks) and
// produces a complete, defensible SBAAssumptions draft plus rationale that
// the borrower can review section-by-section. Falls back to NAICS-prefill on
// any failure so the interview always has something to render.

import { supabaseAdmin } from "@/lib/supabase/admin";
import { callGeminiJSON } from "./sbaPackageNarrative";
import { extractResearchForBusinessPlan } from "./sbaResearchExtractor";
import {
  findBenchmarkByNaics,
  type NAICSBenchmark,
} from "./sbaAssumptionBenchmarks";
import { loadSBAAssumptionsPrefill } from "./sbaAssumptionsPrefill";
import type {
  SBAAssumptions,
  RevenueStream,
  FixedCostCategory,
  PlannedHire,
  PlannedCapex,
  ExistingDebtItem,
  ManagementMember,
} from "./sbaReadinessTypes";

export interface DraftedAssumptions {
  assumptions: SBAAssumptions;
  reasoning: {
    revenueRationale: string;
    costRationale: string;
    growthRationale: string;
    managementRationale: string;
    workingCapitalRationale: string;
    equityRationale: string;
  };
}

const FACT_KEYS = [
  "TOTAL_REVENUE",
  "TOTAL_REVENUE_IS",
  "COST_OF_GOODS_SOLD",
  "COGS",
  "TOTAL_COGS_IS",
  "TOTAL_OPERATING_EXPENSES",
  "TOTAL_OPERATING_EXPENSES_IS",
  "NET_INCOME",
  "EBITDA",
  "DEPRECIATION",
  "DEPRECIATION_IS",
  "INTEREST_EXPENSE",
  "TOTAL_TAX",
  "ADS",
  "YEARS_IN_BUSINESS",
  "CASH",
  "ACCOUNTS_RECEIVABLE",
  "INVENTORY",
  "TOTAL_FIXED_ASSETS",
  "ACCOUNTS_PAYABLE",
  "TOTAL_LONG_TERM_DEBT",
  "TOTAL_EQUITY",
];

const STANDARD_GUARDRAILS =
  "Do NOT invent market statistics. Do NOT use superlatives. Every assumption must be grounded in the data provided.";

const EMPTY_REASONING: DraftedAssumptions["reasoning"] = {
  revenueRationale: "",
  costRationale: "",
  growthRationale: "",
  managementRationale: "",
  workingCapitalRationale: "",
  equityRationale: "",
};

// ─── Public entry ────────────────────────────────────────────────────────

export async function draftAssumptionsFromContext(
  dealId: string,
): Promise<DraftedAssumptions> {
  const sb = supabaseAdmin();

  // Parallel-load every context source. None individually fatal.
  const [
    factsRes,
    appRes,
    dealRes,
    ownerEntitiesRes,
    ownerInterestsRes,
    structureSectionRes,
    proceedsRes,
    research,
    prefill,
  ] = await Promise.all([
    sb
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId)
      .in("fact_key", FACT_KEYS),
    sb
      .from("borrower_applications")
      .select("naics, industry, business_legal_name")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("deals")
      .select("id, name, deal_type, loan_amount, city, state")
      .eq("id", dealId)
      .maybeSingle(),
    sb
      .from("deal_ownership_entities")
      .select("id, display_name, entity_type")
      .eq("deal_id", dealId),
    sb
      .from("deal_ownership_interests")
      .select("owner_entity_id, ownership_pct")
      .eq("deal_id", dealId),
    sb
      .from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "structure")
      .maybeSingle(),
    sb
      .from("deal_proceeds_items")
      .select("category, description, amount")
      .eq("deal_id", dealId),
    extractResearchForBusinessPlan(dealId).catch(() => null),
    loadSBAAssumptionsPrefill(dealId).catch(() => ({}) as Awaited<
      ReturnType<typeof loadSBAAssumptionsPrefill>
    >),
  ]);

  // Fact resolver with the standard fallback chain.
  type Fact = { fact_key: string; fact_value_num: number | string | null };
  const facts = (factsRes.data as Fact[] | null) ?? [];
  const factNum = (...keys: string[]): number => {
    for (const k of keys) {
      const f = facts.find((x) => x.fact_key === k);
      if (f?.fact_value_num != null) {
        const n = Number(f.fact_value_num);
        if (Number.isFinite(n)) return n;
      }
    }
    return 0;
  };

  const revenue = factNum("TOTAL_REVENUE_IS", "TOTAL_REVENUE");
  const cogs = factNum("TOTAL_COGS_IS", "COST_OF_GOODS_SOLD", "COGS");
  const opex = factNum("TOTAL_OPERATING_EXPENSES_IS", "TOTAL_OPERATING_EXPENSES");
  const netIncome = factNum("NET_INCOME");
  let ebitda = factNum("EBITDA");
  const depreciation = factNum("DEPRECIATION_IS", "DEPRECIATION");
  const interestExp = factNum("INTEREST_EXPENSE");
  const totalTax = factNum("TOTAL_TAX");
  if (ebitda === 0 && netIncome !== 0) {
    ebitda = netIncome + interestExp + depreciation + totalTax;
  }
  const ads = factNum("ADS");
  const yearsInBusiness = factNum("YEARS_IN_BUSINESS");
  const cogsPct = revenue > 0 ? cogs / revenue : 0;

  const naicsCode: string | null = appRes.data?.naics ?? null;
  const industry: string | null = appRes.data?.industry ?? null;
  const businessName: string =
    appRes.data?.business_legal_name ?? dealRes.data?.name ?? "Business";
  const loanAmount: number = Number(dealRes.data?.loan_amount ?? 0) || 0;
  const dealType: string = dealRes.data?.deal_type ?? "sba_7a";
  const city: string | null = dealRes.data?.city ?? null;
  const state: string | null = dealRes.data?.state ?? null;
  const benchmark = findBenchmarkByNaics(naicsCode);

  // Build ownership view (entity + ownership %).
  type OwnerEntity = {
    id: string;
    display_name: string | null;
    entity_type: string | null;
  };
  type OwnerInterest = {
    owner_entity_id: string;
    ownership_pct: number | null;
  };
  const entities = (ownerEntitiesRes.data as OwnerEntity[] | null) ?? [];
  const interests = (ownerInterestsRes.data as OwnerInterest[] | null) ?? [];
  const ownership = entities
    .filter((e) => (e.entity_type ?? "").toLowerCase() === "individual")
    .map((e) => {
      const interest = interests.find((i) => i.owner_entity_id === e.id);
      return {
        name: (e.display_name ?? "").trim(),
        ownershipPct: Number(interest?.ownership_pct ?? 0) || 0,
      };
    })
    .filter((o) => o.name.length > 0);

  // Structure section overlays the borrower's preferred term/rate when set.
  const structure = (structureSectionRes.data?.data ?? {}) as Record<
    string,
    unknown
  >;
  const desiredTermMonths =
    typeof structure.desired_term_months === "number"
      ? structure.desired_term_months
      : 120;
  const desiredRate =
    typeof structure.desired_interest_rate === "number"
      ? structure.desired_interest_rate
      : 0.0725;

  type Proceeds = {
    category: string;
    description: string | null;
    amount: number | string | null;
  };
  const proceeds = (proceedsRes.data as Proceeds[] | null) ?? [];

  // Build the prompt and call Gemini. On any failure, fall back to a deterministic draft.
  const prompt = buildDrafterPrompt({
    businessName,
    industry,
    naicsCode,
    naicsLabel: benchmark?.label ?? null,
    city,
    state,
    dealType,
    loanAmount,
    yearsInBusiness,
    revenue,
    cogs,
    cogsPct,
    opex,
    ebitda,
    netIncome,
    depreciation,
    ads,
    ownership,
    desiredTermMonths,
    desiredRate,
    proceeds,
    benchmark,
    research,
  });

  let drafted: DraftedAssumptions | null = null;
  try {
    const text = await callGeminiJSON(prompt);
    drafted = parseDrafterResponse(text, {
      dealId,
      loanAmount,
      desiredTermMonths,
      desiredRate,
      ownership,
    });
  } catch (err) {
    console.warn(
      "[sbaAssumptionDrafter] Gemini call failed, falling back to deterministic draft:",
      err instanceof Error ? err.message : err,
    );
  }

  if (drafted) return drafted;

  // ─── Deterministic fallback ──────────────────────────────────────────
  // Use NAICS prefill + benchmark medians so the borrower still sees a
  // populated set of cards instead of an empty form.
  return buildDeterministicFallback({
    dealId,
    loanAmount,
    desiredTermMonths,
    desiredRate,
    revenue,
    cogsPct,
    benchmark,
    ownership,
    industry,
    prefill,
  });
}

// ─── Prompt builder ──────────────────────────────────────────────────────

function buildDrafterPrompt(p: {
  businessName: string;
  industry: string | null;
  naicsCode: string | null;
  naicsLabel: string | null;
  city: string | null;
  state: string | null;
  dealType: string;
  loanAmount: number;
  yearsInBusiness: number;
  revenue: number;
  cogs: number;
  cogsPct: number;
  opex: number;
  ebitda: number;
  netIncome: number;
  depreciation: number;
  ads: number;
  ownership: Array<{ name: string; ownershipPct: number }>;
  desiredTermMonths: number;
  desiredRate: number;
  proceeds: Array<{
    category: string;
    description: string | null;
    amount: number | string | null;
  }>;
  benchmark: NAICSBenchmark | null;
  research: Awaited<ReturnType<typeof extractResearchForBusinessPlan>> | null;
}): string {
  const ownershipBlock = p.ownership.length
    ? p.ownership
        .map(
          (o) => `  - ${o.name} (${(o.ownershipPct * 100).toFixed(0)}% ownership)`,
        )
        .join("\n")
    : "  - No ownership entities on file";
  const proceedsBlock = p.proceeds.length
    ? p.proceeds
        .map(
          (q) =>
            `  - ${q.category}${q.description ? ` (${q.description})` : ""}: $${Number(q.amount ?? 0).toLocaleString()}`,
        )
        .join("\n")
    : "  - No proceeds items recorded yet";
  const benchmarkBlock = p.benchmark
    ? `Median revenue growth: ${(p.benchmark.revenueGrowthMedian * 100).toFixed(1)}%
Median COGS: ${(p.benchmark.cogsMedian * 100).toFixed(1)}%
Median DSO: ${p.benchmark.dsoMedian} days
Median DPO: ${p.benchmark.dpoMedian} days`
    : "No NAICS benchmark available — reason transparently from research and financials.";
  const r = p.research ?? null;
  const researchBlock = r
    ? `Industry Overview: ${r.industryOverview ?? "—"}
Industry Outlook: ${r.industryOutlook ?? "—"}
Competitive Landscape: ${r.competitiveLandscape ?? "—"}
Market Intelligence: ${r.marketIntelligence ?? "—"}
Borrower Profile: ${r.borrowerProfile ?? "—"}
Management Intelligence: ${r.managementIntelligence ?? "—"}
3-5 Year Outlook: ${r.threeToFiveYearOutlook ?? "—"}`
    : "No research mission completed yet — reason from financials and benchmarks only.";

  return `You are the world's #1 SBA business plan consultant. You have been given comprehensive intelligence about a business seeking an SBA loan. Your task is to draft the complete set of financial assumptions for their 3-year business plan.

You must generate SPECIFIC, DEFENSIBLE assumptions — not generic defaults. ${STANDARD_GUARDRAILS}

=== BUSINESS CONTEXT ===
Business: ${p.businessName}
Location: ${p.city ?? "—"}${p.state ? `, ${p.state}` : ""}
Industry: ${p.industry ?? "—"}
NAICS: ${p.naicsCode ?? "—"}${p.naicsLabel ? ` (${p.naicsLabel})` : ""}
Loan type: ${p.dealType}
Loan amount: $${p.loanAmount.toLocaleString()}
Years in business: ${p.yearsInBusiness > 0 ? p.yearsInBusiness : "unknown"}

=== CURRENT FINANCIALS ===
Revenue: $${p.revenue.toLocaleString()}
COGS: $${p.cogs.toLocaleString()} (${(p.cogsPct * 100).toFixed(1)}% of revenue)
Operating Expenses: $${p.opex.toLocaleString()}
EBITDA: $${p.ebitda.toLocaleString()}
Net Income: $${p.netIncome.toLocaleString()}
Depreciation: $${p.depreciation.toLocaleString()}
Annual Debt Service: $${p.ads.toLocaleString()}

=== OWNERSHIP ===
${ownershipBlock}

=== LOAN STRUCTURE ===
Requested amount: $${p.loanAmount.toLocaleString()}
Proposed term: ${p.desiredTermMonths} months
Proposed rate: ${(p.desiredRate * 100).toFixed(2)}%
Use of proceeds:
${proceedsBlock}

=== INDUSTRY BENCHMARKS ===
${benchmarkBlock}

=== RESEARCH INTELLIGENCE ===
${researchBlock}

=== YOUR TASK ===
Return ONLY valid JSON with this exact shape:

{
  "assumptions": {
    "revenueStreams": [{
      "id": "stream_1",
      "name": "<descriptive stream name>",
      "baseAnnualRevenue": <number — match TOTAL_REVENUE if available>,
      "growthRateYear1": <decimal e.g. 0.04>,
      "growthRateYear2": <decimal>,
      "growthRateYear3": <decimal>,
      "pricingModel": "flat",
      "seasonalityProfile": null
    }],
    "costAssumptions": {
      "cogsPercentYear1": <decimal>,
      "cogsPercentYear2": <decimal>,
      "cogsPercentYear3": <decimal>,
      "fixedCostCategories": [{"name": "<category>", "annualAmount": <number>, "escalationPctPerYear": <decimal>}],
      "plannedHires": [],
      "plannedCapex": []
    },
    "workingCapital": {
      "targetDSO": <integer>,
      "targetDPO": <integer>,
      "inventoryTurns": <integer or null>
    },
    "loanImpact": {
      "loanAmount": ${p.loanAmount},
      "termMonths": ${p.desiredTermMonths},
      "interestRate": ${p.desiredRate},
      "existingDebt": [],
      "equityInjectionAmount": <number — minimum 10% existing biz, 20% startup>,
      "equityInjectionSource": "cash_savings",
      "sellerFinancingAmount": 0,
      "sellerFinancingTermMonths": 0,
      "sellerFinancingRate": 0,
      "otherSources": []
    },
    "managementTeam": [{
      "name": "<owner name>",
      "title": "<Owner/CEO if >=50%, Partner/VP if >=20%, else Manager>",
      "ownershipPct": <number — match interest from above>,
      "yearsInIndustry": 0,
      "bio": "<2-3 sentences drafted from Management Intelligence research; if no research, leave as 'Borrower to confirm experience and credentials.'>"
    }]
  },
  "reasoning": {
    "revenueRationale": "<2-3 sentences explaining WHY these specific growth rates for this specific business — cite research and current revenue>",
    "costRationale": "<Why these COGS and operating expense assumptions — anchor on actual ratio when available>",
    "growthRationale": "<What the 3-5 Year Outlook says about this business's trajectory>",
    "managementRationale": "<What we know about the team and what the borrower needs to confirm>",
    "workingCapitalRationale": "<Why these DSO/DPO values for this industry>",
    "equityRationale": "<Suggested equity injection based on loan size and SBA SOP>"
  }
}`;
}

// ─── Response parsing ────────────────────────────────────────────────────

function parseDrafterResponse(
  text: string,
  ctx: {
    dealId: string;
    loanAmount: number;
    desiredTermMonths: number;
    desiredRate: number;
    ownership: Array<{ name: string; ownershipPct: number }>;
  },
): DraftedAssumptions | null {
  if (!text) return null;

  // Strip code fences if the model wrapped the JSON.
  let raw = text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }

  let parsed: {
    assumptions?: Partial<SBAAssumptions> & {
      revenueStreams?: Partial<RevenueStream>[];
      costAssumptions?: Record<string, unknown>;
      workingCapital?: Record<string, unknown>;
      loanImpact?: Record<string, unknown>;
      managementTeam?: Partial<ManagementMember>[];
    };
    reasoning?: Partial<DraftedAssumptions["reasoning"]>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed.assumptions) return null;

  const a = parsed.assumptions;
  const reasoning = { ...EMPTY_REASONING, ...(parsed.reasoning ?? {}) };

  // Coerce each section into the strict SBAAssumptions shape.
  const revenueStreams: RevenueStream[] = (a.revenueStreams ?? []).map(
    (s, i) => ({
      id: s.id ?? `stream_${i + 1}`,
      name: s.name ?? `Revenue Stream ${i + 1}`,
      baseAnnualRevenue: Number(s.baseAnnualRevenue ?? 0),
      growthRateYear1: Number(s.growthRateYear1 ?? 0.05),
      growthRateYear2: Number(s.growthRateYear2 ?? 0.04),
      growthRateYear3: Number(s.growthRateYear3 ?? 0.03),
      pricingModel:
        (s.pricingModel as RevenueStream["pricingModel"]) ?? "flat",
      seasonalityProfile: s.seasonalityProfile ?? null,
    }),
  );

  const ca = (a.costAssumptions ?? {}) as Record<string, unknown>;
  const fixedCosts: FixedCostCategory[] = Array.isArray(ca.fixedCostCategories)
    ? (ca.fixedCostCategories as Array<Record<string, unknown>>).map((f) => ({
        name: String(f.name ?? "Fixed Cost"),
        annualAmount: Number(f.annualAmount ?? 0),
        escalationPctPerYear: Number(f.escalationPctPerYear ?? 0.03),
      }))
    : [];
  const hires: PlannedHire[] = Array.isArray(ca.plannedHires)
    ? (ca.plannedHires as Array<Record<string, unknown>>).map((h) => ({
        role: String(h.role ?? ""),
        startMonth: Number(h.startMonth ?? 1),
        annualSalary: Number(h.annualSalary ?? 0),
      }))
    : [];
  const capex: PlannedCapex[] = Array.isArray(ca.plannedCapex)
    ? (ca.plannedCapex as Array<Record<string, unknown>>).map((c) => {
        const yr = Number(c.year ?? 1);
        return {
          description: String(c.description ?? ""),
          amount: Number(c.amount ?? 0),
          year: ((yr === 1 || yr === 2 || yr === 3) ? yr : 1) as 1 | 2 | 3,
        };
      })
    : [];

  const wc = (a.workingCapital ?? {}) as Record<string, unknown>;
  const li = (a.loanImpact ?? {}) as Record<string, unknown>;
  const existingDebt: ExistingDebtItem[] = Array.isArray(li.existingDebt)
    ? (li.existingDebt as Array<Record<string, unknown>>).map((d) => ({
        description: String(d.description ?? ""),
        currentBalance: Number(d.currentBalance ?? 0),
        monthlyPayment: Number(d.monthlyPayment ?? 0),
        remainingTermMonths: Number(d.remainingTermMonths ?? 0),
      }))
    : [];
  const otherSources = Array.isArray(li.otherSources)
    ? (li.otherSources as Array<Record<string, unknown>>).map((o) => ({
        description: String(o.description ?? ""),
        amount: Number(o.amount ?? 0),
      }))
    : [];

  const managementTeam: ManagementMember[] = (a.managementTeam ?? []).map(
    (m) => ({
      name: m.name ?? "",
      title: m.title ?? "Owner",
      ownershipPct:
        m.ownershipPct != null && Number.isFinite(Number(m.ownershipPct))
          ? Number(m.ownershipPct)
          : undefined,
      yearsInIndustry: Number(m.yearsInIndustry ?? 0),
      bio: m.bio ?? "",
    }),
  );

  const assumptions: SBAAssumptions = {
    dealId: ctx.dealId,
    status: "draft",
    revenueStreams,
    costAssumptions: {
      cogsPercentYear1: Number(ca.cogsPercentYear1 ?? 0.4),
      cogsPercentYear2: Number(ca.cogsPercentYear2 ?? 0.4),
      cogsPercentYear3: Number(ca.cogsPercentYear3 ?? 0.4),
      fixedCostCategories: fixedCosts,
      plannedHires: hires,
      plannedCapex: capex,
    },
    workingCapital: {
      targetDSO: Number(wc.targetDSO ?? 30),
      targetDPO: Number(wc.targetDPO ?? 25),
      inventoryTurns:
        wc.inventoryTurns == null ? null : Number(wc.inventoryTurns),
    },
    loanImpact: {
      loanAmount: Number(li.loanAmount ?? ctx.loanAmount),
      termMonths: Number(li.termMonths ?? ctx.desiredTermMonths),
      interestRate: Number(li.interestRate ?? ctx.desiredRate),
      existingDebt,
      equityInjectionAmount: Number(li.equityInjectionAmount ?? 0),
      equityInjectionSource:
        (li.equityInjectionSource as
          | "cash_savings"
          | "401k_rollover"
          | "gift"
          | "other") ?? "cash_savings",
      sellerFinancingAmount: Number(li.sellerFinancingAmount ?? 0),
      sellerFinancingTermMonths: Number(li.sellerFinancingTermMonths ?? 0),
      sellerFinancingRate: Number(li.sellerFinancingRate ?? 0),
      otherSources,
    },
    managementTeam:
      managementTeam.length > 0
        ? managementTeam
        : ctx.ownership.map((o) => ({
            name: o.name,
            title:
              o.ownershipPct >= 0.5
                ? "Owner / CEO"
                : o.ownershipPct >= 0.2
                  ? "Partner / VP"
                  : "Manager",
            ownershipPct: o.ownershipPct,
            yearsInIndustry: 0,
            bio: "Borrower to confirm experience and credentials.",
          })),
  };

  return { assumptions, reasoning };
}

// ─── Deterministic fallback ──────────────────────────────────────────────

function buildDeterministicFallback(p: {
  dealId: string;
  loanAmount: number;
  desiredTermMonths: number;
  desiredRate: number;
  revenue: number;
  cogsPct: number;
  benchmark: NAICSBenchmark | null;
  ownership: Array<{ name: string; ownershipPct: number }>;
  industry: string | null;
  prefill: Awaited<ReturnType<typeof loadSBAAssumptionsPrefill>>;
}): DraftedAssumptions {
  const benchGrowth = p.benchmark?.revenueGrowthMedian ?? 0.05;
  const benchCogs = p.benchmark?.cogsMedian ?? 0.4;
  const benchDso = p.benchmark?.dsoMedian ?? 30;
  const benchDpo = p.benchmark?.dpoMedian ?? 25;
  const cogsBase =
    p.cogsPct > 0 && p.cogsPct < 0.95 ? p.cogsPct : benchCogs;

  const equityMin = Math.round(p.loanAmount * 0.1);

  const revenueStreams: RevenueStream[] =
    p.prefill.revenueStreams && p.prefill.revenueStreams.length > 0
      ? p.prefill.revenueStreams
      : [
          {
            id: "stream_1",
            name: p.industry ? `${p.industry} Revenue` : "Primary Revenue",
            baseAnnualRevenue: p.revenue,
            growthRateYear1: benchGrowth,
            growthRateYear2: benchGrowth * 0.85,
            growthRateYear3: benchGrowth * 0.75,
            pricingModel: "flat",
            seasonalityProfile: null,
          },
        ];

  const fixedCosts: FixedCostCategory[] =
    p.prefill.costAssumptions?.fixedCostCategories ?? [];

  const managementTeam: ManagementMember[] = p.ownership.map((o) => ({
    name: o.name,
    title:
      o.ownershipPct >= 0.5
        ? "Owner / CEO"
        : o.ownershipPct >= 0.2
          ? "Partner / VP"
          : "Manager",
    ownershipPct: o.ownershipPct,
    yearsInIndustry: 0,
    bio: "Borrower to confirm experience and credentials.",
  }));

  const assumptions: SBAAssumptions = {
    dealId: p.dealId,
    status: "draft",
    revenueStreams,
    costAssumptions: {
      cogsPercentYear1: cogsBase,
      cogsPercentYear2: Math.max(cogsBase - 0.01, 0.1),
      cogsPercentYear3: Math.max(cogsBase - 0.02, 0.1),
      fixedCostCategories: fixedCosts,
      plannedHires: p.prefill.costAssumptions?.plannedHires ?? [],
      plannedCapex: p.prefill.costAssumptions?.plannedCapex ?? [],
    },
    workingCapital: {
      targetDSO: benchDso,
      targetDPO: benchDpo,
      inventoryTurns: null,
    },
    loanImpact: {
      loanAmount: p.loanAmount,
      termMonths: p.desiredTermMonths,
      interestRate: p.desiredRate,
      existingDebt: p.prefill.loanImpact?.existingDebt ?? [],
      equityInjectionAmount: equityMin,
      equityInjectionSource: "cash_savings",
      sellerFinancingAmount: 0,
      sellerFinancingTermMonths: 0,
      sellerFinancingRate: 0,
      otherSources: [],
    },
    managementTeam,
  };

  return {
    assumptions,
    reasoning: {
      revenueRationale: p.benchmark
        ? `Used the NAICS ${p.benchmark.code} (${p.benchmark.label}) median growth rate of ${(benchGrowth * 100).toFixed(0)}%/yr as the anchor and faded the rate over years 2-3 in the absence of additional research signals.`
        : "Used a conservative 5%/yr growth rate; no NAICS benchmark or research mission was available to refine the projection.",
      costRationale:
        p.cogsPct > 0
          ? `Anchored COGS on the actual ${(p.cogsPct * 100).toFixed(1)}% ratio from the most recent financials and tightened it slightly over years 2-3 to reflect typical scale economies.`
          : `Used the NAICS median COGS of ${(benchCogs * 100).toFixed(0)}% — financial documents did not yield an actual ratio.`,
      growthRationale:
        "No completed research mission was available; growth was set from NAICS benchmark medians rather than borrower-specific outlook.",
      managementRationale:
        p.ownership.length > 0
          ? "Pre-filled the team from deal ownership records. Borrower must confirm titles and write bios."
          : "No ownership entities on file. Borrower must add management team members manually.",
      workingCapitalRationale:
        `Set DSO to ${benchDso} days and DPO to ${benchDpo} days based on NAICS medians. Borrower should adjust if their cycle differs materially.`,
      equityRationale: `Suggested minimum 10% equity injection of $${equityMin.toLocaleString()} per SBA SOP for existing-business deals. Borrower may inject more to strengthen the application.`,
    },
  };
}
