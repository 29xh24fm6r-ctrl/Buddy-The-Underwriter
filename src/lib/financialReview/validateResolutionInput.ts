/**
 * Pure validation for financial review resolution inputs.
 * No server-only — safe for CI guard imports and unit testing.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolutionAction =
  | "confirm_value"
  | "choose_source_value"
  | "override_value"
  | "provide_value"
  | "mark_follow_up";

export type GapType = "missing_fact" | "low_confidence" | "conflict";

export type ResolvedStatus =
  | "resolved_confirmed"
  | "resolved_selected_source"
  | "resolved_overridden"
  | "resolved_provided"
  | "deferred_follow_up";

export type ResolutionInput = {
  gapId: string;
  action: ResolutionAction;
  factId?: string | null;
  conflictId?: string | null;
  resolvedValue?: number | null;
  resolvedPeriodStart?: string | null;
  resolvedPeriodEnd?: string | null;
  rationale?: string | null;
};

export type ValidationError = { field: string; message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Actions allowed per gap type */
const ALLOWED_ACTIONS: Record<GapType, ResolutionAction[]> = {
  low_confidence: ["confirm_value", "override_value", "mark_follow_up"],
  conflict:       ["choose_source_value", "override_value", "mark_follow_up"],
  missing_fact:   ["provide_value", "mark_follow_up"],
};

/** Actions that require rationale */
const RATIONALE_REQUIRED: Set<ResolutionAction> = new Set([
  "override_value",
  "provide_value",
  "mark_follow_up",
]);

/** Generic filler that does not count as real rationale */
const FILLER_RATIONALE = new Set(["ok", "confirmed", "n/a", "na", "same", "fixed", "yes", "no"]);

/** Minimum length for required rationale */
const MIN_RATIONALE_LENGTH = 10;

/** Map action → resolved status */
export const ACTION_TO_STATUS: Record<ResolutionAction, ResolvedStatus> = {
  confirm_value:       "resolved_confirmed",
  choose_source_value: "resolved_selected_source",
  override_value:      "resolved_overridden",
  provide_value:       "resolved_provided",
  mark_follow_up:      "deferred_follow_up",
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isActionAllowed(gapType: GapType, action: ResolutionAction): boolean {
  return (ALLOWED_ACTIONS[gapType] ?? []).includes(action);
}

export function isRationaleRequired(action: ResolutionAction): boolean {
  return RATIONALE_REQUIRED.has(action);
}

function isRationaleQualityOk(rationale: string): boolean {
  const trimmed = rationale.trim();
  if (trimmed.length < MIN_RATIONALE_LENGTH) return false;
  if (FILLER_RATIONALE.has(trimmed.toLowerCase())) return false;
  return true;
}

/**
 * Validate a resolution input against the gap type.
 * Returns an empty array if valid.
 */
export function validateResolutionInput(
  input: ResolutionInput,
  gapType: GapType,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. Action must be allowed for this gap type
  if (!isActionAllowed(gapType, input.action)) {
    errors.push({
      field: "action",
      message: `Action "${input.action}" is not allowed for gap type "${gapType}". Allowed: ${ALLOWED_ACTIONS[gapType]?.join(", ")}`,
    });
    return errors; // no point checking further
  }

  // 2. Rationale
  if (isRationaleRequired(input.action)) {
    const r = (input.rationale ?? "").trim();
    if (!r) {
      errors.push({ field: "rationale", message: "Rationale is required for this action." });
    } else if (!isRationaleQualityOk(r)) {
      errors.push({
        field: "rationale",
        message: `Rationale must be at least ${MIN_RATIONALE_LENGTH} characters and not generic filler.`,
      });
    }
  }

  // 3. Action-specific fields
  if (input.action === "confirm_value" && !input.factId) {
    errors.push({ field: "factId", message: "factId is required for confirm_value." });
  }

  if (input.action === "choose_source_value" && !input.factId) {
    errors.push({ field: "factId", message: "factId is required for choose_source_value." });
  }

  if (input.action === "override_value" && input.resolvedValue == null) {
    errors.push({ field: "resolvedValue", message: "resolvedValue is required for override_value." });
  }

  if (input.action === "provide_value" && input.resolvedValue == null) {
    errors.push({ field: "resolvedValue", message: "resolvedValue is required for provide_value." });
  }

  return errors;
}
