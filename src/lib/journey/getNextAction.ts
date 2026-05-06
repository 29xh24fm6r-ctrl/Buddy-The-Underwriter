/**
 * SPEC-04 adapter — converts the lifecycle `NextAction` into the
 * SPEC-04 `CockpitAction` discriminated union the action runner consumes.
 *
 * The lifecycle engine (src/buddy/lifecycle/nextAction.ts) is intentionally
 * untouched per the SPEC-01 rule that lifecycle code is read-only from the
 * journey layer. This file is a thin shape adapter — no new behavior.
 */
import type { LifecycleState } from "@/buddy/lifecycle/model";
import {
  getNextAction as getLifecycleNextAction,
  type NextAction as LifecycleNextAction,
  type ServerActionType as LifecycleServerActionType,
} from "@/buddy/lifecycle/nextAction";
import type {
  CockpitAction,
  CockpitNavigateAction,
  CockpitRunnableAction,
  ServerActionType,
} from "@/components/journey/actions/actionTypes";

const SUPPORTED_SERVER_ACTIONS: ReadonlySet<string> = new Set<ServerActionType>([
  "generate_snapshot",
  "generate_packet",
  "run_ai_classification",
  "send_reminder",
]);

function toServerActionType(t: LifecycleServerActionType | undefined): ServerActionType | null {
  if (!t) return null;
  return SUPPORTED_SERVER_ACTIONS.has(t) ? (t as ServerActionType) : null;
}

/**
 * Returns the SPEC-04 `CockpitAction` for the deal's current lifecycle state,
 * or null when the deal is in a terminal/no-action state.
 */
export function getNextAction(
  state: LifecycleState,
  dealId: string,
): CockpitAction | null {
  const native = getLifecycleNextAction(state, dealId);
  return toCockpitAction(native);
}

/**
 * Pure converter. Exposed for tests and direct conversion in stage views.
 */
export function toCockpitAction(native: LifecycleNextAction): CockpitAction | null {
  // complete / blocked are surfaced by PrimaryActionBar as status chips —
  // they have no executable contract, so we model them as null.
  if (native.intent === "complete" || native.intent === "blocked") {
    return null;
  }

  if (native.intent === "runnable") {
    const actionType = toServerActionType(native.serverAction);
    if (actionType) {
      const runnable: CockpitRunnableAction = {
        intent: "runnable",
        label: native.label,
        actionType,
        description: native.description,
        href: native.href,
      };
      return runnable;
    }
    // Fallback: degrade unsupported runnable to navigate when href is present.
    if (native.href) {
      const nav: CockpitNavigateAction = {
        intent: "navigate",
        label: native.label,
        href: native.href,
        description: native.description,
      };
      return nav;
    }
    return null;
  }

  // navigate / advance both render as navigation in the cockpit. The
  // `advance` semantics still POST to lifecycle/advance from the dedicated
  // surface; SPEC-04 keeps PrimaryActionBar on the navigate path for these.
  if (native.href) {
    const nav: CockpitNavigateAction = {
      intent: "navigate",
      label: native.label,
      href: native.href,
      description: native.description,
    };
    return nav;
  }

  return null;
}

export type { CockpitAction } from "@/components/journey/actions/actionTypes";
