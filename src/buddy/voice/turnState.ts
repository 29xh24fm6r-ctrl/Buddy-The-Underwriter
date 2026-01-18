export type VoiceTurnPhase = "acknowledge" | "orient" | "respond" | "refine";

export interface VoiceTurnPlan {
  immediateUtterance: string;
  followUpUtterance?: string;
}
