/**
 * StuckReason → UI copy mapping.
 *
 * Pure module — no server-only. Safe for client components and CI guards.
 * Maps each stuck detection reason to a user-facing headline, detail, and CTA.
 */

import type { StuckReason } from "./detectStuckProcessing";

// ── Types ──────────────────────────────────────────────────────────────

export type StuckReasonUx = {
  headline: string;
  detail: string;
  cta: string;
};

// ── Mapping ────────────────────────────────────────────────────────────

const UX_MAP: Record<StuckReason, StuckReasonUx> = {
  queued_never_started: {
    headline: "Processing never started",
    detail: "The processing worker failed to pick up this run.",
    cta: "Retry Processing",
  },
  heartbeat_stale: {
    headline: "Processing stalled",
    detail: "Processing started but stopped responding mid-run.",
    cta: "Retry Processing",
  },
  overall_timeout: {
    headline: "Processing timed out",
    detail: "The run exceeded the maximum processing window.",
    cta: "Retry Processing",
  },
  legacy_no_markers: {
    headline: "Processing state unknown",
    detail: "This run predates processing observability. State cannot be verified.",
    cta: "Re-submit for Processing",
  },
};

/**
 * Get user-facing copy for a stuck reason.
 */
export function getStuckReasonUx(reason: StuckReason): StuckReasonUx {
  return UX_MAP[reason];
}
