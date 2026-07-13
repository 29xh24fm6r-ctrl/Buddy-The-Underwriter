import "server-only";

/**
 * Buddy SBA Score — input loader.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Non-negotiable rule: this module CALLS `buildSBARiskProfile()` and
 * maps its outputs. It MUST NOT reimplement NAICS lookup, business-age
 * assessment, loan-term risk, or urban/rural logic. That logic lives in
 * src/lib/sba/sbaRiskProfile.ts and is called via the import below.
 * ──────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSBARiskProfile,
  type SBARiskProfile,
  type UrbanRuralClassification,
} from "@/lib/sba/sbaRiskProfile";

export type ScoreInputs = {
  dealId: string;
  bankId: string;
  loanAmount: number | null;
  program: string; // "7a" | "504" | "express"
  isFranchise: boolean;

  // Risk-profile output (verbatim from buildSBARiskProfile — not reimplemented)
  riskProfile: SBARiskProfile;

  // Direct fact reads
  naics: string | null;
  industry: string | null;
  businessEntityType: string | null;

  // Applicant financials (Category B migration — borrower_applicant_financials)
  applicants: Array<{
    applicantId: string;
    ficoScore: number | null;
    liquidAssets: number | null;
    netWorth: number | null;
    industryExperienceYears: number | null;
  }>;

  // SBA package metrics
  dscrBase: number | null;
  dscrStress: number | null;
  dscrGlobal: number | null;
  sbaGuarantyPct: number | null;
  sourcesAndUses: unknown | null;
  useOfProceeds: unknown[] | null;
  projectionsAnnual: unknown | null;

  // Collateral
  collateralNetLendableTotal: number | null;
  equityInjectionAmount: number | null;
  totalProjectCost: number | null;

  // Feasibility
  feasibilityComposite: number | null;
  feasibilityDimensions: {
    marketDemand: number | null;
    financialViability: number | null;
    operationalReadiness: number | null;
    locationSuitability: number | null;
  };

  // Business profile
  yearsInBusiness: number | null;
  annualRevenueUsd: number | null;
  employeeCount: number | null;

  // Franchise (only populated when isFranchise = true)
  franchise: {
    brandId: string;
    unitCount: number | null;
    foundingYear: number | null;
    sbaEligible: boolean | null;
    sbaCertificationStatus: string | null;
    hasItem19: boolean | null;
    item19PercentileRank: number | null;
  } | null;

  // Management
  managementTeamSize: number | null;

  // Federal-compliance / character / affiliates disclosures (borrower
  // intake "compliance" step — see src/lib/score/eligibility/evaluate.ts).
  // null = not yet disclosed.
  federalDebtDelinquent: boolean | null;
  taxDelinquent: boolean | null;
  samDebarred: boolean | null;
  felonyConviction: boolean | null;
  incarceratedOrParole: boolean | null;
  priorGovLoanDefault: boolean | null;
  hasAffiliates: boolean | null;

  // Serializable snapshot for audit trail
  snapshot: Record<string, unknown>;

  // Tracks sub-factor inputs that were missing
  missingInputs: string[];
};

function tryNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Any owner true -> true (one bad actor is enough to fail the deal).
 * Otherwise, only resolve to a definite false once every owner has
 * explicitly answered false; a mix of false/unknown stays null (pending),
 * same "not yet disclosed" semantics as the wizard-driven compliance step.
 */
export function deriveCharacterFlagsFromOwners(
  owners: Array<{
    convicted_or_pleaded: boolean | null;
    on_parole_or_probation: boolean | null;
  }>,
): { felonyConviction: boolean | null; incarceratedOrParole: boolean | null } {
  if (owners.length === 0) {
    return { felonyConviction: null, incarceratedOrParole: null };
  }
  const resolve = (key: "convicted_or_pleaded" | "on_parole_or_probation"): boolean | null => {
    if (owners.some((o) => o[key] === true)) return true;
    if (owners.every((o) => o[key] === false)) return false;
    return null;
  };
  return {
    felonyConviction: resolve("convicted_or_pleaded"),
    incarceratedOrParole: resolve("on_parole_or_probation"),
  };
}

