/**
 * Next Action Helper
 *
 * Determines the next best action for a deal based on its lifecycle state.
 * Used by the cockpit to show actionable CTAs.
 */

import type { LifecycleState, LifecycleStage, LifecycleBlocker } from "./model";

/**
 * Server actions that can be run one-click without navigation.
 */
export type ServerActionType =
  | "generate_snapshot"
  | "generate_packet"
  | "run_ai_classification"
  | "send_reminder";

/**
 * The next action a user should take.
 */
export type NextAction = {
  /** Human-readable label for the button */
  label: string;
  /** Optional href to navigate to after action (fallback if action fails) */
  href?: string;
  /** Intent type for styling/behavior */
  intent: "advance" | "navigate" | "blocked" | "complete" | "runnable";
  /** Whether the action should auto-advance lifecycle */
  shouldAdvance?: boolean;
  /** Description of what will happen */
  description?: string;
  /** Server action to run (for intent="runnable") */
  serverAction?: ServerActionType;
  /** Estimated time for the action */
  estimatedTime?: string;
};

/**
 * Get the next action for a deal based on its lifecycle state.
 *
 * @param state - Current lifecycle state
 * @param dealId - Deal ID for generating URLs
 * @returns NextAction describing what to do next
 */
export function getNextAction(state: LifecycleState, dealId: string): NextAction {
  // Terminal states
  if (state.stage === "closed") {
    return {
      label: "Deal Closed",
      intent: "complete",
      description: "This deal has been successfully closed.",
    };
  }

  if (state.stage === "workout") {
    return {
      label: "Workout in Progress",
      intent: "complete",
      description: "This deal is in workout status.",
    };
  }

  // If there are blockers, show blocked state
  if (state.blockers.length > 0) {
    return {
      label: "Resolve Blockers",
      intent: "blocked",
      description: `${state.blockers.length} issue(s) blocking advancement`,
    };
  }

  // Stage-specific next actions
  switch (state.stage) {
    case "intake_created":
      return {
        label: "Set Up Intake",
        href: `/deals/${dealId}/cockpit?tab=setup`,
        intent: "navigate",
        description: "Configure intake form and seed checklist",
      };

    case "docs_requested":
      return {
        label: "Request Documents",
        href: `/deals/${dealId}/cockpit?tab=portal`,
        intent: "navigate",
        description: "Send document request to borrower",
      };

    case "docs_in_progress":
      return {
        label: "Review Documents",
        href: `/deals/${dealId}/cockpit?focus=documents`,
        intent: "navigate",
        description: "Check document status and follow up on missing items",
      };

    case "docs_satisfied":
      return {
        label: "Set Pricing Assumptions",
        href: `/deals/${dealId}/pricing`,
        intent: "navigate",
        description: "Configure pricing assumptions to unlock underwriting",
      };

    case "underwrite_ready":
      return {
        label: "Start Underwriting",
        href: `/deals/${dealId}/underwrite`,
        intent: "advance",
        shouldAdvance: true,
        description: "Begin underwriting analysis",
      };

    case "underwrite_in_progress":
      return {
        label: "Complete Underwriting",
        href: `/deals/${dealId}/underwrite`,
        intent: "navigate",
        description: "Finish underwriting and prepare for committee",
      };

    case "committee_ready":
      return {
        label: "Review Credit Memo",
        href: `/credit-memo/${dealId}/canonical`,
        intent: "navigate",
        description: "Review auto-populated credit memo, then record decision",
      };

    case "committee_decisioned":
      return {
        label: "Start Closing",
        href: `/deals/${dealId}/closing`,
        intent: "advance",
        shouldAdvance: true,
        description: "Begin closing process",
      };

    case "closing_in_progress":
      return {
        label: "Complete Closing",
        href: `/deals/${dealId}/closing`,
        intent: "navigate",
        description: "Finalize closing documents and fund",
      };

    default:
      return {
        label: "Continue",
        intent: "navigate",
        description: "Proceed with the deal",
      };
  }
}

