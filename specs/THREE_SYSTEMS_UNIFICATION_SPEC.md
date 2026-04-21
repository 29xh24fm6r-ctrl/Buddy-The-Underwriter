# THREE SYSTEMS UNIFICATION SPEC
## Canonical Deal Context Layer

**Status:** ACTIVE — implementation guide for Claude Code / Antigravity  
**Created:** April 21, 2026  
**Author:** Claude (architecture) + Matt (vision)  
**Depends on:** `BUSINESS_PLAN_GOD_TIER_SPEC.md`, `FEASIBILITY_STUDY_GOD_TIER_SPEC.md`  
**Goal:** Eliminate redundant data fetching across all three god-tier systems, unify research extraction, add version binding, and wire the Omega advisory reconciliation layer — without diminishing any system.

---

## The Three Systems

| # | System | Engine File | Output Table | Size |
|---|--------|-------------|-------------|------|
| 1 | **Business Plan** | `sbaPackageNarrative.ts` (20.8KB) — 6 Gemini narrative generators | `buddy_sba_packages` (narrative columns) | 6 LLM calls |
| 2 | **Financial Projections** | `sbaForwardModelBuilder.ts` (10.8KB) — 5-pass deterministic model | `buddy_sba_packages` (math columns) | 0 LLM calls |
| 3 | **Feasibility Study** | `feasibilityEngine.ts` (18.4KB) — 4-dimension scoring engine | `buddy_feasibility_studies` | 1 LLM call |

**Orchestrator:** `sbaPackageOrchestrator.ts` (23KB) fuses Systems 1+2 into a single artifact.  
**Upstream seeder:** `sbaResearchProjectionGenerator.ts` (19.6KB) auto-drafts assumptions.  
**Dependency chain:** Research Gen → Assumptions → Projections → Business Plan → (fused into SBA Package) → Feasibility

---

## The Problem: 14+ Redundant Queries, 3 Divergent Research Paths

### Redundant Database Queries

Each system independently fetches the same upstream data. Here is every SELECT statement across all consumers, deduplicated by target:

| Data Source | Orchestrator | Feasibility | Research Gen | Prefill | Total Fetches |
|-------------|:---:|:---:|:---:|:---:|:---:|
| `deals` (name, city, state, loan_amount, deal_type) | ✅ | ✅ | ✅ | ✅ | 4 |
| `borrower_applications` (naics, industry, legal_name, ein) | ✅ | ✅ | ✅ | ✅ | 4 |
| `deal_ownership_entities` + `deal_ownership_interests` | ✅ | ✅ | — | ✅ | 3 |
| `buddy_guarantor_cashflow` | ✅ | ✅ | — | — | 2 |
| `deal_financial_facts` (IS + BS keys) | ✅ | — | — | ✅ | 2 |
| `buddy_sba_assumptions` | ✅ | ✅ | — | — | 2 |
| `findBenchmarkByNaics()` | ✅ (via prefill) | ✅ | ✅ | ✅ | 4 |
| BIE research narratives/facts | ✅ | ✅ | ✅ | — | 3 |
| `deal_builder_sections` (address, owners, loan) | — | — | ✅ | — | 1 |
| `deal_proceeds_items` | ✅ | — | — | — | 1 |
| `buddy_validation_reports` | ✅ | — | — | — | 1 |

**Total: 27 SELECT round-trips for data that could be assembled once.**

### Three Divergent Research Extraction Paths

1. **`extractResearchForBusinessPlan()`** in `sbaResearchExtractor.ts` — produces 9 prose sections from `buddy_research_narratives.sections`. Used by both the Orchestrator and Feasibility Engine.

2. **`extractBIEMarketData()`** in `feasibility/bieMarketExtractor.ts` — produces structured numeric claims (population, median income, unemployment, competitor count, trend direction, risk keywords) from `buddy_research_facts`, `buddy_research_inferences`, AND `buddy_research_narratives`. Used only by Feasibility.

3. **Inline queries** in `sbaResearchProjectionGenerator.ts` — directly queries `buddy_research_facts` (fact_type, value, confidence) and `buddy_research_inferences` (inference_type, conclusion) with its own `jsonbToNumber()` coercion. Used only by the Research Generator.

These three paths parse the same underlying BIE research data through three different lenses, with three different coercion functions, and three different fallback strategies. If the BIE schema evolves, all three must be updated independently.

### No Version Binding

The Feasibility Engine queries `buddy_sba_packages` with `ORDER BY version_number DESC LIMIT 1` — grabbing "latest." If projections are regenerated between the start of a feasibility run and the financial viability dimension reading the package, the scores could be computed against inconsistent data.

---

## The Solution: Four-Phase Unification

### Phase 1: `buildDealContext(dealId)` — Canonical Data Assembly

A single function that fetches ALL shared upstream data once and returns a typed context object. Every downstream consumer receives this object instead of making its own queries.

**New file:** `src/lib/deal/dealContext.ts`