export async function loadScoreInputs(params: {
  dealId: string;
  sb: SupabaseClient;
}): Promise<ScoreInputs> {
  const { dealId, sb } = params;
  const missing: string[] = [];

  // ─── Deal base ────────────────────────────────────────────────────────
  const { data: deal, error: dealError } = await sb
    .from("deals")
    .select("id, bank_id, loan_amount, loan_type")
    .eq("id", dealId)
    .maybeSingle();

  if (dealError || !deal) {
    throw new Error(`Deal ${dealId} not found: ${dealError?.message ?? "no row"}`);
  }

  // ─── Borrower application / applicants ────────────────────────────────
  const { data: application } = await sb
    .from("borrower_applications")
    .select(
      "id, naics, industry, business_entity_type, sba7a_eligible, sba7a_ineligibility_reasons",
    )
    .eq("deal_id", dealId)
    .maybeSingle();

  const applicationId: string | null = application?.id ?? null;

  let applicants: ScoreInputs["applicants"] = [];
  if (applicationId) {
    const { data: applicantRows } = await sb
      .from("borrower_applicants")
      .select("id")
      .eq("application_id", applicationId);

    const ids = (applicantRows ?? []).map((r: { id: string }) => r.id);
    if (ids.length > 0) {
      const { data: financials } = await sb
        .from("borrower_applicant_financials")
        .select(
          "applicant_id, fico_score, liquid_assets, net_worth, industry_experience_years",
        )
        .in("applicant_id", ids);

      const byId = new Map<string, any>(
        (financials ?? []).map((r: any) => [r.applicant_id, r]),
      );
      applicants = ids.map((id) => {
        const row = byId.get(id);
        return {
          applicantId: id,
          ficoScore: tryNumber(row?.fico_score),
          liquidAssets: tryNumber(row?.liquid_assets),
          netWorth: tryNumber(row?.net_worth),
          industryExperienceYears: tryNumber(row?.industry_experience_years),
        };
      });
    }
  }

  if (applicants.length === 0) missing.push("applicants");
  if (!applicants.some((a) => a.ficoScore != null)) missing.push("fico_score");
  if (!applicants.some((a) => a.liquidAssets != null)) missing.push("liquid_assets");
  if (!applicants.some((a) => a.netWorth != null)) missing.push("net_worth");
  if (!applicants.some((a) => a.industryExperienceYears != null)) {
    missing.push("industry_experience_years");
  }

  // ─── SBA package ──────────────────────────────────────────────────────
  const { data: pkg } = await sb
    .from("buddy_sba_packages")
    .select(
      "dscr_year1_base, dscr_year1_downside, global_dscr, sba_guarantee_pct, sources_and_uses, use_of_proceeds, projections_annual",
    )
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!pkg) missing.push("buddy_sba_packages");

  // ─── Facts (for yearsInBusiness, revenue, employees) ─────────────────
  const { data: factRows } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_value_text")
    .eq("deal_id", dealId);

  function factNum(key: string): number | null {
    const row = factRows?.find((r: any) => r.fact_key === key);
    return tryNumber(row?.fact_value_num);
  }

  const yearsInBusiness = factNum("YEARS_IN_BUSINESS");
  const annualRevenueUsd = factNum("ANNUAL_REVENUE");
  const employeeCount = factNum("EMPLOYEE_COUNT");

  if (yearsInBusiness == null) missing.push("years_in_business");
  if (annualRevenueUsd == null) missing.push("annual_revenue");

  // ─── Federal compliance / character / affiliates disclosures ──────────
  // Borrower-answered on the intake "compliance" step (see
  // src/components/borrower/intake/IntakeFormClient.tsx). Section is
  // absent until the borrower reaches that step — all fields resolve to
  // null ("not yet disclosed"), which evaluateBuddySbaEligibility treats
  // as a pending pass, not a failure.
  const { data: complianceSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", dealId)
    .eq("section_key", "compliance")
    .maybeSingle();

  function complianceBool(key: string): boolean | null {
    const v = (complianceSection?.data as Record<string, unknown> | null)?.[key];
    return typeof v === "boolean" ? v : null;
  }

  const federalDebtDelinquent = complianceBool("federal_debt_delinquent");
  const taxDelinquent = complianceBool("tax_delinquent");
  const samDebarred = complianceBool("sam_debarred");
  const priorGovLoanDefault = complianceBool("prior_gov_loan_default");
  const hasAffiliates = complianceBool("has_affiliates");

  // Marketplace/brokerage-originated deals never see the intake wizard, so
  // `complianceSection` is absent for them — but the chat/voice concierge
  // (Arc 7) may have already captured the two character facts that have a
  // direct SBA-Form-912 equivalent on ownership_entities. Fall back to those
  // so a marketplace deal isn't silently exempted from the character gate.
  // federal_debt_delinquent/tax_delinquent/sam_debarred/prior_gov_loan_default
  // and has_affiliates have no concierge-side equivalent yet and stay null.
  let felonyConviction = complianceBool("felony_conviction");
  let incarceratedOrParole = complianceBool("incarcerated_or_parole");
  if (!complianceSection) {
    const { data: ownerRows } = await sb
      .from("ownership_entities")
      .select("convicted_or_pleaded, on_parole_or_probation")
      .eq("deal_id", dealId);
    const derived = deriveCharacterFlagsFromOwners(
      (ownerRows ?? []) as Array<{
        convicted_or_pleaded: boolean | null;
        on_parole_or_probation: boolean | null;
      }>,
    );
    felonyConviction = derived.felonyConviction;
    incarceratedOrParole = derived.incarceratedOrParole;
  }

  // ─── Collateral ───────────────────────────────────────────────────────
  const { data: collateral } = await sb
    .from("deal_collateral_items")
    .select("net_lendable_value")
    .eq("deal_id", dealId);

  const collateralNetLendableTotal = (collateral ?? []).reduce(
    (sum: number, r: any) => sum + (tryNumber(r?.net_lendable_value) ?? 0),
    0,
  );

  // ─── Feasibility ──────────────────────────────────────────────────────
  const { data: feasibility } = await sb
    .from("buddy_feasibility_studies")
    .select(
      "composite_score, market_demand_score, financial_viability_score, operational_readiness_score, location_suitability_score",
    )
    .eq("deal_id", dealId)
    .maybeSingle();

  // ─── Franchise ────────────────────────────────────────────────────────
  const { data: franchiseLink } = await sb
    .from("deal_franchises")
    .select("brand_id")
    .eq("deal_id", dealId)
    .maybeSingle();

  const isFranchise = Boolean(franchiseLink?.brand_id);
  let franchise: ScoreInputs["franchise"] = null;

  if (isFranchise && franchiseLink?.brand_id) {
    const { data: brand } = await sb
      .from("franchise_brands")
      .select(
        "id, unit_count, founding_year, sba_eligible, sba_certification_status, has_item_19",
      )
      .eq("id", franchiseLink.brand_id)
      .maybeSingle();

    // Use highest-percentile Item 19 metric as the representative tier.
    const { data: item19 } = await sb
      .from("fdd_item19_facts")
      .select("percentile_rank")
      .eq("brand_id", franchiseLink.brand_id)
      .order("percentile_rank", { ascending: false })
      .limit(1);

    franchise = {
      brandId: franchiseLink.brand_id,
      unitCount: tryNumber(brand?.unit_count),
      foundingYear: tryNumber(brand?.founding_year),
      sbaEligible: brand?.sba_eligible ?? null,
      sbaCertificationStatus: brand?.sba_certification_status ?? null,
      hasItem19: brand?.has_item_19 ?? null,
      item19PercentileRank: tryNumber(item19?.[0]?.percentile_rank),
    };
  }

  // ─── Management depth (buddy_sba_assumptions.management_team) ────────
  const { data: assumptions } = await sb
    .from("buddy_sba_assumptions")
    .select("management_team")
    .eq("deal_id", dealId)
    .maybeSingle();

  let managementTeamSize: number | null = null;
  if (Array.isArray(assumptions?.management_team)) {
    managementTeamSize = (assumptions.management_team as unknown[]).filter(
      (m) => m && typeof m === "object",
    ).length;
  }

  // ─── Project-cost math for equity-injection pct ───────────────────────
  // Pull equity injection + total project cost from sources_and_uses jsonb
  // when available; otherwise derive from loan_amount alone.
  let equityInjectionAmount: number | null = null;
  let totalProjectCost: number | null = null;
  const sau = pkg?.sources_and_uses as Record<string, unknown> | null | undefined;
  if (sau && typeof sau === "object") {
    equityInjectionAmount = tryNumber((sau as any).equity_injection);
    totalProjectCost =
      tryNumber((sau as any).total_project_cost) ??
      tryNumber((sau as any).total_uses);
  }

  // ─── Build the risk profile via the canonical function ────────────────
  // CRITICAL: This is the ONE call site for NAICS/age/term/urban-rural
  // logic from Sprint 0's perspective. No duplication lives in /score/.
  const facts = (factRows ?? []).map((r: any) => ({
    fact_key: r.fact_key as string,
    value_numeric: tryNumber(r.fact_value_num),
    value_text: (r.fact_value_text as string | null) ?? null,
  }));

  const riskProfile = await buildSBARiskProfile({
    dealId,
    loanType: (deal as any).loan_type ?? "7a",
    naicsCode: application?.naics ?? null,
    termMonths: null, // Sprint 0: term lives on buddy_sba_packages or equivalents; pass null to let profile treat as medium.
    urbanRural: null as UrbanRuralClassification | null,
    state: null,
    zip: null,
    facts,
    managementYearsInIndustry: null,
    hasBusinessPlan: true,
    sb,
  });

  // ─── Snapshot ─────────────────────────────────────────────────────────
  const snapshot: Record<string, unknown> = {
    dealId,
    bankId: (deal as any).bank_id,
    loanAmount: tryNumber((deal as any).loan_amount),
    naics: application?.naics ?? null,
    industry: application?.industry ?? null,
    businessEntityType: application?.business_entity_type ?? null,
    compositeRiskScore: riskProfile.compositeRiskScore,
    compositeRiskTier: riskProfile.compositeRiskTier,
    industryTier: riskProfile.industryFactor.tier,
    loanTermTier: riskProfile.loanTermFactor.tier,
    hardBlockers: riskProfile.hardBlockers,
    feasibilityComposite: tryNumber(feasibility?.composite_score),
    yearsInBusiness,
    annualRevenueUsd,
    employeeCount,
    collateralNetLendableTotal,
    applicantCount: applicants.length,
    isFranchise,
  };

  return {
    dealId,
    bankId: (deal as any).bank_id,
    loanAmount: tryNumber((deal as any).loan_amount),
    program: (deal as any).loan_type ?? "7a",
    isFranchise,
    riskProfile,
    naics: application?.naics ?? null,
    industry: application?.industry ?? null,
    businessEntityType: application?.business_entity_type ?? null,
    applicants,
    dscrBase: tryNumber(pkg?.dscr_year1_base),
    dscrStress: tryNumber(pkg?.dscr_year1_downside),
    dscrGlobal: tryNumber(pkg?.global_dscr),
    sbaGuarantyPct: tryNumber(pkg?.sba_guarantee_pct),
    sourcesAndUses: pkg?.sources_and_uses ?? null,
    useOfProceeds: Array.isArray(pkg?.use_of_proceeds)
      ? (pkg!.use_of_proceeds as unknown[])
      : null,
    projectionsAnnual: pkg?.projections_annual ?? null,
    collateralNetLendableTotal: collateralNetLendableTotal === 0 ? null : collateralNetLendableTotal,
    equityInjectionAmount,
    totalProjectCost,
    feasibilityComposite: tryNumber(feasibility?.composite_score),
    feasibilityDimensions: {
      marketDemand: tryNumber(feasibility?.market_demand_score),
      financialViability: tryNumber(feasibility?.financial_viability_score),
      operationalReadiness: tryNumber(feasibility?.operational_readiness_score),
      locationSuitability: tryNumber(feasibility?.location_suitability_score),
    },
    yearsInBusiness,
    annualRevenueUsd,
    employeeCount,
    franchise,
    managementTeamSize,
    federalDebtDelinquent,
    taxDelinquent,
    samDebarred,
    felonyConviction,
    incarceratedOrParole,
    priorGovLoanDefault,
    hasAffiliates,
    snapshot,
    missingInputs: missing,
  };
}
