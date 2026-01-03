import type { DealMode } from "./dealMode";

export type DealGuidance = {
  message: string | null;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
};

/**
 * getDealGuidance - Get user-facing guidance for current deal mode
 * 
 * Returns the next action a user should take (if any).
 * Only returns action when user intervention is required.
 * 
 * System convergence states (initializing, processing, ready) = no action needed
 * User action states (needs_input, blocked) = show specific action
 */
export function getDealGuidance(mode: DealMode): DealGuidance {
  switch (mode) {
    case "needs_input":
      return {
        message: "Missing required documents",
        action: { label: "Request Documents" },
      };

    case "blocked":
      return {
        message: "Deal configuration incomplete",
        action: { label: "Fix Issue" },
      };

    case "initializing":
      return {
        message: "System initializing from uploaded documents",
      };

    case "processing":
      return {
        message: "Documents processing — underwriting will unlock automatically",
      };

    case "ready":
      return {
        message: "Deal ready for underwriting",
      };

    default:
      return { message: null };
  }
}
