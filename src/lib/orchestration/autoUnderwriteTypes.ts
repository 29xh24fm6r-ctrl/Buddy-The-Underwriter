// Phase 68 — Autonomous Deal Orchestration Types

export type AutoUnderwriteStep =
  | "recompute_document_state"
  | "extraction"
  | "financial_snapshot"
  | "model_engine_v2"
  | "sba_package"
  | "omega_advisory"
  | "credit_memo"
  | "narratives"
  | "voice_summary";

export type AutoUnderwriteStepStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "skipped";

export type AutoUnderwriteResult = {
  dealId: string;
  status: "complete" | "failed" | "partial";
  stepsCompleted: AutoUnderwriteStep[];
  failedStep?: AutoUnderwriteStep;
  failureReason?: string;
  durationMs: number;
  memoReady: boolean;
  voiceSummaryReady: boolean;
};

export type AutoUnderwriteStatus = {
  dealId: string;
  status: "idle" | "running" | "complete" | "failed";
  currentStep: AutoUnderwriteStep | null;
  steps: Array<{
    step: AutoUnderwriteStep;
    status: AutoUnderwriteStepStatus;
    durationMs?: number;
    error?: string;
    startedAt?: string;
    completedAt?: string;
  }>;
  startedAt: string | null;
  completedAt: string | null;
  memoReady: boolean;
  voiceSummaryReady: boolean;
};

export const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"] as const;

export const ALL_STEPS: AutoUnderwriteStep[] = [
  "recompute_document_state",
  "extraction",
  "financial_snapshot",
  "model_engine_v2",
  "sba_package",
  "omega_advisory",
  "credit_memo",
  "narratives",
  "voice_summary",
];
