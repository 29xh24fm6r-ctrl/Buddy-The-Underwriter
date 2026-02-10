import "server-only";

/* ------------------------------------------------------------------ */
/*  Aegis Observer — Type Definitions                                  */
/* ------------------------------------------------------------------ */

export type AegisEventType =
  | "error"
  | "warning"
  | "retry"
  | "recovery"
  | "success"
  | "heartbeat"
  | "deploy"
  | "stuck_job"
  | "lease_expired"
  | "suppressed";

export type AegisSeverity = "debug" | "info" | "warning" | "error" | "critical";

export type AegisErrorClass =
  | "transient" // Network, timeout, rate limit — worth retrying
  | "permanent" // Bad data, schema mismatch — retrying won't help
  | "quota" // GCP/API rate limits — back off longer
  | "auth" // Credentials expired — needs human intervention
  | "timeout" // Lease expired or operation timed out
  | "schema" // DB schema mismatch
  | "unknown";

export type AegisResolutionStatus =
  | "open"
  | "retrying"
  | "resolved"
  | "dead"
  | "suppressed";

export type AegisSourceSystem =
  | "ocr_processor"
  | "classify_processor"
  | "extract_processor"
  | "spreads_processor"
  | "artifact_processor"
  | "lifecycle"
  | "observer"
  | "api";

export type AegisJobTable = "document_jobs" | "deal_spread_jobs";

export interface AegisSystemEvent {
  event_type: AegisEventType;
  severity: AegisSeverity;
  error_signature?: string;
  source_system: AegisSourceSystem;
  source_job_id?: string;
  source_job_table?: AegisJobTable;
  deal_id?: string;
  bank_id?: string;
  error_class?: AegisErrorClass;
  error_code?: string;
  error_message?: string;
  error_stack?: string;
  resolution_status?: AegisResolutionStatus;
  resolved_at?: string;
  resolved_by?: string;
  resolution_note?: string;
  retry_attempt?: number;
  max_retries?: number;
  next_retry_at?: string;
  trace_id?: string;
  correlation_id?: string;
  payload?: Record<string, unknown>;
}

export interface AegisWorkerHeartbeat {
  workerId: string;
  workerType: string;
  status?: "alive" | "degraded" | "dead" | "draining";
  jobsProcessed?: number;
  jobsFailed?: number;
  consecutiveFailures?: number;
  lastError?: string;
}

export interface UnifiedJob {
  job_id: string;
  deal_id: string;
  bank_id: string | null;
  job_kind: string;
  source_table: string;
  status: string;
  attempt: number;
  max_attempts: number;
  error: string | null;
  minutes_stuck: number;
  leased_until: string | null;
  updated_at: string;
}

export interface SystemicFailure {
  error_signature: string;
  error_class: string;
  error_code: string;
  sample_message: string;
  hit_count: number;
  distinct_entities: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface SpreadsIntelligenceResult {
  spreads_generating_timeout: number;
  spreads_auto_healed: number;
  spread_jobs_orphaned: number;
  snapshot_blocked_deals: number;
  stale_spread_status_detected: number;
  failed_spread_jobs_linked: number;
}

export interface ObserverTickResult {
  ok: boolean;
  scanned: {
    stuck_jobs: number;
    failed_jobs: number;
    dead_workers: number;
  };
  actions: {
    retried: number;
    marked_dead: number;
    suppressed: number;
    workers_marked_dead: number;
    systemic_failures_detected: number;
    events_emitted: number;
  };
  spreads_intelligence: SpreadsIntelligenceResult;
  systemic_failures: SystemicFailure[];
  errors: string[];
}