/**
 * Get a fix action for a specific blocker.
 *
 * @param blocker - The blocker to get a fix for
 * @param dealId - Deal ID for generating URLs
 * @returns Object with label and href for the fix action
 */
export type FixAction =
  | { label: string; href: string; action?: undefined; secondary?: { label: string; action: string } }
  | { label: string; action: string; href?: undefined; secondary?: { label: string; action: string } };

export function getBlockerFixAction(
  blocker: LifecycleBlocker,
  dealId: string
): FixAction | null {
  switch (blocker.code) {
    case "missing_required_docs":
      return {
        label: "View Missing Docs",
        href: `/deals/${dealId}/cockpit?focus=documents`,
        secondary: {
          label: "Send Reminder",
          action: "send_reminder",
        },
      };

    case "checklist_not_seeded":
      return {
        label: "Set Up Intake",
        href: `/deals/${dealId}/cockpit?tab=setup`,
      };

    case "financial_snapshot_missing":
      return {
        label: "Generate Snapshot",
        action: "financial_snapshot.recompute",
      };

    case "committee_packet_missing":
      return {
        label: "Generate Packet",
        href: `/deals/${dealId}/committee/packet`,
      };

    case "decision_missing":
      return {
        label: "Record Decision",
        href: `/deals/${dealId}/decision`,
      };

    case "attestation_missing":
      return {
        label: "Complete Attestations",
        href: `/deals/${dealId}/decision/attestations`,
      };

    case "pricing_quote_missing":
      return {
        label: "Lock Pricing Quote",
        href: `/deals/${dealId}/pricing`,
      };

    case "risk_pricing_not_finalized":
      return {
        label: "Finalize Pricing",
        href: `/deals/${dealId}/pricing`,
      };

    case "closing_docs_missing":
      return {
        label: "Upload Closing Docs",
        href: `/deals/${dealId}/closing`,
      };

    case "loan_request_missing":
      return {
        label: "Add Loan Request",
        href: `/deals/${dealId}/cockpit?tab=setup`,
      };

    case "loan_request_incomplete":
      return {
        label: "Complete Loan Request",
        href: `/deals/${dealId}/cockpit?tab=setup`,
      };

    case "ai_pipeline_incomplete":
      return {
        label: "Run AI Processing",
        action: "ai_pipeline.process",
      };

    case "spreads_incomplete":
      return {
        label: "View Spreads",
        href: `/deals/${dealId}/spreads`,
      };

    case "pricing_assumptions_required":
      return {
        label: "Set Pricing Assumptions",
        href: `/deals/${dealId}/pricing`,
      };

    case "structural_pricing_missing":
      return {
        label: "Set Pricing Assumptions",
        href: `/deals/${dealId}/pricing`,
      };

    // Infrastructure/fetch errors - no direct fix
    case "checklist_fetch_failed":
    case "snapshot_fetch_failed":
    case "decision_fetch_failed":
    case "attestation_fetch_failed":
    case "packet_fetch_failed":
    case "advancement_fetch_failed":
    case "readiness_fetch_failed":
    case "data_fetch_failed":
    case "internal_error":
      return {
        label: "Refresh Page",
        href: `/deals/${dealId}/cockpit`,
      };

    case "deal_not_found":
      return {
        label: "Go to Deals",
        href: "/deals",
      };

    default:
      return null;
  }
}

/**
 * Get the icon for a next action intent.
 */
export function getNextActionIcon(intent: NextAction["intent"]): string {
  switch (intent) {
    case "advance":
      return "arrow_forward";
    case "navigate":
      return "open_in_new";
    case "runnable":
      return "bolt"; // Lightning bolt for one-click actions
    case "blocked":
      return "block";
    case "complete":
      return "check_circle";
    default:
      return "arrow_forward";
  }
}
