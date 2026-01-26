/**
 * Buddy Autonomous Research Planner (ARP)
 *
 * The planning layer that sits above the Research Engine.
 * Decides WHAT research to run, WHY, and in WHAT ORDER.
 *
 * Usage:
 *   import { evaluateResearchPlan, getCurrentPlan } from "@/lib/research/planner";
 *
 *   // Evaluate and create a plan for a deal
 *   const result = await evaluateResearchPlan({
 *     deal_id: dealId,
 *     trigger_event: "document_uploaded",
 *     trigger_document_id: docId,
 *   });
 *
 *   // Get current plan
 *   const plan = await getCurrentPlan(dealId);
 */

// Types
export type {
  // Core types
  PlanTriggerEvent,
  ProposedMission,
  ProposedMissionStatus,
  ResearchPlan,
  ResearchIntentLog,
  IntentType,
  // Entity signals
  EntitySignals,
  Principal,
  // Planner I/O
  PlannerInput,
  PlannerOutput,
  ExistingMission,
  // Rule types
  PlannerRule,
  RuleResult,
  // API types
  EvaluatePlanInput,
  EvaluatePlanResult,
  GetPlanResult,
  ApproveMissionInput,
  ApproveMissionResult,
  // Autonomy types
  AutonomyLevel,
  AutonomySettings,
  SetAutonomyInput,
  SetAutonomyResult,
  PlanOverrideAction,
  PlanOverride,
  ApplyOverrideInput,
  ApplyOverrideResult,
  // Re-export
  UnderwritingStance,
} from "./types";

// Entity Signal Extraction
export {
  extractEntitySignals,
  hasMinimumSignals,
  summarizeSignals,
} from "./extractEntitySignals";

// Research Intent Derivation
export {
  deriveResearchIntent,
  summarizePlan,
} from "./deriveResearchIntent";

// Note: runPlanner functions are server-only
// Import directly from "@/lib/research/planner/runPlanner" in server contexts

// Event emission
export { RESEARCH_EVENT_KINDS } from "./events";

// Autonomy Management
export {
  getEffectiveAutonomyLevel,
  setAutonomyLevel,
  shouldAutoExecute,
  isPlanningEnabled,
  applyPlanOverride,
  getPlanOverrides,
  logAutonomyEvent,
  getRecentAutonomyEvents,
} from "./autonomy";
