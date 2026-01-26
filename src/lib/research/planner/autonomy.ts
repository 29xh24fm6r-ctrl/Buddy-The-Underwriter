/**
 * Research Autonomy Management
 *
 * Controls how the research planner behaves:
 * - OFF: No research planning or execution
 * - RECOMMEND: Create plan for user approval before execution
 * - AUTO_RUN: Automatically execute research plan
 */

import type {
  AutonomyLevel,
  AutonomySettings,
  SetAutonomyInput,
  SetAutonomyResult,
  PlanOverride,
  ApplyOverrideInput,
  ApplyOverrideResult,
} from "./types";
import { DEFAULT_AUTONOMY_LEVEL, AUTONOMY_LEVEL_CONFIG } from "../playbook";

// ============================================================================
// In-Memory Store (for now - will be replaced with Supabase)
// ============================================================================

const autonomyStore = new Map<string, AutonomySettings>();
const overrideStore = new Map<string, PlanOverride[]>();

function getStoreKey(dealId?: string, bankId?: string): string {
  if (dealId) return `deal:${dealId}`;
  if (bankId) return `bank:${bankId}`;
  return "global";
}

// ============================================================================
// Autonomy Level Management
// ============================================================================

/**
 * Get the effective autonomy level for a deal.
 * Resolution order: deal > bank > global > default
 */
export function getEffectiveAutonomyLevel(
  dealId?: string,
  bankId?: string
): AutonomySettings {
  // Check deal-level first
  if (dealId) {
    const dealSettings = autonomyStore.get(`deal:${dealId}`);
    if (dealSettings) return dealSettings;
  }

  // Check bank-level
  if (bankId) {
    const bankSettings = autonomyStore.get(`bank:${bankId}`);
    if (bankSettings) return bankSettings;
  }

  // Check global
  const globalSettings = autonomyStore.get("global");
  if (globalSettings) return globalSettings;

  // Return default
  return {
    level: DEFAULT_AUTONOMY_LEVEL,
    scope: "global",
    updated_at: new Date().toISOString(),
  };
}

/**
 * Set the autonomy level for a scope.
 */
export function setAutonomyLevel(input: SetAutonomyInput): SetAutonomyResult {
  const key = getStoreKey(input.deal_id, input.bank_id);
  const existing = autonomyStore.get(key);
  const previousLevel = existing?.level;

  const settings: AutonomySettings = {
    level: input.level,
    scope: input.deal_id ? "deal" : input.bank_id ? "bank" : "global",
    deal_id: input.deal_id ?? null,
    bank_id: input.bank_id ?? null,
    set_by_user_id: input.user_id ?? null,
    updated_at: new Date().toISOString(),
  };

  autonomyStore.set(key, settings);

  return {
    ok: true,
    previous_level: previousLevel,
  };
}

/**
 * Check if research should auto-execute based on autonomy level.
 */
export function shouldAutoExecute(dealId?: string, bankId?: string): boolean {
  const settings = getEffectiveAutonomyLevel(dealId, bankId);
  return AUTONOMY_LEVEL_CONFIG[settings.level].auto_execute;
}

/**
 * Check if research planning is enabled.
 */
export function isPlanningEnabled(dealId?: string, bankId?: string): boolean {
  const settings = getEffectiveAutonomyLevel(dealId, bankId);
  return settings.level !== "OFF";
}

// ============================================================================
// Plan Override Management
// ============================================================================

/**
 * Apply an override to a research plan.
 */
export function applyPlanOverride(input: ApplyOverrideInput): ApplyOverrideResult {
  const override: PlanOverride = {
    id: `override-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    plan_id: input.plan_id,
    deal_id: "", // Would come from plan lookup
    action: input.action,
    mission_type: input.mission_type ?? null,
    data: input.data ?? {},
    user_id: input.user_id,
    reason: input.reason ?? null,
    created_at: new Date().toISOString(),
  };

  const existing = overrideStore.get(input.plan_id) ?? [];
  existing.push(override);
  overrideStore.set(input.plan_id, existing);

  return {
    ok: true,
    override_id: override.id,
  };
}

/**
 * Get all overrides for a plan.
 */
export function getPlanOverrides(planId: string): PlanOverride[] {
  return overrideStore.get(planId) ?? [];
}

/**
 * Clear all overrides for a plan (for testing).
 */
export function clearPlanOverrides(planId: string): void {
  overrideStore.delete(planId);
}

// ============================================================================
// Autonomy Event Logging
// ============================================================================

export type AutonomyEvent = {
  event_type: "autonomy_level_changed" | "plan_overridden" | "plan_approved" | "plan_rejected";
  timestamp: string;
  deal_id?: string;
  bank_id?: string;
  user_id?: string;
  data: Record<string, unknown>;
};

const eventLog: AutonomyEvent[] = [];

/**
 * Log an autonomy event.
 */
export function logAutonomyEvent(event: Omit<AutonomyEvent, "timestamp">): void {
  eventLog.push({
    ...event,
    timestamp: new Date().toISOString(),
  });

  // Keep only last 1000 events
  if (eventLog.length > 1000) {
    eventLog.shift();
  }
}

/**
 * Get recent autonomy events.
 */
export function getRecentAutonomyEvents(limit = 100): AutonomyEvent[] {
  return eventLog.slice(-limit);
}

// ============================================================================
// Reset Functions (for testing)
// ============================================================================

export function resetAutonomyStore(): void {
  autonomyStore.clear();
  overrideStore.clear();
  eventLog.length = 0;
}
