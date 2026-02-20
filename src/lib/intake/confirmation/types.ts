/**
 * Phase E0 — Intake Confirmation Gate Types
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 */

import { createHash } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────

export type IntakePhase =
  | "BULK_UPLOADED"
  | "CLASSIFIED_PENDING_CONFIRMATION"
  | "CONFIRMED_READY_FOR_PROCESSING";

export type IntakeDocStatus =
  | "UPLOADED"
  | "CLASSIFIED_PENDING_REVIEW"
  | "AUTO_CONFIRMED"
  | "USER_CONFIRMED"
  | "LOCKED_FOR_PROCESSING";

// ── Constants (CI-locked) ──────────────────────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  RED_BELOW: 0.75,
  AMBER_BELOW: 0.90,
  GREEN_AT_OR_ABOVE: 0.90,
} as const;

export const INTAKE_CONFIRMATION_VERSION = "confirmation_v1";

// ── Pure Functions ─────────────────────────────────────────────────────

/** Derive the confidence band for a classification confidence score. */
export function confidenceBand(
  confidence: number | null | undefined,
): "red" | "amber" | "green" {
  if (confidence == null || confidence < CONFIDENCE_THRESHOLDS.RED_BELOW)
    return "red";
  if (confidence < CONFIDENCE_THRESHOLDS.AMBER_BELOW) return "amber";
  return "green";
}

/** Derive intake_status from classification confidence. */
export function deriveIntakeStatus(
  confidence: number | null | undefined,
): IntakeDocStatus {
  if (confidence == null) return "CLASSIFIED_PENDING_REVIEW";
  if (confidence >= CONFIDENCE_THRESHOLDS.GREEN_AT_OR_ABOVE)
    return "AUTO_CONFIRMED";
  return "CLASSIFIED_PENDING_REVIEW";
}

/**
 * Compute a deterministic snapshot hash over intake documents.
 * Used to detect post-lock mutation and guarantee immutability.
 *
 * Input is sorted by doc ID to ensure determinism regardless of query order.
 */
export function computeIntakeSnapshotHash(
  docs: Array<{ id: string; canonical_type: string | null; doc_year: number | null }>,
): string {
  const sorted = [...docs].sort((a, b) => a.id.localeCompare(b.id));
  const payload = sorted
    .map((d) => `${d.id}|${d.canonical_type ?? ""}|${d.doc_year ?? ""}`)
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}
