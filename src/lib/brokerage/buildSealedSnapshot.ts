import "server-only";

/** Assemble the handoff from the certified final bundle and its frozen financial authority. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SealedSnapshotInput } from "./redactForMarketplace";
import type { PiiScanContext } from "./piiScanner";
import { loadPackageFinancialSnapshot, PACKAGE_FINANCIAL_VERSION } from "@/lib/modelEngine/packageFinancialSnapshot";
import { deterministicHash } from "@/lib/modelEngine/hashing";
import { assertTridentInputSnapshot } from "./trident/tridentInputSnapshot";
import { forecastCoverage } from "@/lib/sba/forecastCoverage";

export type TridentDistributionBinding = {
  bundleId: string;
  inputHash: string;
  memoInputHash: string;
  creditMemoId: string;
  spreadId: string;
  releaseGate: Record<string, unknown>;
  artifacts: {
    businessPlan: string;
    projectionsXlsx: string;
    feasibility: string;
  };
};

/**
 * The sealed-package artifact columns, derived from one certified final
 * bundle. Single source of truth for what the seal route persists, so the
 * columns can never drift from what `packageDelivery` reads back out:
 * `final_projections_path` holds the XLSX workbook, because final mode
 * produces no projections PDF (the redacted summary PDF is preview-only).
 */
export function sealedPackageArtifactColumns(
  binding: TridentDistributionBinding,
): {
  final_business_plan_path: string;
  final_projections_path: string;
  final_feasibility_path: string;
} {
  return {
    final_business_plan_path: binding.artifacts.businessPlan,
    final_projections_path: binding.artifacts.projectionsXlsx,
    final_feasibility_path: binding.artifacts.feasibility,
  };
}

export type SealedSnapshotResult = {
  full: Record<string, unknown>;
  forRedactor: SealedSnapshotInput;
  piiContext: PiiScanContext;
  distributionBinding: TridentDistributionBinding;
};

/**
 * Thrown when the snapshot cannot be assembled without fabricating a
 * business-critical value (loan term / amount). The seal route maps this to a
 * 400 not_sealable rather than sealing a listing with made-up terms (audit L2).
 */
