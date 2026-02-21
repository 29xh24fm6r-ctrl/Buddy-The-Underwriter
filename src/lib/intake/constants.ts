/**
 * Intake Processing Constants
 *
 * Shared between server (lock TTL, processing version) and client
 * (timeout guard, polling backoff). No server-only imports.
 */

/**
 * Maximum time (ms) a deal may remain in CONFIRMED_READY_FOR_PROCESSING
 * before the UI treats it as stuck. Also used as the backend lock TTL
 * for stale-lock recovery.
 *
 * 5 minutes — generous for large doc sets (9+ docs with extraction + spreads).
 */
export const MAX_PROCESSING_WINDOW_MS = 5 * 60 * 1000;

/**
 * Processing lifecycle version. Emitted in completion ledger events
 * for observability and debugging across deployments.
 */
export const PROCESSING_VERSION = "processing_v2";

/**
 * Polling intervals for IntakeReviewTable (exponential backoff).
 * Starts fast during processing, backs off to reduce server load.
 */
export const POLL_INITIAL_MS = 3_000;
export const POLL_BACKOFF_MS = 5_000;
export const POLL_MAX_MS = 10_000;
