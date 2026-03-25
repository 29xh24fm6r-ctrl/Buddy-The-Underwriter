/**
 * Structure status derivation — pure module.
 * Determines the current governance state of a deal's structure.
 */

export type StructureStatus =
  | "working"
  | "selected"
  | "frozen"
  | "approved"
  | "approved_with_exceptions"
  | "approved_with_changes"
  | "declined";

export type StructureStatusInfo = {
  status: StructureStatus;
  label: string;
  frozen_at?: string | null;
  approved_at?: string | null;
  scenario_label?: string | null;
};

export function deriveStructureStatus(args: {
  hasActiveSelection: boolean;
  hasActiveFreeze: boolean;
  latestDecision?: { decision: string; decided_at: string } | null;
  scenarioLabel?: string | null;
  frozenAt?: string | null;
}): StructureStatusInfo {
  const { hasActiveSelection, hasActiveFreeze, latestDecision, scenarioLabel, frozenAt } = args;

  if (latestDecision) {
    const decision = latestDecision.decision as StructureStatus;
    return {
      status: decision,
      label: STATUS_LABELS[decision] ?? decision,
      frozen_at: frozenAt,
      approved_at: latestDecision.decided_at,
      scenario_label: scenarioLabel,
    };
  }

  if (hasActiveFreeze) {
    return {
      status: "frozen",
      label: "Structure Frozen",
      frozen_at: frozenAt,
      scenario_label: scenarioLabel,
    };
  }

  if (hasActiveSelection) {
    return {
      status: "selected",
      label: "Structure Selected",
      scenario_label: scenarioLabel,
    };
  }

  return {
    status: "working",
    label: "Working",
  };
}

const STATUS_LABELS: Record<string, string> = {
  working: "Working",
  selected: "Structure Selected",
  frozen: "Structure Frozen",
  approved: "Approved",
  approved_with_exceptions: "Approved with Exceptions",
  approved_with_changes: "Approved with Changes",
  declined: "Declined",
};

export const STATUS_BADGE_STYLES: Record<string, { cls: string }> = {
  working: { cls: "bg-white/10 text-white/50" },
  selected: { cls: "bg-blue-500/20 text-blue-300" },
  frozen: { cls: "bg-purple-500/20 text-purple-300" },
  approved: { cls: "bg-emerald-500/20 text-emerald-300" },
  approved_with_exceptions: { cls: "bg-amber-500/20 text-amber-300" },
  approved_with_changes: { cls: "bg-yellow-500/20 text-yellow-300" },
  declined: { cls: "bg-rose-500/20 text-rose-300" },
};