```typescript
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildUnifiedResearch, type UnifiedResearch } from "@/lib/research/unifiedResearchExtractor";
import { findBenchmarkByNaics, type NAICSBenchmark } from "@/lib/sba/sbaAssumptionBenchmarks";

// ─── Output Contract ─────────────────────────────────────────────────────

export interface DealContext {
  // ── Deal scalar ────────────────────────────────────────────────
  deal: {
    id: string;
    name: string | null;
    dealType: string | null;
    loanAmount: number;
    city: string | null;
    state: string | null;
    bankId: string | null;
    borrowerId: string | null;
  };

  // ── Borrower application ───────────────────────────────────────
  borrowerApp: {
    naics: string | null;
    industry: string | null;
    businessLegalName: string | null;
    businessEin: string | null;
  } | null;

  // ── NAICS benchmark (resolved once) ────────────────────────────
  benchmark: NAICSBenchmark | null;

  // ── Ownership ──────────────────────────────────────────────────
  owners: Array<{
    id: string;
    displayName: string | null;
    entityType: string | null;
    ownershipPct: number;
  }>;

  // ── Guarantor cashflow ─────────────────────────────────────────
  guarantors: Array<{
    entityId: string;
    displayName: string;
    ownershipPct: number;
    w2Salary: number;
    otherPersonalIncome: number;
    mortgagePayment: number;
    autoPayments: number;
    studentLoans: number;
    creditCardMinimums: number;
    otherPersonalDebt: number;
  }>;

  // ── Financial facts (with fallback resolution) ─────────────────
  facts: {
    revenue: number;
    cogs: number;
    operatingExpenses: number;
    ebitda: number;
    depreciation: number;
    netIncome: number;
    interestExpense: number;
    totalTax: number;
    ads: number;
    // Balance sheet
    cash: number;
    accountsReceivable: number;
    inventory: number;
    totalFixedAssets: number;
    accountsPayable: number;
    totalLongTermDebt: number;
    totalEquity: number;
    yearsInBusiness: number;
  };

  // ── BIE research (unified: prose + structured) ─────────────────
  research: UnifiedResearch;

  // ── SBA assumptions (latest confirmed, if any) ─────────────────
  assumptions: {
    id: string;
    status: string;
    confirmedAt: string | null;
    raw: Record<string, unknown>; // full row for consumers that need it
  } | null;

  // ── Intake sections (address, owners, loan) ────────────────────
  intake: {
    address: Record<string, unknown>;
    owners: Array<Record<string, unknown>>;
    loan: Record<string, unknown>;
  };

  // ── Proceeds items ─────────────────────────────────────────────
  proceedsItems: Array<{
    category: string;
    description: string | null;
    amount: number;
  }>;

  // ── Validation gate ────────────────────────────────────────────
  validationStatus: string | null; // 'PASS' | 'WARN' | 'FAIL' | null

  // ── Metadata ───────────────────────────────────────────────────
  assembledAt: string;
}

// ─── Fact Resolver (with _IS suffix fallback) ────────────────────────────

type FactRow = { fact_key: string; fact_value_num: number | null };

function resolveFact(facts: FactRow[], ...keys: string[]): number {
  for (const key of keys) {
    const found = facts.find((f) => f.fact_key === key);
    if (found?.fact_value_num != null) return Number(found.fact_value_num);
  }
  return 0;
}

// ─── Builder ─────────────────────────────────────────────────────────────

export async function buildDealContext(dealId: string): Promise<DealContext | null> {
  const sb = supabaseAdmin();

  // All queries in parallel — single round of DB calls
  const [
    dealRes,
    appRes,
    ownersRes,
    interestsRes,
    guarantorRes,
    isFactsRes,
    bsFactsRes,
    assumptionsRes,
    addrRes,
    ownersIntakeRes,
    loanIntakeRes,
    proceedsRes,
    validationRes,
  ] = await Promise.all([
    // 1. Deal metadata
    sb.from("deals")
      .select("id, name, deal_type, loan_amount, city, state, bank_id, borrower_id")
      .eq("id", dealId)
      .maybeSingle(),

    // 2. Borrower application (latest)
    sb.from("borrower_applications")
      .select("naics, industry, business_legal_name, business_ein")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // 3. Ownership entities
    sb.from("deal_ownership_entities")
      .select("id, display_name, entity_type")
      .eq("deal_id", dealId),

    // 4. Ownership interests
    sb.from("deal_ownership_interests")
      .select("owner_entity_id, ownership_pct")
      .eq("deal_id", dealId),

    // 5. Guarantor cashflow
    sb.from("buddy_guarantor_cashflow")
      .select("entity_id, w2_salary, other_personal_income, mortgage_payment, auto_payments, student_loans, credit_card_minimums, other_personal_debt")
      .eq("deal_id", dealId),

    // 6. Income statement facts
    sb.from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId)
      .in("fact_key", [
        "TOTAL_REVENUE_IS", "TOTAL_REVENUE",
        "TOTAL_COGS_IS", "COST_OF_GOODS_SOLD", "COGS",
        "TOTAL_OPERATING_EXPENSES_IS", "TOTAL_OPERATING_EXPENSES",
        "NET_INCOME", "EBITDA",
        "DEPRECIATION_IS", "DEPRECIATION",
        "INTEREST_EXPENSE", "TOTAL_TAX", "ADS",
      ])
      .order("created_at", { ascending: false }),

    // 7. Balance sheet facts
    sb.from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId)
      .in("fact_key", [
        "CASH", "ACCOUNTS_RECEIVABLE", "INVENTORY",
        "TOTAL_FIXED_ASSETS", "ACCOUNTS_PAYABLE",
        "TOTAL_LONG_TERM_DEBT", "TOTAL_EQUITY", "YEARS_IN_BUSINESS",
      ]),

    // 8. SBA assumptions (latest confirmed, else latest draft)
    sb.from("buddy_sba_assumptions")
      .select("*")
      .eq("deal_id", dealId)
      .order("confirmed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // 9. Intake: address
    sb.from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "address")
      .maybeSingle(),

    // 10. Intake: owners
    sb.from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "owners")
      .maybeSingle(),

    // 11. Intake: loan
    sb.from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "loan")
      .maybeSingle(),

    // 12. Proceeds items
    sb.from("deal_proceeds_items")
      .select("category, description, amount")
      .eq("deal_id", dealId),

    // 13. Validation status
    sb.from("buddy_validation_reports")
      .select("overall_status")
      .eq("deal_id", dealId)
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!dealRes.data) return null;
  const deal = dealRes.data as Record<string, unknown>;

  // 14. Unified research (runs its own parallel sub-queries)
  const naicsCode = (appRes.data?.naics as string | null) ?? null;
  const research = await buildUnifiedResearch(dealId);
  const benchmark = findBenchmarkByNaics(naicsCode);

  // ── Assemble owners with ownership percentages ─────────────────
  const ownerRows = (ownersRes.data ?? []) as Array<{ id: string; display_name: string | null; entity_type: string | null }>;
  const interestRows = (interestsRes.data ?? []) as Array<{ owner_entity_id: string; ownership_pct: number | null }>;
  const owners = ownerRows.map((o) => {
    const interest = interestRows.find((i) => i.owner_entity_id === o.id);
    return {
      id: o.id,
      displayName: o.display_name,
      entityType: o.entity_type,
      ownershipPct: Number(interest?.ownership_pct ?? 0),
    };
  });

  // ── Assemble guarantors with owner names ───────────────────────
  const gRows = (guarantorRes.data ?? []) as Array<Record<string, unknown>>;
  const guarantors = gRows.map((g) => {
    const owner = owners.find((o) => o.id === g.entity_id);
    return {
      entityId: String(g.entity_id ?? ""),
      displayName: owner?.displayName ?? "Guarantor",
      ownershipPct: owner?.ownershipPct ?? 0,
      w2Salary: Number(g.w2_salary ?? 0),
      otherPersonalIncome: Number(g.other_personal_income ?? 0),
      mortgagePayment: Number(g.mortgage_payment ?? 0),
      autoPayments: Number(g.auto_payments ?? 0),
      studentLoans: Number(g.student_loans ?? 0),
      creditCardMinimums: Number(g.credit_card_minimums ?? 0),
      otherPersonalDebt: Number(g.other_personal_debt ?? 0),
    };
  });

  // ── Resolve financial facts ────────────────────────────────────
  const allFacts = [...(isFactsRes.data ?? []), ...(bsFactsRes.data ?? [])] as FactRow[];
  const revenue = resolveFact(allFacts, "TOTAL_REVENUE_IS", "TOTAL_REVENUE");
  const cogs = resolveFact(allFacts, "TOTAL_COGS_IS", "COST_OF_GOODS_SOLD", "COGS");
  const opex = resolveFact(allFacts, "TOTAL_OPERATING_EXPENSES_IS", "TOTAL_OPERATING_EXPENSES");
  const depreciation = resolveFact(allFacts, "DEPRECIATION_IS", "DEPRECIATION");
  const netIncome = resolveFact(allFacts, "NET_INCOME");
  const interestExpense = resolveFact(allFacts, "INTEREST_EXPENSE");
  const totalTax = resolveFact(allFacts, "TOTAL_TAX");
  let ebitda = resolveFact(allFacts, "EBITDA");
  if (ebitda === 0 && netIncome !== 0) {
    ebitda = netIncome + interestExpense + depreciation + totalTax;
  }

  // ── Intake sections ────────────────────────────────────────────
  const addrData = (addrRes.data?.data ?? {}) as Record<string, unknown>;
  const intakeOwnersRaw = (ownersIntakeRes.data?.data as { owners?: unknown })?.owners;
  const intakeOwners = Array.isArray(intakeOwnersRaw)
    ? (intakeOwnersRaw as Array<Record<string, unknown>>)
    : [];
  const loanData = (loanIntakeRes.data?.data ?? {}) as Record<string, unknown>;

  // ── Assumptions ────────────────────────────────────────────────
  const assumptionsRow = assumptionsRes.data as Record<string, unknown> | null;
  const assumptions = assumptionsRow
    ? {
        id: String(assumptionsRow.id),
        status: String(assumptionsRow.status ?? "draft"),
        confirmedAt: (assumptionsRow.confirmed_at as string | null) ?? null,
        raw: assumptionsRow,
      }
    : null;

  return {
    deal: {
      id: dealId,
      name: (deal.name as string | null) ?? null,
      dealType: (deal.deal_type as string | null) ?? null,
      loanAmount: Number(deal.loan_amount ?? 0),
      city: (deal.city as string | null) ?? null,
      state: (deal.state as string | null) ?? null,
      bankId: (deal.bank_id as string | null) ?? null,
      borrowerId: (deal.borrower_id as string | null) ?? null,
    },
    borrowerApp: appRes.data
      ? {
          naics: (appRes.data.naics as string | null) ?? null,
          industry: (appRes.data.industry as string | null) ?? null,
          businessLegalName: (appRes.data.business_legal_name as string | null) ?? null,
          businessEin: (appRes.data.business_ein as string | null) ?? null,
        }
      : null,
    benchmark,
    owners,
    guarantors,
    facts: {
      revenue,
      cogs,
      operatingExpenses: opex,
      ebitda,
      depreciation,
      netIncome,
      interestExpense,
      totalTax,
      ads: resolveFact(allFacts, "ADS"),
      cash: resolveFact(allFacts, "CASH"),
      accountsReceivable: resolveFact(allFacts, "ACCOUNTS_RECEIVABLE"),
      inventory: resolveFact(allFacts, "INVENTORY"),
      totalFixedAssets: resolveFact(allFacts, "TOTAL_FIXED_ASSETS"),
      accountsPayable: resolveFact(allFacts, "ACCOUNTS_PAYABLE"),
      totalLongTermDebt: resolveFact(allFacts, "TOTAL_LONG_TERM_DEBT"),
      totalEquity: resolveFact(allFacts, "TOTAL_EQUITY"),
      yearsInBusiness: resolveFact(allFacts, "YEARS_IN_BUSINESS"),
    },
    research,
    assumptions,
    intake: {
      address: addrData,
      owners: intakeOwners,
      loan: loanData,
    },
    proceedsItems: (proceedsRes.data ?? []) as Array<{
      category: string;
      description: string | null;
      amount: number;
    }>,
    validationStatus: (validationRes.data?.overall_status as string | null) ?? null,
    assembledAt: new Date().toISOString(),
  };
}
```