export class SealSnapshotError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`seal_snapshot_${reason}`);
    this.name = "SealSnapshotError";
    this.reason = reason;
  }
}

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
    tridentRes,
    primaryOwnerRes,
    conciergeRes,
  ] = await Promise.all([
    sb.from("deals").select("*").eq("id", dealId).single(),
    sb
      .from("buddy_sba_scores")
      .select("*")
      .eq("deal_id", dealId)
      .eq("score_status", "locked")
      .is("superseded_at", null)
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
      .from("buddy_trident_bundles")
      .select("*")
      .eq("deal_id", dealId)
      .eq("mode", "final")
      .eq("status", "succeeded")
      .is("superseded_at", null)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // borrower_applicant_financials has no deal_id column — it's keyed by
    // applicant_id (an ownership_entities.id), one row per owner, not one
    // per deal. Resolve the primary individual owner here so the financials
    // lookup below can join through it correctly (found via a live-schema
    // check: the old .eq("deal_id", dealId) filter referenced a column that
    // does not exist, so it silently produced a PostgREST error and every
    // sealed snapshot's fico_score/liquid_assets/net_worth came back null).
    sb
      .from("ownership_entities")
      .select("id, ownership_pct")
      .eq("deal_id", dealId)
      .in("entity_type", ["individual", "person"])
      .order("ownership_pct", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("borrower_concierge_sessions")
      .select("confirmed_facts, extracted_facts")
      .eq("deal_id", dealId)
      .maybeSingle(),
  ]);

  if ([dealRes, scoreRes, appRes, financialsRes, tridentRes, primaryOwnerRes, conciergeRes].some(result => result.error)) {
    throw new SealSnapshotError("source_state_unavailable");
  }
  const deal = dealRes.data as any;
  const score = scoreRes.data as any;
  const app = appRes.data as any;
  const facts = (financialsRes.data ?? []) as any[];
  const concierge = conciergeRes.data as any;
  const trident = tridentRes.data as any;

  if (
    !deal?.bank_id || !score || !trident ||
    trident.bank_id !== deal.bank_id ||
    !trident.source_sba_package_id || !trident.source_feasibility_id || !trident.financial_snapshot_id ||
    trident.release_gate_json?.ok !== true ||
    !trident.input_hash ||
    !trident.memo_input_hash ||
    trident.canonical_memo_input_hash !== trident.memo_input_hash ||
    !trident.source_credit_memo_id ||
    !trident.source_spread_id ||
    !trident.business_plan_pdf_path ||
    !trident.projections_xlsx_path ||
    !trident.feasibility_pdf_path
  ) {
    throw new SealSnapshotError("final_trident_not_release_ready");
  }

  const [pkgRes, feasRes] = await Promise.all([
    // Package tenancy is inherited through deal_id; this table has no bank_id column.
    sb.from("buddy_sba_packages").select("*").eq("id", trident.source_sba_package_id).eq("deal_id", dealId).single(),
    sb.from("buddy_feasibility_studies").select("*").eq("id", trident.source_feasibility_id).eq("deal_id", dealId).eq("bank_id", deal.bank_id).single(),
  ]);
  const pkg = pkgRes.data;
  const feasibility = feasRes.data;
  if (pkgRes.error || feasRes.error || !pkg || !feasibility ||
      pkg.financial_snapshot_id !== trident.financial_snapshot_id || feasibility.projections_package_id !== pkg.id) {
    throw new SealSnapshotError("final_source_binding_invalid");
  }
  let financialSnapshot;
  try {
    financialSnapshot = await loadPackageFinancialSnapshot({ sb, dealId, bankId: deal.bank_id, snapshotId: trident.financial_snapshot_id });
    if (financialSnapshot.inputHash !== deterministicHash({ inputHash: trident.input_hash, version: PACKAGE_FINANCIAL_VERSION })) {
      throw new Error("financial_input_binding_invalid");
    }
    await assertTridentInputSnapshot({ sb, dealId, expectedHash: trident.input_hash, expectedManifest: trident.snapshot_manifest_json });
  } catch {
    throw new SealSnapshotError("final_financial_evidence_unavailable_or_stale");
  }
  const financialOutput = financialSnapshot.output;

  const distributionBinding: TridentDistributionBinding = {
    bundleId: String(trident.id),
    inputHash: String(trident.input_hash),
    memoInputHash: String(trident.memo_input_hash),
    creditMemoId: String(trident.source_credit_memo_id),
    spreadId: String(trident.source_spread_id),
    releaseGate: trident.release_gate_json as Record<string, unknown>,
    artifacts: {
      businessPlan: String(trident.business_plan_pdf_path),
      projectionsXlsx: String(trident.projections_xlsx_path),
      feasibility: String(trident.feasibility_pdf_path),
    },
  };

  const primaryOwnerId = (primaryOwnerRes.data as { id?: string } | null)?.id ?? null;
  const { data: borrowerFinData, error: borrowerFinError } = primaryOwnerId
    ? await sb.from("borrower_applicant_financials").select("*").eq("applicant_id", primaryOwnerId).maybeSingle()
    : { data: null, error: null };
  if (borrowerFinError) throw new SealSnapshotError("borrower_financial_state_unavailable");
  const borrowerFin = borrowerFinData as any;

  const loanImpact = financialOutput.assumptions.loanImpact;
  const { loanAmount, termMonths } = loanImpact;
  if (!Number.isFinite(termMonths) || termMonths <= 0) throw new SealSnapshotError("missing_loan_term");
  if (!Number.isFinite(loanAmount) || loanAmount <= 0) throw new SealSnapshotError("missing_loan_amount");
  const funding = financialOutput.sourcesAndUses;
  if (!Number.isFinite(funding?.totalUses) || funding.totalUses <= 0 ||
      !Number.isFinite(funding.equityInjection?.actualAmount) || funding.equityInjection.actualAmount < 0) {
    throw new SealSnapshotError("funding_evidence_incomplete");
  }
  const basePath = [financialOutput.dscrYear1Base, financialOutput.dscrYear2Base, financialOutput.dscrYear3Base];
  const downside = financialOutput.projectionModel.sensitivityScenarios.find(scenario => scenario.name === "downside");
  const downsidePath = [downside?.dscrYear1, downside?.dscrYear2, downside?.dscrYear3];
  const threshold = financialOutput.projectedDscrThreshold;
  if (!Number.isFinite(threshold) || threshold <= 0 ||
      !forecastCoverage(basePath, threshold).complete || !forecastCoverage(downsidePath, threshold).complete) {
    throw new SealSnapshotError("forecast_evidence_incomplete");
  }

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
  const dscrBaseProjected = basePath[0];
  const dscrStressProjected = downsidePath[0];
  const globalCashFlowDscr = financialOutput.globalCashFlow.globalDSCR;

  // The borrower's saved business location is part of the verified admission
  // manifest; deals.state is nullable on the borrower-led intake path.
  const borrower = trident.snapshot_manifest_json?.sources?.formInputs?.borrower;
  const state = String(borrower?.project_address_state || deal.state || borrower?.state || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new SealSnapshotError("project_state_required");
  const naics = String(app?.naics || borrower?.naics_code || "");
  const forRedactor: SealedSnapshotInput = {
    deal: {
      sba_program: inferProgramFromDeal(deal),
      loan_amount: Number(loanAmount),
      term_months: Number(termMonths),
      state,
      use_of_proceeds: financialOutput.useOfProceeds,
      equity_injection_amount: funding.equityInjection.actualAmount,
      total_project_cost: funding.totalUses,
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
      industry_naics: naics,
      industry_description: String(app?.industry || borrower?.naics_description || (naics ? `NAICS ${naics}` : "industry not specified")),
    },
    financials: {
      forecastCoverage: { base: basePath, downside: downsidePath as number[], threshold },
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
    tridentFinal: distributionBinding,
    financialSnapshot,
    borrowerFinancials: borrowerFin,
    loanImpact,
    franchise,
    conciergeFacts: {
      confirmed: concierge?.confirmed_facts ?? {},
      extracted: concierge?.extracted_facts ?? {},
    },
    snapshotVersion: "3.0.0",
    snapshottedAt: new Date().toISOString(),
  };

  return { full, forRedactor, piiContext, distributionBinding };
}

function inferProgramFromDeal(deal: any): "7a" | "504" | "express" {
  const t = String(deal?.deal_type ?? "").toLowerCase();
  if (t.includes("504")) return "504";
  if (t.includes("express")) return "express";
  return "7a";
}
