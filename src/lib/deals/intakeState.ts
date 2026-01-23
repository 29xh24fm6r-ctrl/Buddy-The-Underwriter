export type DealIntakeState =
  | "CREATED"
  | "UPLOAD_SESSION_READY"
  | "UPLOADING"
  | "UPLOAD_COMPLETE"
  | "INTAKE_RUNNING"
  | "READY_FOR_UNDERWRITE"
  | "FAILED";

const transitions: Record<DealIntakeState, DealIntakeState[]> = {
  CREATED: ["UPLOAD_SESSION_READY", "FAILED"],
  UPLOAD_SESSION_READY: ["UPLOADING", "FAILED"],
  UPLOADING: ["UPLOAD_COMPLETE", "FAILED"],
  UPLOAD_COMPLETE: ["INTAKE_RUNNING", "FAILED"],
  INTAKE_RUNNING: ["READY_FOR_UNDERWRITE", "FAILED"],
  READY_FOR_UNDERWRITE: [],
  FAILED: ["UPLOAD_SESSION_READY"],
};

export function canTransitionIntakeState(from: DealIntakeState, to: DealIntakeState) {
  return transitions[from]?.includes(to) ?? false;
}