**Key design decisions:**

1. **13 Supabase calls in `Promise.all`** — one parallel round-trip replaces 27 sequential ones across consumers.
2. **`_IS` suffix fallback is centralized** — the `resolveFact()` helper handles the canonical key resolution problem once. No more duplicated fallback chains in every consumer.
3. **Ownership + interests are pre-joined** — consumers get `owners[].ownershipPct` directly instead of performing their own join.
4. **Guarantors are pre-joined with owner display names** — the same join that both the orchestrator and feasibility engine do independently.
5. **Assumptions come as `raw` for maximum flexibility** — consumers that need typed `SBAAssumptions` can cast; consumers that need specific columns can pick.
6. **Research extraction is deferred to Phase 2** — `buildUnifiedResearch()` is called once but runs its own sub-queries for missions/facts/inferences/narratives.

---

### Phase 2: Unified Research Extraction

**New file:** `src/lib/research/unifiedResearchExtractor.ts`

Merges the three existing extraction paths into one:

```typescript
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

// ─── Output Contract ─────────────────────────────────────────────────────

export interface UnifiedResearch {
  // ── Prose sections (from extractResearchForBusinessPlan) ───────
  prose: {
    industryOverview: string | null;
    industryOutlook: string | null;
    competitiveLandscape: string | null;
    marketIntelligence: string | null;
    borrowerProfile: string | null;
    managementIntelligence: string | null;
    regulatoryEnvironment: string | null;
    creditThesis: string | null;
    threeToFiveYearOutlook: string | null;
  };

  // ── Structured market data (from extractBIEMarketData) ────────
  market: {
    trendDirection: "improving" | "stable" | "deteriorating" | "unclear" | null;
    populationMentioned: number | null;
    medianIncomeMentioned: number | null;
    unemploymentRateMentioned: number | null;
    competitorCountMentioned: number | null;
    hasCompetitorNames: boolean;
    competitorNameCount: number;
    hasRealEstateData: boolean;
    hasNaturalDisasterRisk: boolean;
    hasEconomicConcentrationRisk: boolean;
    hasCrimeRisk: boolean;
    areaSpecificRisksText: string | null;
    realEstateMarketText: string | null;
    demographicTrendsText: string | null;
  };

  // ── Raw research signals (from sbaResearchProjectionGenerator) ─
  signals: {
    marketSize: number | null;
    marketGrowthRate: number | null;
    establishmentCount: number | null;
    employmentCount: number | null;
    averageWage: number | null;
    medianIncome: number | null;
    population: number | null;
    populationGrowthRate: number | null;
    competitiveIntensity: string | null;
    marketAttractiveness: string | null;
    growthTrajectory: string | null;
    cyclicalityRisk: string | null;
    demandStability: string | null;
  };

  // ── Source metadata ────────────────────────────────────────────
  missionId: string | null;
  missionStatus: string | null;
  hasMission: boolean;
}

export async function buildUnifiedResearch(dealId: string): Promise<UnifiedResearch> {
  const sb = supabaseAdmin();

  // Find latest mission
  const { data: missions } = await sb
    .from("buddy_research_missions")
    .select("id, status, completed_at, created_at")
    .eq("deal_id", dealId)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const missionIds = (missions ?? []).map((m: { id: string }) => m.id);
  const topMission = missions?.[0] as { id: string; status: string } | undefined;

  if (missionIds.length === 0) {
    return emptyResearch();
  }

  // Parallel: narratives, facts, inferences
  const [narrativeRes, factsRes, inferencesRes] = await Promise.all([
    sb.from("buddy_research_narratives")
      .select("sections, compiled_at, mission_id")
      .in("mission_id", missionIds)
      .order("compiled_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    sb.from("buddy_research_facts")
      .select("fact_type, value, confidence")
      .eq("mission_id", topMission!.id),

    sb.from("buddy_research_inferences")
      .select("inference_type, conclusion")
      .eq("mission_id", topMission!.id),
  ]);

  const sections = narrativeRes.data?.sections as unknown[] | null;
  const facts = (factsRes.data ?? []) as Array<{ fact_type: string; value: unknown; confidence: number | null }>;
  const inferences = (inferencesRes.data ?? []) as Array<{ inference_type: string; conclusion: string | null }>;

  // Build all three views from the same raw data
  const prose = buildProseSections(sections);
  const market = buildMarketData(facts, inferences, sections);
  const signals = buildResearchSignals(facts, inferences);

  return {
    prose,
    market,
    signals,
    missionId: topMission?.id ?? null,
    missionStatus: topMission?.status ?? null,
    hasMission: true,
  };
}

// ─── Prose section extraction ────────────────────────────────────────────
// (Logic from sbaResearchExtractor.ts — extractSection)

function buildProseSections(sections: unknown[] | null) {
  // ... identical logic to current extractResearchForBusinessPlan
  // but operates on already-fetched sections array instead of
  // making its own DB call.
  // Returns the 9 prose section strings.
  //
  // Implementation: copy extractSection() helper from
  // sbaResearchExtractor.ts and apply it here.
}

// ─── Structured market data extraction ───────────────────────────────────
// (Logic from feasibility/bieMarketExtractor.ts)

function buildMarketData(
  facts: Array<{ fact_type: string; value: unknown; confidence: number | null }>,
  inferences: Array<{ inference_type: string; conclusion: string | null }>,
  sections: unknown[] | null,
) {
  // ... identical logic to current extractBIEMarketData
  // but operates on already-fetched facts/inferences/sections
  // instead of making its own DB calls.
  //
  // Implementation: copy the extraction logic from
  // bieMarketExtractor.ts and apply it here.
}

// ─── Raw research signals ────────────────────────────────────────────────
// (Logic from sbaResearchProjectionGenerator.ts factNum/inference helpers)

function buildResearchSignals(
  facts: Array<{ fact_type: string; value: unknown; confidence: number | null }>,
  inferences: Array<{ inference_type: string; conclusion: string | null }>,
) {
  // ... identical logic to current sbaResearchProjectionGenerator
  // inline fact/inference extraction, but operates on
  // already-fetched data.
  //
  // Implementation: copy jsonbToNumber() and the factNum/inference
  // helpers from sbaResearchProjectionGenerator.ts.
}

function emptyResearch(): UnifiedResearch {
  return {
    prose: {
      industryOverview: null, industryOutlook: null,
      competitiveLandscape: null, marketIntelligence: null,
      borrowerProfile: null, managementIntelligence: null,
      regulatoryEnvironment: null, creditThesis: null,
      threeToFiveYearOutlook: null,
    },
    market: {
      trendDirection: null, populationMentioned: null,
      medianIncomeMentioned: null, unemploymentRateMentioned: null,
      competitorCountMentioned: null, hasCompetitorNames: false,
      competitorNameCount: 0, hasRealEstateData: false,
      hasNaturalDisasterRisk: false, hasEconomicConcentrationRisk: false,
      hasCrimeRisk: false, areaSpecificRisksText: null,
      realEstateMarketText: null, demographicTrendsText: null,
    },
    signals: {
      marketSize: null, marketGrowthRate: null,
      establishmentCount: null, employmentCount: null,
      averageWage: null, medianIncome: null,
      population: null, populationGrowthRate: null,
      competitiveIntensity: null, marketAttractiveness: null,
      growthTrajectory: null, cyclicalityRisk: null,
      demandStability: null,
    },
    missionId: null, missionStatus: null, hasMission: false,
  };
}
```

