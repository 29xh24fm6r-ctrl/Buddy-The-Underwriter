/**
 * Tuning Registry — Phase 66C, System 6 (pure)
 *
 * Defines tunable domains and their constraints. All domains require
 * approval and are bounded by maximum change percentages.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TunableDomain =
  | "action_ranking"
  | "trust_thresholds"
  | "scenario_order"
  | "warning_suppression"
  | "handoff_priority"
  | "borrower_sequencing"
  | "presentation_order";

export type TuningConstraint = {
  domain: TunableDomain;
  minValue?: number;
  maxValue?: number;
  maxChangePercent: number;
  requiresApproval: boolean;
};

/* ------------------------------------------------------------------ */
/*  Constraints                                                        */
/* ------------------------------------------------------------------ */

export const TUNING_CONSTRAINTS: Record<TunableDomain, TuningConstraint> = {
  action_ranking: {
    domain: "action_ranking",
    minValue: 0,
    maxValue: 100,
    maxChangePercent: 20,
    requiresApproval: true,
  },
  trust_thresholds: {
    domain: "trust_thresholds",
    minValue: 0,
    maxValue: 1,
    maxChangePercent: 10,
    requiresApproval: true,
  },
  scenario_order: {
    domain: "scenario_order",
    minValue: 0,
    maxValue: 100,
    maxChangePercent: 20,
    requiresApproval: true,
  },
  warning_suppression: {
    domain: "warning_suppression",
    minValue: 0,
    maxValue: 1,
    maxChangePercent: 10,
    requiresApproval: true,
  },
  handoff_priority: {
    domain: "handoff_priority",
    minValue: 0,
    maxValue: 100,
    maxChangePercent: 20,
    requiresApproval: true,
  },
  borrower_sequencing: {
    domain: "borrower_sequencing",
    minValue: 0,
    maxValue: 100,
    maxChangePercent: 20,
    requiresApproval: true,
  },
  presentation_order: {
    domain: "presentation_order",
    minValue: 0,
    maxValue: 100,
    maxChangePercent: 20,
    requiresApproval: true,
  },
};

/* ------------------------------------------------------------------ */
/*  getDomainConstraints                                               */
/* ------------------------------------------------------------------ */

export function getDomainConstraints(domain: TunableDomain): TuningConstraint {
  return TUNING_CONSTRAINTS[domain];
}
