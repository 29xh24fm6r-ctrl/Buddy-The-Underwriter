/**
 * Phase 58B — Derive Auto-Intelligence State
 *
 * Pure function for cockpit rendering of pipeline progress.
 */

export type IntelligenceStepState = {
  code: string;
  label: string;
  status: "queued" | "running" | "skipped" | "succeeded" | "failed";
  summary: Record<string, unknown>;
  errorDetail: string | null;
};

export type AutoIntelligenceState = {
  hasRun: boolean;
  runStatus: string | null;
  pipelineRunning: boolean;
  pipelineReady: boolean;
  steps: IntelligenceStepState[];
  failedStepCount: number;
  succeededStepCount: number;
  skippedStepCount: number;
};

const STEP_LABELS: Record<string, string> = {
  extract_facts: "Extracting financial facts",
  generate_snapshot: "Building financial snapshot",
  lender_match: "Matching lender appetite",
  risk_recompute: "Evaluating risk signals",
};

/**
 * Derive cockpit-renderable intelligence pipeline state.
 */
export function deriveAutoIntelligenceState(
  run: { status: string } | null,
  steps: Array<{ step_code: string; status: string; summary: Record<string, unknown>; error_detail: string | null }>,
): AutoIntelligenceState {
  if (!run) {
    return {
      hasRun: false,
      runStatus: null,
      pipelineRunning: false,
      pipelineReady: false,
      steps: [],
      failedStepCount: 0,
      succeededStepCount: 0,
      skippedStepCount: 0,
    };
  }

  const mappedSteps: IntelligenceStepState[] = steps.map((s) => ({
    code: s.step_code,
    label: STEP_LABELS[s.step_code] ?? s.step_code,
    status: s.status as any,
    summary: s.summary ?? {},
    errorDetail: s.error_detail,
  }));

  return {
    hasRun: true,
    runStatus: run.status,
    pipelineRunning: run.status === "queued" || run.status === "running",
    pipelineReady: run.status === "succeeded",
    steps: mappedSteps,
    failedStepCount: mappedSteps.filter((s) => s.status === "failed").length,
    succeededStepCount: mappedSteps.filter((s) => s.status === "succeeded").length,
    skippedStepCount: mappedSteps.filter((s) => s.status === "skipped").length,
  };
}
