/**
 * Buddy Lifecycle Module - Client Safe Exports
 *
 * This module exports ONLY types and constants that are safe for client components.
 * Server-only functions (deriveLifecycleState, advanceDealLifecycle) are NOT exported here.
 *
 * Use this import in client components:
 *   import type { LifecycleState } from "@/buddy/lifecycle/client";
 *   import { STAGE_LABELS } from "@/buddy/lifecycle/client";
 */

// Types (safe for client - these are just TypeScript types, not runtime code)
export type {
  LifecycleStage,
  LifecycleBlockerCode,
  LifecycleBlocker,
  LifecycleDerived,
  LifecycleState,
  ActorContext,
  AdvanceLifecycleResult,
} from "./model";

// Constants (safe for client - these are plain objects with no server dependencies)
export { ALLOWED_STAGE_TRANSITIONS, STAGE_LABELS } from "./model";

// Event types (safe for client)
export { LedgerEventType } from "./events";
export type {
  LedgerEventTypeValue,
  LifecycleAdvancedPayload,
  ChecklistUpdatedPayload,
  BlockerResolvedPayload,
} from "./events";

// Next action helpers (safe for client - pure functions with no server dependencies)
export {
  getNextAction,
  getBlockerFixAction,
  getNextActionIcon,
} from "./nextAction";
export type { NextAction, ServerActionType } from "./nextAction";
