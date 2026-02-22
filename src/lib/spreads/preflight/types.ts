/**
 * E2 — Spread Preflight Types
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * Core Philosophy:
 *   Intake is the only authority that validates document identity, type, year, entity.
 *   Spreads NEVER re-validate intake decisions.
 *   Spreads only verify: (1) intake proof integrity, (2) extraction completeness, (3) extraction sanity.
 */

// ── Blocker Codes ─────────────────────────────────────────────────────

export type PreflightBlockerCode =
  | "INTAKE_NOT_CONFIRMED"
  | "INTAKE_SNAPSHOT_HASH_MISMATCH"
  | "EXTRACTION_NOT_READY" // transient — extraction job not complete
  | "EXTRACTION_SUSPECT" // data integrity — sanity check failed
  | "SPREADS_DISABLED_BY_FLAG"
  | "UNKNOWN_FAILSAFE";

export type PreflightBlocker = {
  code: PreflightBlockerCode;
  message: string;
  documentIds?: string[];
  transient?: boolean; // true for EXTRACTION_NOT_READY (will resolve itself)
};

// ── Preflight Input ───────────────────────────────────────────────────

export type PreflightActiveDoc = {
  id: string;
  canonical_type: string | null;
  doc_year: number | null;
  logical_key: string | null;
  extraction_quality_status: string | null; // PASSED | SUSPECT | null
};

export type PreflightInput = {
  intakePhase: string | null;
  storedSnapshotHash: string | null;
  activeDocs: PreflightActiveDoc[];
  extractionHeartbeatDocIds: Set<string>;
  spreadsEnabled: boolean;
};

// ── Preflight Output ──────────────────────────────────────────────────

export type PreflightSnapshot = {
  computedHash: string;
  docCount: number;
  extractionReadyCount: number;
  spreadTypes: string[];
  timestamp: string;
};

export type PreflightResult =
  | { ok: true; snapshot: PreflightSnapshot; warnings?: PreflightBlocker[] }
  | { ok: false; error: "PREFLIGHT_BLOCKED"; blockers: PreflightBlocker[] };

// ── Orchestration ─────────────────────────────────────────────────────

export type RunReason =
  | "intake_confirmed"
  | "manual"
  | "recompute"
  | "doc_change";

export type SpreadRunStatus =
  | "blocked"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "debounced";
