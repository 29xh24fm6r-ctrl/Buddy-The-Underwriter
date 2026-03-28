import type { ExecuteCanonicalActionResult } from "../types";

/**
 * no_action_required — Always returns noop. No side effects.
 */
export function handleNoActionRequired(): ExecuteCanonicalActionResult {
  return {
    ok: true,
    actionCode: "no_action_required",
    target: "workflow",
    targetRecordId: null,
    status: "noop",
  };
}