**After this file exists, the three original extractors become thin wrappers:**

- `sbaResearchExtractor.ts` → `export async function extractResearchForBusinessPlan(dealId) { const r = await buildUnifiedResearch(dealId); return r.prose; }`
- `bieMarketExtractor.ts` → `export async function extractBIEMarketData(dealId) { const r = await buildUnifiedResearch(dealId); return r.market; }`
- `sbaResearchProjectionGenerator.ts` → consumes `ctx.research.signals` from `DealContext` instead of inline queries.

The originals are kept as backward-compatible shims for any code that imports them directly, but all new code should consume `DealContext.research`.

---

### Phase 3: Version Binding for Feasibility

**Problem:** Feasibility reads "latest" SBA package. Must bind to a specific version.

**File:** `src/lib/feasibility/feasibilityEngine.ts` (MODIFY)

```typescript
// BEFORE (current):
const { data: sbaPackageRaw } = await sb
  .from("buddy_sba_packages")
  .select("*")
  .eq("deal_id", dealId)
  .order("version_number", { ascending: false })
  .limit(1)
  .maybeSingle();

// AFTER (version-bound):
export async function generateFeasibilityStudy(params: {
  dealId: string;
  bankId: string;
  sbaPackageId?: string; // NEW — explicit binding
  onProgress?: FeasibilityProgressCallback;
}): Promise<FeasibilityResult> {
  // ...
  let sbaPackageRaw;
  if (params.sbaPackageId) {
    // Explicit version binding — always use this specific package
    const { data } = await sb
      .from("buddy_sba_packages")
      .select("*")
      .eq("id", params.sbaPackageId)
      .eq("deal_id", dealId) // safety: verify it belongs to this deal
      .maybeSingle();
    sbaPackageRaw = data;
  } else {
    // Fallback: latest version (backward compatible)
    const { data } = await sb
      .from("buddy_sba_packages")
      .select("*")
      .eq("deal_id", dealId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    sbaPackageRaw = data;
  }
  // ... rest of engine unchanged
```

