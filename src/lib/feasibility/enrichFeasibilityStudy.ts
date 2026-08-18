import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — post-hoc enrichment of an already-persisted
 * feasibility study: citation attribution + verifier pass. Called AFTER
 * feasibilityEngine.ts's generateFeasibilityStudy has already inserted the
 * buddy_feasibility_studies row — this only ever UPDATEs that same row,
 * feasibilityEngine.ts itself is untouched. Best-effort by design: the
 * caller (the generate route) must treat a failure here as non-fatal,
 * since the study itself already generated successfully.
 */

import { loadDealGroundingSegments, attributeFeasibilityCitations, flagUncitedFeasibilityFields } from "./feasibilityCitations";
import { finishInstitutionalArtifact } from "@/lib/ai/frontierArtifactFactory";
import { persistArtifactFlags } from "@/lib/ai/artifactVerification";
import type { CompositeFeasibilityScore, FeasibilityNarratives } from "./types";

type SB = { from: (t: string) => any };

type JsonRecord = Record<string, any>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function pick(value: unknown, keys: string[]): JsonRecord | null {
  const source = record(value);
  if (!source) return null;
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  );
}

function pickRows(value: unknown, keys: string[]): JsonRecord[] {
  return Array.isArray(value)
    ? value.flatMap((row) => {
        const selected = pick(row, keys);
        return selected ? [selected] : [];
      })
    : [];
}

function compactDimension(value: unknown): JsonRecord | null {
  const source = record(value);
  if (!source) return null;
  const components = Object.fromEntries(
    Object.entries(source).flatMap(([key, candidate]) => {
      const component = record(candidate);
      if (!component || typeof component.score !== "number") return [];
      return [[
        key,
        pick(component, ["score", "detail", "dataAvailable", "dataSource"]),
      ]];
    }),
  );
  return {
    ...pick(source, ["overallScore", "dataCompleteness", "flags"]),
    components,
  };
}

