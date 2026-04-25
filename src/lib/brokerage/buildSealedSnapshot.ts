import "server-only";

/**
 * Sprint 5 sealed-snapshot assembler.
 *
 * Loads every relevant deal-state table and produces three outputs:
 *   full          — the immutable jsonb stored on buddy_sealed_packages
 *   forRedactor   — the typed subset that feeds redactForMarketplace
 *   piiContext    — known-bad tokens for the PII scanner backstop
 *
 * Round-5 contract:
 *   - Loan term + amount come from buddy_sba_assumptions.loan_impact
 *     (keys: termMonths, loanAmount), NOT from deals.term_months
 *     (that column does not exist).
 *   - Franchise detection uses buddy_feasibility_studies.is_franchise.
 *     When true, the snapshot's franchise block is a generic placeholder
 *     (brand_name=null, brand_unit_count=null). The redactor's ≥50-unit
 *     gate naturally produces "brand undisclosed" in the KFS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SealedSnapshotInput } from "./redactForMarketplace";
import type { PiiScanContext } from "./piiScanner";

export type SealedSnapshotResult = {
  full: Record<string, unknown>;
  forRedactor: SealedSnapshotInput;
  piiContext: PiiScanContext;
};

export async function buildSealedSnapshot(args: {
  dealId: string;
  sb: SupabaseClient;
}): Promise<SealedSnapshotResult> {
  const { dealId, sb } = args;

  const [
    dealRes,
    scoreRes,
    appRes,
    financialsRes,
    pkgRes,
    feasRes,
    tridentRes,
    borrowerFinRes,
    assumptionsRes,
    conciergeRes,
  ] = await Promise.all([
    sb.from("deals").select("*").eq("id", dealId).single(),
    sb
      .from("buddy_sba_scores")
      .select("*")
      .eq("deal_id", dealId)
      .eq("score_status", "locked")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("borrower_applications")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId),
    sb
      .from("buddy_sba_packages")
      .select("*")
      .eq("deal_id", dealId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("buddy_feasibility_studies")
      .select("*")
      .eq("deal_id", dealId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("buddy_trident_bundles")
      .select("*")
      .eq("deal_id", dealId)
      .eq("mode", "preview")
      .eq("status", "succeeded")
      .is("superseded_at", null)
      .maybeSingle(),
    sb
      .from("borrower_applicant_financials")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle(),
    sb
      .from("buddy_sba_assumptions")
      .select("loan_impact")
      .eq("deal_id", dealId)
      .maybeSingle(),
    sb
      .from("borrower_concierge_sessions")
      .select("confirmed_facts, extracted_facts")
      .eq("deal_id", dealId)
      .maybeSingle(),
  ]);

  const deal = dealRes.data as any;
  const score = scoreRes.data as any;
  const app = appRes.data as any;
  const facts = (financialsRes.data ?? []) as any[];
  const pkg = pkgRes.data as any;
  const feasibility = feasRes.data as any;
  const borrowerFin = borrowerFinRes.data as any;
  const concierge = conciergeRes.data as any;

  // Round-5: term + loan from loan_impact jsonb.
  const loanImpact =
    ((assumptionsRes.data as any)?.loan_impact ?? {}) as Record<
      string,
      unknown
    >;
  const termMonths =
    typeof loanImpact.termMonths === "number"
      ? (loanImpact.termMonths as number)
      : 120;
  const loanAmount =
    typeof loanImpact.loanAmount === "number"
      ? (loanImpact.loanAmount as number)
      : Number(deal?.loan_amount ?? 0);

  // Round-5: franchise resolution via feasibility.is_franchise.
  const isFranchise = feasibility?.is_franchise === true;
  const franchise = isFranchise
    ? {
        brand_id: null,
        brand_name: null,
        brand_category: "Franchise (brand pending)",
        brand_unit_count: null,
        brand_founding_year: null,
      }
    : null;

  const getFact = (key: string): number | null => {
    const row = facts.find((f: any) => f.fact_key === key);
    return row?.fact_value_num != null ? Number(row.fact_value_num) : null;
  };

  const dscrBaseHistorical = getFact("DSCR");
  const dscrBaseProjected = pkg?.dscr_year1_base ?? 0;
  const dscrStressProjected = pkg?.dscr_year1_downside ?? 0;
  const globalCashFlowDscr = pkg?.global_dscr ?? null;

  const forRedactor: SealedSnapshotInput = {
    deal: {
      sba_program: inferProgramFromDeal(deal),
      loan_amount: Number(loanAmount),
      term_months: Number(termMonths),
      state: String(deal?.state ?? ""),
      use_of_proceeds: (pkg?.use_of_proceeds as any[]) ?? [],
      equity_injection_amount: Number(
        pkg?.sources_and_uses?.equityInjection?.amount ?? 0,
      ),
    },
    score: {
      score: score?.score ?? 0,
      band: score?.band ?? "not_eligible",
      rateCardTier: score?.rate_card_tier ?? "widest",
      scoreComponents: {
        borrowerStrength: Number(
          (score?.borrower_strength as any)?.contribution ?? 0,
        ),
        businessStrength: Number(
          (score?.business_strength as any)?.contribution ?? 0,
        ),
        dealStructure: Number((score?.deal_structure as any)?.contribution ?? 0),
        repaymentCapacity: Number(
          (score?.repayment_capacity as any)?.contribution ?? 0,
        ),
        franchiseQuality:
          (score?.franchise_quality as any)?.contribution ?? null,
      },
      eligibility: {
        passed: score?.eligibility_passed ?? false,
        checks: (score?.eligibility_failures as any[]) ?? [],
      },
    },
    borrower: {
      fico_score: borrowerFin?.fico_score ?? null,
      liquid_assets: borrowerFin?.liquid_assets ?? null,
      net_worth: borrowerFin?.net_worth ?? null,
      years_in_operation: getFact("YEARS_IN_BUSINESS"),
      industry_experience_years:
        borrowerFin?.industry_experience_years ?? null,
      industry_naics: String(app?.naics ?? ""),
      industry_description: String(app?.industry ?? ""),
    },
    financials: {
      dscr_base_historical: dscrBaseHistorical,
      dscr_base_projected: Number(dscrBaseProjected),
      dscr_stress_projected: Number(dscrStressProjected),
      global_cash_flow_dscr:
        globalCashFlowDscr != null ? Number(globalCashFlowDscr) : null,
    },
    franchise,
    feasibility: {
      composite_score: feasibility?.composite_score ?? 0,
      market_demand_score: feasibility?.market_demand_score ?? 0,
      location_suitability_score: feasibility?.location_suitability_score ?? 0,
      financial_viability_score: feasibility?.financial_viability_score ?? 0,
      operational_readiness_score:
        feasibility?.operational_readiness_score ?? 0,
    },
    packageManifest: {
      businessPlanPages: 0,
      projectionsPages: 0,
      feasibilityPages: 0,
      formsIncluded: ["1919", "413", "159"],
      sourceDocumentsCount: 0,
    },
  };

  // PII context. Some columns don't exist on this schema (applicant_first_name,
  // deals.zip) — select("*") returns undefined for those, which is fine: the
  // PII scanner skips null/undefined tokens.
  const piiContext: PiiScanContext = {
    borrowerFirstName: app?.applicant_first_name ?? null,
    borrowerLastName: app?.applicant_last_name ?? null,
    businessLegalName: app?.business_legal_name ?? null,
    businessDbaName: app?.business_dba_name ?? null,
    city: deal?.city ?? null,
    zip: deal?.zip ?? null,
  };

  const full: Record<string, unknown> = {
    deal,
    score,
    application: app,
    financialFacts: facts,
    sbaPackage: pkg,
    feasibility,
    tridentPreview: tridentRes.data,
    borrowerFinancials: borrowerFin,
    loanImpact,
    franchise,
    conciergeFacts: {
      confirmed: concierge?.confirmed_facts ?? {},
      extracted: concierge?.extracted_facts ?? {},
    },
    snapshotVersion: "1.0.0",
    snapshottedAt: new Date().toISOString(),
  };

  return { full, forRedactor, piiContext };
}

function inferProgramFromDeal(deal: any): "7a" | "504" | "express" {
  const t = String(deal?.deal_type ?? "").toLowerCase();
  if (t.includes("504")) return "504";
  if (t.includes("express")) return "express";
  return "7a";
}
