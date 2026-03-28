import type { ExecuteCanonicalActionInput, ExecuteCanonicalActionResult } from "../types";
import type { CanonicalExecutionMapping } from "../canonicalActionExecutionMap";

/**
 * Task-only handler — records that a banker initiated the action.
 * Does not mutate operating tables directly.
 * Returns "created" with no target record — the action is tracked in
 * canonical_action_executions by the caller.
 */
export function handleTaskOnly(
  input: ExecuteCanonicalActionInput,
  mapping: CanonicalExecutionMapping,
): ExecuteCanonicalActionResult {
  return {
    ok: true,
    actionCode: input.action.code,
    target: mapping.target,
    targetRecordId: null,
    status: "created",
  };
}