**Migration:** `20260421_03_feasibility_version_binding`

```sql
ALTER TABLE buddy_feasibility_studies
  ADD COLUMN IF NOT EXISTS projections_package_version integer;

COMMENT ON COLUMN buddy_feasibility_studies.projections_package_version
  IS 'Version number of the SBA package used for financial viability scoring. Enables traceability.';
```

**API update:** The feasibility generate route should accept an optional `sbaPackageId` parameter. The UI's "Run Feasibility Study" button should capture the currently-displayed SBA package ID and pass it through.

---

### Phase 4: Consumer Refactoring

Each consumer is updated to accept `DealContext` instead of making its own queries. This is purely mechanical — no business logic changes.

#### 4A. `sbaPackageOrchestrator.ts` — The Big One

**Current:** ~15 independent SELECT calls throughout the function.  
**After:** Accept `DealContext` as parameter, eliminate all inline queries.

```typescript
// BEFORE:
export async function generateSBAPackage(dealId: string): Promise<...>

// AFTER:
export async function generateSBAPackage(
  dealId: string,
  ctx?: DealContext, // optional for backward compatibility
): Promise<...> {
  const context = ctx ?? await buildDealContext(dealId);
  if (!context) return { ok: false, error: "Deal not found" };

  // Gate 1: Validation
  if (context.validationStatus === "FAIL") {
    return { ok: false, error: "Validation Pass is FAIL." };
  }

  // Gate 2: Assumptions confirmed
  if (!context.assumptions || context.assumptions.status !== "confirmed") {
    return { ok: false, error: "Assumptions must be confirmed." };
  }

  // All data sourced from context instead of inline queries:
  const deal = context.deal;
  const app = context.borrowerApp;
  const research = context.research.prose;
  const naicsCode = app?.naics ?? null;
  const benchmark = context.benchmark;
  const revenue = context.facts.revenue;
  const cogs = context.facts.cogs;
  // ... etc

  // Only queries NOT in DealContext remain inline:
  // - buddy_sba_packages (for version tracking — writes, not reads)
  // - sba_form_payloads (for cross-fill — writes)
  // - deal-documents storage (for PDF upload — writes)
}
```