export async function enrichFeasibilityStudy(args: {
  dealId: string;
  bankId: string;
  studyId: string;
  composite: CompositeFeasibilityScore;
  sb: SB;
}): Promise<void> {
  const { dealId, bankId, studyId, composite, sb } = args;

  const { data: studyRow } = await sb
    .from("buddy_feasibility_studies")
    .select(
      "narratives, projections_package_id, market_demand_detail, financial_viability_detail, operational_readiness_detail, location_suitability_detail, flags, data_completeness",
    )
    .eq("id", studyId)
    .maybeSingle();

  const narratives = (studyRow?.narratives ?? null) as FeasibilityNarratives | null;
  if (!narratives) return;

  const { segments, allUrls } = await loadDealGroundingSegments(dealId, sb);
  const citations = attributeFeasibilityCitations(narratives, segments, allUrls);
  await flagUncitedFeasibilityFields({ dealId, bankId, studyId, citations, sb });

  const sections = Object.entries(narratives).flatMap(([key, text]) =>
    typeof text === "string" && text.trim() ? [{ key, text }] : [],
  );
  // The institutional reviewer must receive the same deterministic evidence
  // that produced the study. Supplying only summary scores causes the repair
  // model to delete valid borrower-specific facts as "unsupported."
  const projectionsPackageId =
    typeof studyRow?.projections_package_id === "string"
      ? studyRow.projections_package_id
      : null;
  const { data: projectionPackage } = projectionsPackageId
    ? await sb
        .from("buddy_sba_packages")
        .select(
          "id, deal_id, assumptions_id, base_year_data, projections_annual, break_even, sensitivity_scenarios, sources_and_uses, global_cash_flow, balance_sheet_projections",
        )
        .eq("id", projectionsPackageId)
        .eq("deal_id", dealId)
        .maybeSingle()
    : { data: null };
  const assumptionsId =
    typeof projectionPackage?.assumptions_id === "string"
      ? projectionPackage.assumptions_id
      : null;
  const { data: confirmedAssumptions } = assumptionsId
    ? await sb
        .from("buddy_sba_assumptions")
        .select(
          "id, deal_id, status, confirmed_at, revenue_streams, cost_assumptions, working_capital, loan_impact, management_team",
        )
        .eq("id", assumptionsId)
        .eq("deal_id", dealId)
        .maybeSingle()
    : { data: null };

  const facts = {
    composite: {
      overallScore: composite.overallScore,
      recommendation: composite.recommendation,
      confidenceLevel: composite.confidenceLevel,
      marketDemandScore: composite.marketDemand.score,
      financialViabilityScore: composite.financialViability.score,
      operationalReadinessScore: composite.operationalReadiness.score,
      locationSuitabilityScore: composite.locationSuitability.score,
      criticalFlags: composite.criticalFlags,
      warningFlags: composite.warningFlags,
      dimensionsMissingData: composite.dimensionsMissingData,
      dataCompleteness: studyRow?.data_completeness ?? composite.overallDataCompleteness,
      allFlags: studyRow?.flags ?? composite.allFlags,
    },
    deterministicStudy: {
      marketDemand: compactDimension(studyRow?.market_demand_detail),
      financialViability: compactDimension(
        studyRow?.financial_viability_detail,
      ),
      operationalReadiness: compactDimension(
        studyRow?.operational_readiness_detail,
      ),
      locationSuitability: compactDimension(
        studyRow?.location_suitability_detail,
      ),
    },
    projectionPackage: projectionPackage
      ? {
          id: projectionPackage.id,
          assumptionsId: projectionPackage.assumptions_id,
          baseYear: pick(projectionPackage.base_year_data, [
            "year", "revenue", "cogs", "grossProfit", "operatingExpenses",
            "ebitda", "totalDebtService", "dscr",
          ]),
          annualProjections: pickRows(projectionPackage.projections_annual, [
            "year", "revenue", "revenueGrowthPct", "cogs", "grossProfit",
            "grossMarginPct", "operatingExpenses", "ebitda",
            "totalDebtService", "dscr",
          ]),
          breakEven: pick(projectionPackage.break_even, [
            "breakEvenRevenue", "projectedRevenueYear1",
            "marginOfSafetyPct", "fixedCostsAnnual",
            "contributionMarginPct", "flagLowMargin",
          ]),
          sensitivityScenarios: pickRows(
            projectionPackage.sensitivity_scenarios,
            [
              "name", "label", "revenueYear1", "ebitdaMarginYear1",
              "dscrYear1", "dscrYear2", "dscrYear3",
              "revenueGrowthAdjustment", "cogsAdjustment",
              "passesSBAThreshold",
            ],
          ),
          sourcesAndUses: projectionPackage.sources_and_uses,
          globalCashFlow: pick(projectionPackage.global_cash_flow, [
            "globalDSCR", "globalCashAvailable", "globalDebtService",
            "businessEbitda", "businessDebtService",
            "totalPersonalIncome", "totalPersonalObligations",
            "totalNetPersonalCash", "guarantorsWithNegativeCashFlow",
          ]),
          balanceSheetProjections: pickRows(
            projectionPackage.balance_sheet_projections,
            [
              "year", "cash", "workingCapital", "currentRatio",
              "debtToEquity", "totalAssets", "totalLiabilities",
              "totalEquity", "longTermDebt",
            ],
          ),
        }
      : null,
    borrowerConfirmedAssumptions: confirmedAssumptions
      ? {
          id: confirmedAssumptions.id,
          status: confirmedAssumptions.status,
          confirmedAt: confirmedAssumptions.confirmed_at,
          revenueStreams: pickRows(confirmedAssumptions.revenue_streams, [
            "name", "pricingModel", "baseAnnualRevenue",
            "growthRateYear1", "growthRateYear2", "growthRateYear3",
          ]),
          costAssumptions: {
            ...pick(confirmedAssumptions.cost_assumptions, [
              "cogsPercentYear1", "cogsPercentYear2", "cogsPercentYear3",
            ]),
            fixedCostCategories: pickRows(
              confirmedAssumptions.cost_assumptions?.fixedCostCategories,
              ["name", "annualAmount", "escalationPctPerYear"],
            ),
            plannedHires: pickRows(
              confirmedAssumptions.cost_assumptions?.plannedHires,
              ["role", "startMonth", "annualSalary"],
            ),
            plannedCapex: pickRows(
              confirmedAssumptions.cost_assumptions?.plannedCapex,
              ["year", "amount", "description"],
            ),
          },
          workingCapital: pick(confirmedAssumptions.working_capital, [
            "targetDSO", "targetDPO", "inventoryTurns",
          ]),
          loanImpact: pick(confirmedAssumptions.loan_impact, [
            "loanAmount", "termMonths", "interestRate",
            "equityInjectionAmount", "equityInjectionSource",
            "sellerFinancingAmount", "existingDebt",
            "revenueImpactPct", "revenueImpactStartMonth",
            "revenueImpactDescription",
          ]),
          managementTeam: pickRows(confirmedAssumptions.management_team, [
            "name", "title", "ownershipPct", "yearsInIndustry", "bio",
          ]),
        }
      : null,
  };
  const finished = await finishInstitutionalArtifact({
    artifactType: "feasibility", facts, sections, dealId, npiTagged: true,
  });
  await persistArtifactFlags({
    dealId, bankId, artifactType: "feasibility", sectionKey: "narratives",
    flaggedClaims: finished.flaggedClaims, sb,
  });
  const repairedNarratives = Object.fromEntries(
    finished.sections.map((section) => [section.key, section.text]),
  ) as unknown as FeasibilityNarratives;

  await sb
    .from("buddy_feasibility_studies")
    .update({
      narrative_citations: citations,
      narratives: repairedNarratives,
      verification_verdict: finished.verdict,
      verification_flagged_claims: finished.flaggedClaims,
    })
    .eq("id", studyId);
}
