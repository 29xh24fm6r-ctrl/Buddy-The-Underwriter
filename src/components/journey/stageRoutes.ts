import type { LifecycleStage } from "@/buddy/lifecycle/model";

/**
 * Returns the canonical route for a given lifecycle stage.
 *
 * Routes verified to exist (PIV 2026-05-05):
 *  - /deals/[dealId]/cockpit
 *  - /deals/[dealId]/underwrite
 *  - /deals/[dealId]/committee-studio
 *  - /deals/[dealId]/decision
 *  - /deals/[dealId]/post-close
 *  - /deals/[dealId]/special-assets
 *
 * Unknown stages fall back to the cockpit.
 */
export function stageCanonicalRoute(stage: LifecycleStage, dealId: string): string {
  switch (stage) {
    case "intake_created":
    case "docs_requested":
    case "docs_in_progress":
    case "docs_satisfied":
      return `/deals/${dealId}/cockpit`;

    case "memo_inputs_required":
      return `/deals/${dealId}/memo-inputs`;

    case "underwrite_ready":
    case "underwrite_in_progress":
      return `/deals/${dealId}/underwrite`;

    case "committee_ready":
      return `/deals/${dealId}/committee-studio`;

    case "committee_decisioned":
      return `/deals/${dealId}/decision`;

    case "closing_in_progress":
    case "closed":
      return `/deals/${dealId}/post-close`;

    case "workout":
      return `/deals/${dealId}/special-assets`;

    default:
      return `/deals/${dealId}/cockpit`;
  }
}
