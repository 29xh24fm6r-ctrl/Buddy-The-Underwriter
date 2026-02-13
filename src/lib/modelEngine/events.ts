/**
 * Model Engine V2 — Event Types
 *
 * Centralized V2 event codes for Aegis telemetry.
 * All use writeSystemEvent() — no new tables.
 * Fire-and-forget pattern: never throws, never blocks response.
 */

import { writeSystemEvent } from "@/lib/aegis/writeSystemEvent";
import type { AegisSeverity, AegisEventType } from "@/lib/aegis/types";

// ---------------------------------------------------------------------------
// Event codes
// ---------------------------------------------------------------------------

export const V2_EVENT_CODES = {
  // Existing (Phase 9)
  MOODYS_RENDER_DIFF: "MOODYS_RENDER_DIFF",
  RENDER_DIFF_COMPUTED: "RENDER_DIFF_COMPUTED",
  // New (Phase 10)
  MODEL_V2_PRIMARY_SERVED: "MODEL_V2_PRIMARY_SERVED",
  MODEL_V2_FALLBACK_TO_V1: "MODEL_V2_FALLBACK_TO_V1",
  MODEL_V2_PARITY_WARN: "MODEL_V2_PARITY_WARN",
  MODEL_V2_PARITY_BLOCK: "MODEL_V2_PARITY_BLOCK",
  MODEL_V2_HARD_FAILURE: "MODEL_V2_HARD_FAILURE",
  // New (Phase 11)
  MODEL_V1_RENDER_ATTEMPT_BLOCKED: "MODEL_V1_RENDER_ATTEMPT_BLOCKED",
  MODEL_V1_AUDIT_REPLAY_SERVED: "MODEL_V1_AUDIT_REPLAY_SERVED",
  MODEL_V2_AUDIT_REPLAY_SERVED: "MODEL_V2_AUDIT_REPLAY_SERVED",
  // New (Phase 12)
  METRIC_REGISTRY_DRAFT_CREATED: "METRIC_REGISTRY_DRAFT_CREATED",
  METRIC_REGISTRY_PUBLISHED: "METRIC_REGISTRY_PUBLISHED",
  METRIC_REGISTRY_IMMUTABLE_VIOLATION: "METRIC_REGISTRY_IMMUTABLE_VIOLATION",
  METRIC_REGISTRY_HASH_MISMATCH: "METRIC_REGISTRY_HASH_MISMATCH",
  METRIC_REGISTRY_REPLAY_MATCH: "METRIC_REGISTRY_REPLAY_MATCH",
  METRIC_REGISTRY_REPLAY_MISMATCH: "METRIC_REGISTRY_REPLAY_MISMATCH",
} as const;

export type V2EventCode = (typeof V2_EVENT_CODES)[keyof typeof V2_EVENT_CODES];

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

function mapSeverity(code: V2EventCode): AegisSeverity {
  switch (code) {
    case "MODEL_V2_HARD_FAILURE":
      return "error";
    case "MODEL_V2_PARITY_BLOCK":
    case "MODEL_V2_FALLBACK_TO_V1":
    case "MODEL_V1_RENDER_ATTEMPT_BLOCKED":
    case "METRIC_REGISTRY_HASH_MISMATCH":
    case "METRIC_REGISTRY_REPLAY_MISMATCH":
    case "METRIC_REGISTRY_IMMUTABLE_VIOLATION":
      return "warning";
    default:
      return "info";
  }
}

function mapEventType(code: V2EventCode): AegisEventType {
  switch (code) {
    case "MODEL_V2_HARD_FAILURE":
      return "error";
    case "MODEL_V2_PARITY_BLOCK":
    case "MODEL_V2_FALLBACK_TO_V1":
    case "MODEL_V2_PARITY_WARN":
    case "MODEL_V1_RENDER_ATTEMPT_BLOCKED":
    case "METRIC_REGISTRY_HASH_MISMATCH":
    case "METRIC_REGISTRY_REPLAY_MISMATCH":
    case "METRIC_REGISTRY_IMMUTABLE_VIOLATION":
      return "warning";
    default:
      return "success";
  }
}

// ---------------------------------------------------------------------------
// Fire-and-forget emitter
// ---------------------------------------------------------------------------

interface V2EventOpts {
  code: V2EventCode;
  dealId: string;
  bankId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Emit a V2 model engine event via Aegis. Fire-and-forget — never throws.
 */
export function emitV2Event(opts: V2EventOpts): void {
  void writeSystemEvent({
    event_type: mapEventType(opts.code),
    severity: mapSeverity(opts.code),
    source_system: "api",
    deal_id: opts.dealId,
    bank_id: opts.bankId,
    error_code: opts.code,
    payload: opts.payload ?? {},
  });
}
