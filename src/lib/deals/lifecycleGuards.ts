export type DealLifecycleStage =
  | "created"
  | "intake"
  | "collecting"
  | "underwriting"
  | "ready";

export function isBorrowerUploadAllowed(stage?: string | null) {
  return !!stage && stage !== "created";
}

export function canAccessUnderwrite(stage?: string | null) {
  return stage === "underwriting" || stage === "ready";
}
