/**
 * Mission Orchestration - Idempotency & Timeboxing
 *
 * Provides:
 * - Run key generation for mission idempotency
 * - Timeboxing configuration and enforcement
 * - Concurrency control helpers
 */

import { createHash } from "crypto";
import type { MissionType, MissionSubject, MissionDepth } from "./types";
import { getMissionDefinition } from "./playbook";

// ============================================================================
// Types
// ============================================================================

export type RunKeyInput = {
  deal_id: string;
  mission_type: MissionType;
  subject: MissionSubject;
  depth: MissionDepth;
};

export type TimeboxConfig = {
  max_sources: number;
  max_fetch_seconds: number;
  max_extract_seconds: number;
};

export type TimeboxState = {
  started_at: number;
  sources_fetched: number;
  fetch_started_at?: number;
  extract_started_at?: number;
};

export type TimeboxCheckResult = {
  exceeded: boolean;
  reason?: "sources" | "fetch_time" | "extract_time";
  elapsed_ms?: number;
  limit_ms?: number;
};

// ============================================================================
// Run Key Generation
// ============================================================================

/**
 * Generate a deterministic run key for mission idempotency.
 * Same inputs always produce the same key.
 */
export function generateRunKey(input: RunKeyInput): string {
  const normalized = {
    deal_id: input.deal_id,
    mission_type: input.mission_type,
    subject: normalizeSubject(input.subject),
    depth: input.depth,
  };

  const json = JSON.stringify(normalized, Object.keys(normalized).sort());
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

/**
 * Normalize subject for consistent hashing.
 */
function normalizeSubject(subject: MissionSubject): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  if (subject.naics_code) {
    normalized.naics_code = subject.naics_code.replace(/[^0-9]/g, "");
  }
  if (subject.sic_code) {
    normalized.sic_code = subject.sic_code.replace(/[^0-9]/g, "");
  }
  if (subject.geography) {
    normalized.geography = subject.geography.toUpperCase().trim();
  }
  if (subject.company_name) {
    normalized.company_name = subject.company_name.toLowerCase().trim();
  }
  if (subject.keywords && subject.keywords.length > 0) {
    normalized.keywords = [...subject.keywords].sort().map((k) => k.toLowerCase().trim());
  }

  return normalized;
}

// ============================================================================
// Timeboxing
// ============================================================================

/**
 * Get timebox configuration for a mission type.
 */
export function getTimeboxConfig(missionType: MissionType): TimeboxConfig {
  const def = getMissionDefinition(missionType);
  return {
    max_sources: def.max_sources,
    max_fetch_seconds: def.max_fetch_seconds,
    max_extract_seconds: def.max_extract_seconds,
  };
}

/**
 * Create a new timebox state.
 */
export function createTimeboxState(): TimeboxState {
  return {
    started_at: Date.now(),
    sources_fetched: 0,
  };
}

/**
 * Check if timebox limits have been exceeded.
 */
export function checkTimeboxLimits(
  state: TimeboxState,
  config: TimeboxConfig
): TimeboxCheckResult {
  // Check source count
  if (state.sources_fetched >= config.max_sources) {
    return {
      exceeded: true,
      reason: "sources",
    };
  }

  // Check fetch time
  if (state.fetch_started_at) {
    const fetchElapsed = Date.now() - state.fetch_started_at;
    const fetchLimit = config.max_fetch_seconds * 1000;
    if (fetchElapsed >= fetchLimit) {
      return {
        exceeded: true,
        reason: "fetch_time",
        elapsed_ms: fetchElapsed,
        limit_ms: fetchLimit,
      };
    }
  }

  // Check extract time
  if (state.extract_started_at) {
    const extractElapsed = Date.now() - state.extract_started_at;
    const extractLimit = config.max_extract_seconds * 1000;
    if (extractElapsed >= extractLimit) {
      return {
        exceeded: true,
        reason: "extract_time",
        elapsed_ms: extractElapsed,
        limit_ms: extractLimit,
      };
    }
  }

  return { exceeded: false };
}

/**
 * Update timebox state after fetching a source.
 */
export function recordSourceFetched(state: TimeboxState): TimeboxState {
  return {
    ...state,
    sources_fetched: state.sources_fetched + 1,
  };
}

/**
 * Mark fetch phase as started.
 */
export function startFetchPhase(state: TimeboxState): TimeboxState {
  return {
    ...state,
    fetch_started_at: Date.now(),
  };
}

/**
 * Mark extract phase as started.
 */
export function startExtractPhase(state: TimeboxState): TimeboxState {
  return {
    ...state,
    extract_started_at: Date.now(),
  };
}

// ============================================================================
// Mission Lifecycle Events
// ============================================================================

export type MissionLifecycleEvent =
  | "mission_created"
  | "mission_queued"
  | "mission_started"
  | "fetch_phase_started"
  | "source_discovered"
  | "source_fetched"
  | "source_failed"
  | "fetch_phase_completed"
  | "extract_phase_started"
  | "facts_extracted"
  | "extract_phase_completed"
  | "inferences_derived"
  | "narrative_compiled"
  | "mission_completed"
  | "mission_failed"
  | "mission_timeboxed";

export type MissionEvent = {
  event: MissionLifecycleEvent;
  timestamp: string;
  mission_id: string;
  data?: Record<string, unknown>;
};

/**
 * Create a mission lifecycle event.
 */
export function createMissionEvent(
  event: MissionLifecycleEvent,
  missionId: string,
  data?: Record<string, unknown>
): MissionEvent {
  return {
    event,
    timestamp: new Date().toISOString(),
    mission_id: missionId,
    data,
  };
}

// ============================================================================
// Concurrency Helpers
// ============================================================================

/**
 * Check if a mission should be skipped due to existing active mission.
 * Returns the existing mission ID if one exists.
 */
export async function checkExistingMission(
  dealId: string,
  runKey: string,
  forceRerun: boolean
): Promise<{ skip: boolean; existingMissionId?: string }> {
  // This would normally query the database
  // For now, return false (don't skip)
  if (forceRerun) {
    return { skip: false };
  }

  // In production, this would check:
  // SELECT id FROM buddy_research_missions
  // WHERE deal_id = $1 AND run_key = $2
  // AND status IN ('queued', 'running', 'complete')
  // LIMIT 1

  return { skip: false };
}

// ============================================================================
// Mission Priority Queue
// ============================================================================

export type QueuedMission = {
  deal_id: string;
  mission_type: MissionType;
  subject: MissionSubject;
  depth: MissionDepth;
  priority: number;
  queued_at: string;
  run_key: string;
};

/**
 * Sort missions by priority.
 * Lower priority number = higher priority.
 */
export function sortByPriority(missions: QueuedMission[]): QueuedMission[] {
  return [...missions].sort((a, b) => {
    // First by priority
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Then by queued time (FIFO)
    return new Date(a.queued_at).getTime() - new Date(b.queued_at).getTime();
  });
}

// ============================================================================
// Retry Configuration
// ============================================================================

export type RetryConfig = {
  max_attempts: number;
  initial_delay_ms: number;
  max_delay_ms: number;
  backoff_multiplier: number;
};

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  max_attempts: 3,
  initial_delay_ms: 1000,
  max_delay_ms: 30000,
  backoff_multiplier: 2,
};

/**
 * Calculate delay for retry attempt.
 */
export function getRetryDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const delay = config.initial_delay_ms * Math.pow(config.backoff_multiplier, attempt);
  return Math.min(delay, config.max_delay_ms);
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("rate limit") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("504")
  );
}
