/**
 * Phase 57 — Closing Execution State Derivation
 *
 * Pure function. Derives execution status from recipient + condition state.
 */

type RecipientState = { required: boolean; actionType: string; status: string };
type ConditionState = { required: boolean; status: string };

type ExecutionInput = {
  recipients: RecipientState[];
  conditions: ConditionState[];
  currentStatus: string;
  isCancelled: boolean;
  isSuperseded: boolean;
};

export type DerivedExecutionState = {
  status: string;
  readyToSend: boolean;
  fullySigned: boolean;
  executionComplete: boolean;
  signaturesRemaining: number;
  conditionsRemaining: number;
  executionPct: number;
};

/**
 * Derive closing execution state from recipients and conditions.
 */
export function deriveClosingExecutionState(input: ExecutionInput): DerivedExecutionState {
  if (input.isCancelled) return makeState("cancelled", input);
  if (input.isSuperseded) return makeState("superseded", input);

  const requiredSigners = input.recipients.filter((r) => r.required && r.actionType === "sign");
  const signed = requiredSigners.filter((r) => r.status === "signed" || r.status === "completed");
  const signaturesRemaining = requiredSigners.length - signed.length;

  const requiredConditions = input.conditions.filter((c) => c.required);
  const satisfied = requiredConditions.filter((c) => c.status === "satisfied" || c.status === "waived");
  const conditionsRemaining = requiredConditions.length - satisfied.length;

  const fullySigned = requiredSigners.length > 0 && signaturesRemaining === 0;
  const allConditionsMet = conditionsRemaining === 0;
  const executionComplete = fullySigned && allConditionsMet;

  const sent = input.recipients.some((r) => r.status !== "pending");
  const readyToSend = input.recipients.length > 0 && requiredSigners.length > 0;

  // Determine status
  let status: string;
  if (executionComplete) {
    status = "execution_complete";
  } else if (fullySigned && !allConditionsMet) {
    status = "conditions_pending"; // Note: "fully_signed" state is subsumed — signatures done but conditions remain
  } else if (fullySigned && allConditionsMet) {
    status = "execution_complete";
  } else if (signaturesRemaining === 0 && requiredSigners.length === 0) {
    status = readyToSend ? "ready_to_send" : "draft";
  } else if (signed.length > 0 && signaturesRemaining > 0) {
    status = "partially_signed";
  } else if (sent) {
    status = "sent";
  } else if (readyToSend) {
    status = "ready_to_send";
  } else {
    status = "draft";
  }

  const totalItems = requiredSigners.length + requiredConditions.length;
  const completedItems = signed.length + satisfied.length;
  const executionPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return { status, readyToSend, fullySigned, executionComplete, signaturesRemaining, conditionsRemaining, executionPct };
}

function makeState(status: string, input: ExecutionInput): DerivedExecutionState {
  return { status, readyToSend: false, fullySigned: false, executionComplete: false, signaturesRemaining: 0, conditionsRemaining: 0, executionPct: 0 };
}
