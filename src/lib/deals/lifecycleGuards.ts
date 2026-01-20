export type DealLifecycleStage =
  | "created"
  | "intake"
  | "collecting"
  | "underwriting"
  | "ready";

export function isBorrowerUploadAllowed(stage?: string | null) {
  return stage === "intake" || stage === "collecting";
}

export function canAccessUnderwrite(stage?: string | null) {
  return stage === "underwriting" || stage === "ready";
}

export type UnderwriteStartGate = {
  allowed: boolean;
  blockers: string[];
  reason:
    | "ok"
    | "auth_required"
    | "verify_failed"
    | "lifecycle_blocked"
    | "test_mode";
};

export function buildUnderwriteStartGate(params: {
  lifecycleStage?: string | null;
  verifyOk?: boolean;
  authOk?: boolean;
  testMode?: boolean;
}): UnderwriteStartGate {
  const { lifecycleStage, verifyOk = false, authOk = true, testMode = false } = params;
  const blockers: string[] = [];

  if (!authOk) {
    blockers.push("Authentication required to start underwriting.");
  }

  if (testMode) {
    blockers.push("Banker test mode blocks underwriting.");
  }

  if (!canAccessUnderwrite(lifecycleStage)) {
    blockers.push("Deal lifecycle not ready for underwriting.");
  }

  if (!verifyOk) {
    blockers.push("Underwrite verification has not passed.");
  }

  let reason: UnderwriteStartGate["reason"] = "ok";
  if (testMode) reason = "test_mode";
  else if (!authOk) reason = "auth_required";
  else if (!canAccessUnderwrite(lifecycleStage)) reason = "lifecycle_blocked";
  else if (!verifyOk) reason = "verify_failed";

  return {
    allowed: blockers.length === 0,
    blockers,
    reason,
  };
}