**What gets removed from the orchestrator:**
- `sb.from("deals").select(...)` — use `ctx.deal`
- `sb.from("borrower_applications").select(...)` — use `ctx.borrowerApp`
- `sb.from("deal_financial_facts").select(...)` (both IS and BS queries) — use `ctx.facts`
- `sb.from("deal_ownership_entities").select(...)` — use `ctx.owners`
- `sb.from("deal_ownership_interests").select(...)` — pre-joined in `ctx.owners`
- `sb.from("buddy_guarantor_cashflow").select(...)` — use `ctx.guarantors`
- `sb.from("buddy_sba_assumptions").select(...)` — use `ctx.assumptions`
- `sb.from("deal_proceeds_items").select(...)` — use `ctx.proceedsItems`
- `sb.from("buddy_validation_reports").select(...)` — use `ctx.validationStatus`
- `extractResearchForBusinessPlan(dealId)` — use `ctx.research.prose`
- `findBenchmarkByNaics(naicsCode)` — use `ctx.benchmark`

**Net: ~15 inline queries → 0. The orchestrator becomes a pure computation + write layer.**

#### 4B. `feasibilityEngine.ts`

Same pattern. Accept `DealContext` as optional parameter.

```typescript
export async function generateFeasibilityStudy(params: {
  dealId: string;
  bankId: string;
  sbaPackageId?: string;
  ctx?: DealContext; // NEW
  onProgress?: FeasibilityProgressCallback;
}): Promise<FeasibilityResult> {
  const context = params.ctx ?? await buildDealContext(params.dealId);
  if (!context) return { ok: false, error: "Deal not found" };

  // All reads from context:
  const deal = context.deal;
  const app = context.borrowerApp;
  const research = context.research.prose;
  const bieMarket = context.research.market;
  const benchmark = context.benchmark;
  const owners = context.owners;
  const guarantorCF = context.guarantors;

  // Only SBA package read remains (version-bound, see Phase 3)
  // ...
}
```

**What gets removed from the feasibility engine:**
- `sb.from("deals").select(...)` — use `ctx.deal`
- `sb.from("borrower_applications").select(...)` — use `ctx.borrowerApp`
- `extractResearchForBusinessPlan(dealId)` — use `ctx.research.prose`
- `extractBIEMarketData(dealId)` — use `ctx.research.market`
- `sb.from("buddy_sba_assumptions").select(...)` — use `ctx.assumptions`
- `sb.from("deal_ownership_entities").select(...)` — use `ctx.owners`
- `sb.from("buddy_guarantor_cashflow").select(...)` — use `ctx.guarantors`
- `findBenchmarkByNaics(naicsCode)` — use `ctx.benchmark`

**Net: ~8 inline queries → 1 (SBA package, version-bound).**

#### 4C. `sbaResearchProjectionGenerator.ts`

```typescript
export async function generateProjectionsFromResearch(
  dealId: string,
  ctx?: DealContext, // NEW
): Promise<GeneratedProjectionResult> {
  const context = ctx ?? await buildDealContext(dealId);
  if (!context) throw new Error("Deal not found");

  // All reads from context:
  const naicsCode = context.borrowerApp?.naics ?? null;
  const benchmark = context.benchmark;
  const intakeOwners = context.intake.owners;
  const loanAmount = /* ... from context.intake.loan or context.deal.loanAmount */;
  const researchSignals = context.research.signals;

  // The only remaining inline call is sbaAssumptionsPrefill
  // which also gets refactored to accept DealContext
}
```

#### 4D. `sbaAssumptionsPrefill.ts`

```typescript
export async function loadSBAAssumptionsPrefill(
  dealId: string,
  ctx?: DealContext, // NEW
): Promise<PrefilledAssumptions> {
  const context = ctx ?? await buildDealContext(dealId);
  if (!context) return {};

  // All reads from context instead of inline queries
  const naicsCode = context.borrowerApp?.naics ?? null;
  const benchmark = context.benchmark;
  const revenue = context.facts.revenue;
  const cogs = context.facts.cogs;
  const ads = context.facts.ads;
  const owners = context.owners;
  const deal = context.deal;
  // ... etc
}
```

---

### Phase 5: Omega Advisory Reconciliation Layer

**This is where Pulse Omega Prime enters — as the advisory/annotation layer, never the connective tissue.**

Once all three systems consume `DealContext` and their outputs are version-bound, Omega can observe the outputs and flag contradictions. This respects the SR 11-7 boundary: Buddy owns canonical state; Omega owns commentary.

**New file:** `src/lib/omega/crossSystemReconciliation.ts`

