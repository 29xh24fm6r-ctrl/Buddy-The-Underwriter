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
    | "test_mode"
    | "omega_block";
  omega_confidence?: {
    available: boolean;
    confidence?: number;
    recommendation?: "proceed" | "clarify" | "block";
  };
};

export function buildUnderwriteStartGate(params: {
  lifecycleStage?: string | null;
  verifyOk?: boolean;
  authOk?: boolean;
  testMode?: boolean;
  omegaConfidence?: {
    ok: boolean;
    confidence?: number;
    recommendation?: "proceed" | "clarify" | "block";
  };
}): UnderwriteStartGate {
  const { lifecycleStage, verifyOk = false, authOk = true, testMode = false, omegaConfidence } = params;
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

  // --- Omega confidence gating ---
  // Rule: Buddy enforces. Omega decides.
  // If Omega is available and recommends "block", add a blocker.
  // If Omega is unavailable, fall back to existing local behavior.
  if (omegaConfidence?.ok && omegaConfidence.recommendation === "block") {
    blockers.push("Omega confidence assessment recommends blocking progression.");
  }

  let reason: UnderwriteStartGate["reason"] = "ok";
  if (testMode) reason = "test_mode";
  else if (!authOk) reason = "auth_required";
  else if (!canAccessUnderwrite(lifecycleStage)) reason = "lifecycle_blocked";
  else if (!verifyOk) reason = "verify_failed";
  else if (omegaConfidence?.ok && omegaConfidence.recommendation === "block") reason = "omega_block";

  return {
    allowed: blockers.length === 0,
    blockers,
    reason,
    omega_confidence: omegaConfidence ? {
      available: omegaConfidence.ok,
      confidence: omegaConfidence.confidence,
      recommendation: omegaConfidence.recommendation,
    } : undefined,
  };
}
