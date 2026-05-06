"use client";

import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { useRegisterStageRefresher } from "../_shared/useStageDataRefresh";
import { StatusListPanel, type StatusRow } from "../_shared/StatusListPanel";

/**
 * SPEC-06 — stage-owned risk summary surface.
 *
 * Reads risk-relevant signals from the cockpit's lifecycleState.derived
 * (no extra fetch — already polled by useCockpitData) and exposes a single
 * inline summary. Registers a no-op refresher under scope: "underwriting"
 * so a successful underwriting action ticks refreshSeq for the surface.
 *
 * The deep workbench remains on /deals/[dealId]/underwrite + /risk.
 */
export function RiskSummarySurface({ dealId }: { dealId: string }) {
  const { lifecycleState } = useCockpitDataContext();
  const derived = lifecycleState?.derived;

  // Register an underwriting-scoped no-op so this surface is included in
  // refreshStageData("underwriting") even though its data comes from the
  // cockpit context (not a stage-owned fetch). Tying the refresh path
  // makes the SPEC-06 V2 invariant ("doesn't rely solely on remount") true.
  useRegisterStageRefresher("underwriting", "underwriting:risk-summary", () => {});

  const criticalFlagsResolved = derived?.criticalFlagsResolved ?? null;
  const riskPricingFinalized = derived?.riskPricingFinalized ?? null;
  const financialValidationOpen =
    derived?.financialSnapshotOpenReviewCount ?? 0;

  const rows: StatusRow[] = [
    {
      id: "critical-flags",
      label: "Critical risk flags",
      detail:
        criticalFlagsResolved === null
          ? "Status unavailable."
          : criticalFlagsResolved
            ? "All critical flags resolved."
            : "Unresolved critical flags exist.",
      tone: criticalFlagsResolved ? "success" : "warn",
      badge: criticalFlagsResolved ? "RESOLVED" : "OPEN",
    },
    {
      id: "risk-pricing",
      label: "Risk-based pricing",
      detail: riskPricingFinalized
        ? "Pricing is finalized."
        : "Pricing has not been finalized.",
      tone: riskPricingFinalized ? "success" : "warn",
      badge: riskPricingFinalized ? "FINAL" : "PENDING",
    },
    {
      id: "financial-validation",
      label: "Financial validation",
      detail:
        financialValidationOpen === 0
          ? "No open validation items."
          : `${financialValidationOpen} item(s) open for review.`,
      tone: financialValidationOpen === 0 ? "success" : "warn",
      badge:
        financialValidationOpen === 0
          ? "CLEAR"
          : `${financialValidationOpen} OPEN`,
    },
  ];

  return (
    <StatusListPanel
      testId="underwriting-risk-summary-surface"
      title="Risk Summary"
      icon="warning_amber"
      summary="Snapshot of risk and pricing finalization signals from the lifecycle context."
      rows={rows}
      links={[
        { label: "Risk", href: `/deals/${dealId}/risk` },
        { label: "Underwrite", href: `/deals/${dealId}/underwrite` },
      ]}
    />
  );
}
