/**
 * Buddy Lifecycle Module
 *
 * Unified lifecycle management for deals.
 * Single source of truth for "where is this deal and what's blocking it?"
 */

// Types
export type {
  LifecycleStage,
  LifecycleBlockerCode,
  LifecycleBlocker,
  LifecycleDerived,
  LifecycleState,
  ActorContext,
  AdvanceLifecycleResult,
} from "./model";

// Constants
export { ALLOWED_STAGE_TRANSITIONS, STAGE_LABELS } from "./model";

// Events
export { LedgerEventType } from "./events";
export type {
  LedgerEventTypeValue,
  LifecycleAdvancedPayload,
  ChecklistUpdatedPayload,
  BlockerResolvedPayload,
} from "./events";

// Core functions
export { deriveLifecycleState } from "./deriveLifecycleState";
export { advanceDealLifecycle, forceAdvanceLifecycle } from "./advanceDealLifecycle";
export type { ForceAdvanceAuditMeta } from "./advanceDealLifecycle";

// Guards
export {
  requireStageOrBlock,
  requireMinimumStage,
  requireNoBlockers,
  PageGuards,
  getBlockerExplanation,
  STAGES_AT_OR_BEYOND,
  isStageAtOrBefore,
} from "./guards";
export type { GuardResult } from "./guards";
