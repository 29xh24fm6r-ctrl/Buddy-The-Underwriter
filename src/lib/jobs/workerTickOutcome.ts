export type WorkerStepResult = {
  ok?: boolean;
  idle?: boolean;
  [key: string]: unknown;
};

export function isWorkerStepFailure(result: WorkerStepResult | null | undefined): boolean {
  return result?.ok !== true && result?.idle !== true;
}

export function publicWorkerStepResult(
  type: string,
  result: WorkerStepResult | null | undefined,
): Record<string, unknown> {
  if (result?.ok === true) return { type, ...result };
  if (result?.idle === true) return { type, ok: true, idle: true };
  return { type, ok: false, error: "worker_step_failed" };
}

export function workerTickStatus(failedSteps: number): 200 | 503 {
  return failedSteps > 0 ? 503 : 200;
}