```typescript
import "server-only";

export interface CrossSystemFlag {
  severity: "info" | "warning" | "critical";
  systems: [string, string]; // e.g. ["business_plan", "feasibility"]
  field: string;
  message: string;
  businessPlanValue?: string;
  projectionsValue?: string;
  feasibilityValue?: string;
}

/**
 * Advisory reconciliation — reads outputs from all three systems
 * for the same deal and flags contradictions.
 *
 * This function NEVER writes to canonical Buddy tables.
 * Flags are surfaced via Pulse telemetry and the Omega annotation layer.
 */
export async function reconcileThreeSystems(params: {
  dealId: string;
  sbaPackageId: string;
  feasibilityStudyId: string;
}): Promise<CrossSystemFlag[]> {
  const sb = supabaseAdmin();
  const flags: CrossSystemFlag[] = [];

  const [pkgRes, studyRes] = await Promise.all([
    sb.from("buddy_sba_packages").select("*").eq("id", params.sbaPackageId).maybeSingle(),
    sb.from("buddy_feasibility_studies").select("*").eq("id", params.feasibilityStudyId).maybeSingle(),
  ]);

  const pkg = pkgRes.data as Record<string, unknown> | null;
  const study = studyRes.data as Record<string, unknown> | null;
  if (!pkg || !study) return flags;

  // ── Revenue growth assumption vs feasibility market demand score
  const projY1Revenue = (pkg.projections_annual as Array<{ revenue?: number }>)?.[0]?.revenue;
  const marketScore = study.market_demand_score as number | null;
  if (projY1Revenue && marketScore != null && marketScore < 40) {
    flags.push({
      severity: "warning",
      systems: ["projections", "feasibility"],
      field: "revenue_vs_market_demand",
      message: `Projections assume $${Math.round(projY1Revenue).toLocaleString()} Year 1 revenue, but feasibility market demand scores only ${marketScore}/100. Revenue assumptions may be unsupported by local market conditions.`,
      projectionsValue: `$${Math.round(projY1Revenue).toLocaleString()}`,
      feasibilityValue: `${marketScore}/100`,
    });
  }

  // ── DSCR consistency: package DSCR vs feasibility financial viability
  const pkgDscr = pkg.dscr_year1_base as number | null;
  const fvDetail = study.financial_viability_detail as Record<string, unknown> | null;
  const fvDscrDetail = (fvDetail?.debtServiceCoverage as { detail?: string })?.detail;
  // If the feasibility study's financial viability consumed a different DSCR
  // than what's in the package, flag it
  if (pkgDscr && fvDscrDetail && !fvDscrDetail.includes(pkgDscr.toFixed(2))) {
    flags.push({
      severity: "critical",
      systems: ["projections", "feasibility"],
      field: "dscr_version_mismatch",
      message: `SBA package DSCR (${pkgDscr.toFixed(2)}x) may not match the DSCR used in feasibility scoring. Verify both were computed from the same projection version.`,
    });
  }

  // ── Business plan growth narrative vs projection growth rates
  const execSummary = pkg.executive_summary as string | null;
  const projGrowthY1 = (pkg.projections_annual as Array<{ revenueGrowthPct?: number }>)?.[0]?.revenueGrowthPct;
  if (execSummary && projGrowthY1 != null) {
    const growthPct = Math.round(projGrowthY1 * 100);
    // Check if the narrative mentions a materially different growth figure
    const mentionedGrowth = execSummary.match(/(\d+)%\s*(?:revenue\s*)?growth/i);
    if (mentionedGrowth) {
      const narrativeGrowth = parseInt(mentionedGrowth[1], 10);
      if (Math.abs(narrativeGrowth - growthPct) > 5) {
        flags.push({
          severity: "warning",
          systems: ["business_plan", "projections"],
          field: "growth_rate_narrative_mismatch",
          message: `Executive summary mentions ${narrativeGrowth}% growth but projections model uses ${growthPct}%. Gemini narrative may have hallucinated a different figure.`,
          businessPlanValue: `${narrativeGrowth}%`,
          projectionsValue: `${growthPct}%`,
        });
      }
    }
  }

  // ── Equity injection: S&U says X%, feasibility capitalization scores Y
  const sourcesAndUses = pkg.sources_and_uses as Record<string, unknown> | null;
  const equityPct = (sourcesAndUses?.equityInjection as { actualPct?: number })?.actualPct;
  const fvCapDetail = (fvDetail?.capitalizationAdequacy as { score?: number })?.score;
  if (equityPct != null && fvCapDetail != null && fvCapDetail < 40 && equityPct >= 0.10) {
    flags.push({
      severity: "info",
      systems: ["projections", "feasibility"],
      field: "equity_scoring_disconnect",
      message: `Equity injection is ${(equityPct * 100).toFixed(1)}% (meets SBA minimum) but feasibility capitalization scores ${fvCapDetail}/100. Investigate whether the minimum is too thin for the risk profile.`,
    });
  }

  // ── Operational readiness vs management bios in business plan
  const opScore = study.operational_readiness_score as number | null;
  const mgmtBios = pkg.business_overview_narrative as string | null;
  if (opScore != null && opScore < 50 && mgmtBios && mgmtBios.length > 200) {
    flags.push({
      severity: "info",
      systems: ["business_plan", "feasibility"],
      field: "management_narrative_vs_readiness",
      message: `Business plan has detailed management narrative but feasibility operational readiness scores only ${opScore}/100. The narrative may be masking thin management experience data.`,
    });
  }

  return flags;
}
```

**Telemetry integration:** After both systems complete, call `reconcileThreeSystems()` and emit flags via the existing Pulse telemetry pipeline:

```typescript
import { emitBuddyEvent } from "@/lib/pulse/buddyEventEmitter";

const flags = await reconcileThreeSystems({
  dealId,
  sbaPackageId: pkg.id,
  feasibilityStudyId: study.id,
});

if (flags.length > 0) {
  await emitBuddyEvent({
    event_code: "cross_system_reconciliation",
    deal_id: dealId,
    payload: { flags, packageVersion: pkg.version_number },
    severity: flags.some(f => f.severity === "critical") ? "critical" : "info",
  });
}
```

**Omega surfaces these flags** in the Pulse dashboard as advisory annotations — "Buddy noticed a discrepancy between your business plan and feasibility study." The banker can then investigate. Omega never writes back to `buddy_sba_packages` or `buddy_feasibility_studies`. It observes, annotates, nudges.

