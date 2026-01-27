/**
 * Buddy Mode Feature Gates — Strict, Explicit.
 *
 * Single module for all mode-gated capability checks.
 * No scattered process.env checks elsewhere.
 *
 * Gate matrix:
 *
 *   Capability                  | builder_observer | banker_copilot | examiner_portal
 *   ─────────────────────────── | ─────────────── | ────────────── | ───────────────
 *   canViewDiagnostics          |       ✓          |       ✗        |       ✗
 *   canReplayCase               |       ✓          |       ✗        |       ✗
 *   canValidateCase             |       ✓          |       ✓        |       ✗
 *   canGenerateDraftEmails      |       ✗          |       ✓        |       ✗
 *   canDownloadExaminerDrop     |       ✗          |       ✓        |       ✗ (view-only)
 *   canVerifyIntegrity          |       ✓          |       ✓        |       ✓
 *   canViewCopilotCard          |       ✗          |       ✓        |       ✗
 *   canAccessObserverPanel      |       ✓          |       ✗        |       ✗
 *   canAccessExaminerPortal     |       ✗          |       ✗        |       ✓
 */

import type { BuddyMode } from "./mode";

// ── Diagnostics & Tooling ─────────────────────────────

/** View omega health, degraded feeds, mirror status, latency metrics. */
export function canViewDiagnostics(mode: BuddyMode): boolean {
  return mode === "builder_observer";
}

/** Re-emit all signals for a case to Omega (re-sync). Builder only. */
export function canReplayCase(mode: BuddyMode): boolean {
  return mode === "builder_observer";
}

/** Run validation checks on a case (read-only). Builder + Banker. */
export function canValidateCase(mode: BuddyMode): boolean {
  return mode === "builder_observer" || mode === "banker_copilot";
}

// ── Banker Copilot ────────────────────────────────────

/** Generate draft emails (draft-only, never sends). Banker only. */
export function canGenerateDraftEmails(mode: BuddyMode): boolean {
  return mode === "banker_copilot";
}

/** Download examiner drop ZIP. Banker/admin only; examiners view-only. */
export function canDownloadExaminerDrop(mode: BuddyMode): boolean {
  return mode === "banker_copilot";
}

/** View copilot confidence card + recommendations. */
export function canViewCopilotCard(mode: BuddyMode): boolean {
  return mode === "banker_copilot";
}

// ── Cross-Cutting ─────────────────────────────────────

/** Verify integrity of snapshots and examiner drops. All modes. */
export function canVerifyIntegrity(mode: BuddyMode): boolean {
  return true; // all modes
}

// ── Panel Access ──────────────────────────────────────

/** Access the builder observer panel (health, degraded, mirrors, traces, tools). */
export function canAccessObserverPanel(mode: BuddyMode): boolean {
  return mode === "builder_observer";
}

/** Access the examiner portal (scoped, read-only). */
export function canAccessExaminerPortal(mode: BuddyMode): boolean {
  return mode === "examiner_portal";
}

// ── Aggregate Gate Check ──────────────────────────────

export type ModeGates = {
  canViewDiagnostics: boolean;
  canReplayCase: boolean;
  canValidateCase: boolean;
  canGenerateDraftEmails: boolean;
  canDownloadExaminerDrop: boolean;
  canViewCopilotCard: boolean;
  canVerifyIntegrity: boolean;
  canAccessObserverPanel: boolean;
  canAccessExaminerPortal: boolean;
};

/** Compute all gates for a mode in a single call. */
export function computeGates(mode: BuddyMode): ModeGates {
  return {
    canViewDiagnostics: canViewDiagnostics(mode),
    canReplayCase: canReplayCase(mode),
    canValidateCase: canValidateCase(mode),
    canGenerateDraftEmails: canGenerateDraftEmails(mode),
    canDownloadExaminerDrop: canDownloadExaminerDrop(mode),
    canViewCopilotCard: canViewCopilotCard(mode),
    canVerifyIntegrity: canVerifyIntegrity(mode),
    canAccessObserverPanel: canAccessObserverPanel(mode),
    canAccessExaminerPortal: canAccessExaminerPortal(mode),
  };
}
