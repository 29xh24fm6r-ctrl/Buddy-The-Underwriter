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
          "id, deal_id, assumptions_id, base_year_data, projections_annual, projections_monthly, break_even, sensitivity_scenarios, sources_and_uses, global_cash_flow, balance_sheet_projections, projections_assumptions_narrative",
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
      marketDemand: studyRow?.market_demand_detail ?? null,
      financialViability: studyRow?.financial_viability_detail ?? null,
      operationalReadiness: studyRow?.operational_readiness_detail ?? null,
      locationSuitability: studyRow?.location_suitability_detail ?? null,
    },
    projectionPackage: projectionPackage
      ? {
          id: projectionPackage.id,
          assumptionsId: projectionPackage.assumptions_id,
          baseYear: projectionPackage.base_year_data,
          annualProjections: projectionPackage.projections_annual,
          monthlyProjections: projectionPackage.projections_monthly,
          breakEven: projectionPackage.break_even,
          sensitivityScenarios: projectionPackage.sensitivity_scenarios,
          sourcesAndUses: projectionPackage.sources_and_uses,
          globalCashFlow: projectionPackage.global_cash_flow,
          balanceSheetProjections: projectionPackage.balance_sheet_projections,
          assumptionsNarrative:
            projectionPackage.projections_assumptions_narrative,
        }
      : null,
    borrowerConfirmedAssumptions: confirmedAssumptions
      ? {
          id: confirmedAssumptions.id,
          status: confirmedAssumptions.status,
          confirmedAt: confirmedAssumptions.confirmed_at,
          revenueStreams: confirmedAssumptions.revenue_streams,
          costAssumptions: confirmedAssumptions.cost_assumptions,
          workingCapital: confirmedAssumptions.working_capital,
          loanImpact: confirmedAssumptions.loan_impact,
          managementTeam: confirmedAssumptions.management_team,
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
