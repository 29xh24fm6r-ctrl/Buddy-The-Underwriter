/**
 * SPEC-04 — Cockpit action execution contract.
 *
 * One discriminated union spanning all action paths in the stage-driven
 * cockpit: navigation, runnable server actions, and blocker fixes.
 *
 * `ServerActionType` mirrors the existing `ServerActionType` in
 * src/buddy/lifecycle/nextAction.ts — kept here to avoid pulling lifecycle
 * engine types into the action runner. Both lists must stay in sync.
 */

export type ServerActionType =
  | "generate_snapshot"
  | "generate_packet"
  | "run_ai_classification"
  | "send_reminder";

export type CockpitActionIntent = "navigate" | "runnable" | "fix_blocker";

export type CockpitNavigateAction = {
  intent: "navigate";
  label: string;
  href: string;
  description?: string;
};

export type CockpitRunnableAction = {
  intent: "runnable";
  label: string;
  actionType: ServerActionType;
  payload?: Record<string, unknown>;
  description?: string;
  /** Optional fallback href when execution is unsupported. */
  href?: string;
};

export type CockpitFixBlockerAction = {
  intent: "fix_blocker";
  label: string;
  blockerId: string;
  actionType: ServerActionType;
  payload?: Record<string, unknown>;
  description?: string;
  /** Optional fallback href if action fails or is unsupported. */
  href?: string;
};

export type CockpitAction =
  | CockpitNavigateAction
  | CockpitRunnableAction
  | CockpitFixBlockerAction;

export type CockpitActionResultStatus = "ok" | "error";

export type CockpitActionResult = {
  ok: boolean;
  status: CockpitActionResultStatus;
  errorMessage?: string;
  endpoint?: string;
  httpStatus?: number;
};
