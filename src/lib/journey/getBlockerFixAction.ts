/**
 * SPEC-04 adapter — converts a lifecycle blocker into a SPEC-04
 * `CockpitFixBlockerAction` (or navigate fallback) for the action runner.
 *
 * Like getNextAction adapter, the lifecycle engine is untouched.
 */
import {
  getBlockerFixAction as getLifecycleBlockerFixAction,
  type FixAction as LifecycleFixAction,
} from "@/buddy/lifecycle/nextAction";
import type { LifecycleBlocker } from "@/buddy/lifecycle/model";
import type {
  CockpitAction,
  CockpitFixBlockerAction,
  CockpitNavigateAction,
  ServerActionType,
} from "@/components/journey/actions/actionTypes";

const SUPPORTED_SERVER_ACTIONS: ReadonlySet<string> = new Set<ServerActionType>([
  "generate_snapshot",
  "generate_packet",
  "run_ai_classification",
  "send_reminder",
]);

/**
 * Map a lifecycle blocker to a runnable fix action when the lifecycle
 * exposes a server action shorthand (e.g. financial_snapshot.recompute), or
 * a navigate fallback otherwise. Returns null when no fix is available.
 */
export function getBlockerFixAction(
  blocker: LifecycleBlocker,
  dealId: string,
): CockpitAction | null {
  const native = getLifecycleBlockerFixAction(blocker, dealId);
  return toCockpitFixAction(native, blocker.code);
}

export function toCockpitFixAction(
  native: LifecycleFixAction | null,
  blockerId: string,
): CockpitAction | null {
  if (!native) return null;

  // Lifecycle "action" shorthand (e.g. "financial_snapshot.recompute") maps
  // to a runnable server action when its prefix matches a SPEC-04 entry.
  if ("action" in native && typeof native.action === "string") {
    const actionType = native.action.split(".")[0] as string;
    if (SUPPORTED_SERVER_ACTIONS.has(actionType as ServerActionType)) {
      const fix: CockpitFixBlockerAction = {
        intent: "fix_blocker",
        label: native.label,
        blockerId,
        actionType: actionType as ServerActionType,
        payload: { lifecycleAction: native.action },
      };
      return fix;
    }
    // Unsupported action — degrade to navigate to cockpit so the banker
    // still has a path forward.
    return null;
  }

  if ("href" in native && native.href) {
    const nav: CockpitNavigateAction = {
      intent: "navigate",
      label: native.label,
      href: native.href,
    };
    return nav;
  }

  return null;
}