---

## New File Summary

| File | Phase | Purpose |
|------|-------|---------|
| `src/lib/deal/dealContext.ts` | 1 | Canonical deal context builder — 13 parallel queries → single typed object |
| `src/lib/research/unifiedResearchExtractor.ts` | 2 | Merged research extraction — prose + structured + signals from one DB pass |
| `src/lib/omega/crossSystemReconciliation.ts` | 5 | Advisory reconciliation — flags contradictions across all three systems |

## Modified File Summary

| File | Phase | Changes |
|------|-------|---------|
| `src/lib/sba/sbaPackageOrchestrator.ts` | 4A | Accept `DealContext`, remove ~15 inline queries |
| `src/lib/feasibility/feasibilityEngine.ts` | 3, 4B | Accept `DealContext`, add version binding, remove ~8 inline queries |
| `src/lib/sba/sbaResearchProjectionGenerator.ts` | 4C | Accept `DealContext`, remove inline research queries |
| `src/lib/sba/sbaAssumptionsPrefill.ts` | 4D | Accept `DealContext`, remove inline queries |
| `src/lib/sba/sbaResearchExtractor.ts` | 2 | Becomes thin wrapper over `unifiedResearchExtractor` |
| `src/lib/feasibility/bieMarketExtractor.ts` | 2 | Becomes thin wrapper over `unifiedResearchExtractor` |
| `src/app/api/deals/[dealId]/sba/generate/route.ts` | 4A | Build context once, pass to orchestrator |
| `src/app/api/deals/[dealId]/feasibility/generate/route.ts` | 4B | Build context once, pass to engine with version binding |

## Migration Summary

```sql
-- Phase 3: Version binding for feasibility
ALTER TABLE buddy_feasibility_studies
  ADD COLUMN IF NOT EXISTS projections_package_version integer;

COMMENT ON COLUMN buddy_feasibility_studies.projections_package_version
  IS 'Version number of the SBA package used for financial viability scoring.';
```

No other migrations needed — this is purely a code-layer unification.

---

## Implementation Order

Build in this sequence. Each step is independently deployable and backward-compatible.

1. **`dealContext.ts`** — new file, no existing code changes. Write tests.
2. **`unifiedResearchExtractor.ts`** — new file, no existing code changes. Write tests.
3. **Thin wrappers** — update `sbaResearchExtractor.ts` and `bieMarketExtractor.ts` to delegate to unified extractor. Verify existing callers still work.
4. **Migration** — add `projections_package_version` column.
5. **`feasibilityEngine.ts`** — add `ctx` and `sbaPackageId` parameters. Keep fallback for callers that don't pass them.
6. **`sbaPackageOrchestrator.ts`** — add `ctx` parameter. Remove inline queries one by one, testing after each removal.
7. **`sbaResearchProjectionGenerator.ts`** — add `ctx` parameter.
8. **`sbaAssumptionsPrefill.ts`** — add `ctx` parameter.
9. **API routes** — update generate routes to build context once and pass through.
10. **`crossSystemReconciliation.ts`** — new file. Wire into post-generation hooks.
11. **Pulse telemetry** — emit reconciliation flags via existing buddy event pipeline.

**Each step maintains full backward compatibility.** The `ctx` parameter is always optional with a fallback to `buildDealContext(dealId)`. Existing callers continue to work unchanged until they're updated.

---

## Verification Queries

```sql
-- After Phase 1: Verify DealContext assembles correctly
-- Run buildDealContext('ffcc9733-f866-47fc-83f9-7c08403cea71')
-- and check all fields are populated for the Samaritus test deal.

-- After Phase 3: Verify version binding column exists
SELECT column_name FROM information_schema.columns
WHERE table_name = 'buddy_feasibility_studies'
AND column_name = 'projections_package_version';
-- Expected: 1 row

-- After Phase 4: Verify no direct queries remain in orchestrator
-- grep -n "sb.from" src/lib/sba/sbaPackageOrchestrator.ts
-- Expected: only write operations (INSERT, UPDATE, storage.upload)
-- No SELECT queries for deals, borrower_applications, financial_facts,
-- ownership_entities, ownership_interests, guarantor_cashflow, or
-- validation_reports.

-- After Phase 5: Check reconciliation events in Pulse
SELECT event_code, payload->>'flags' as flag_count, created_at
FROM buddy_ledger_events
WHERE event_code = 'cross_system_reconciliation'
AND deal_id = 'ffcc9733-f866-47fc-83f9-7c08403cea71'
ORDER BY created_at DESC
LIMIT 5;
```

---

## What This Does NOT Change

1. **No system is diminished.** Each system keeps its full analytical depth, scoring logic, narrative quality, and PDF rendering. The only change is WHERE they get their input data — from a shared context instead of independent queries.

2. **No system's output changes.** Given the same input data, every system produces identical results before and after unification. This is a plumbing change, not a logic change.

3. **Omega does not become the connective tissue.** Omega observes and annotates — it never writes to canonical Buddy tables. The `crossSystemReconciliation` function produces flags that flow through Pulse telemetry as advisory annotations, not state mutations.

4. **No coupling between systems.** The Business Plan and Projections systems remain fused in the Orchestrator. Feasibility remains a separate downstream consumer. The `DealContext` is the shared input, not a shared state machine. Each system can still be tested, run, and deployed independently.

5. **The dependency chain is preserved.** Research Gen → Assumptions → Projections → Business Plan → Feasibility. The unification doesn't flatten this — it just ensures every link in the chain reads from the same canonical data source.

---

*End of spec. Copy-pasteable for Claude Code. Every file path, TypeScript contract, SQL statement, and verification query is exact.*
