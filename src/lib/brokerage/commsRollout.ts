/**
 * Phase 11N — Comms Rollout Helpers
 *
 * Operator-facing verification steps for stub → dry_run → live.
 * Testable without network calls.
 */

import { getCommsReleaseReadiness, assertCommsLiveReleaseReady, type ReleaseReadiness } from "@/lib/brokerage/commsReleaseGate";
import { assertQaSafeMode, runAllCommsQaScenarios } from "@/lib/brokerage/commsQaHarness";
import { getCommsMode } from "@/lib/brokerage/commsAdapters";

// ── Types ───────────────────────────────────────────────────────────────────

export type ReadinessOutput = {
  exitCode: number;
  readiness: ReleaseReadiness;
};

export type DryRunOutput = {
  ok: boolean;
  readiness: ReleaseReadiness;
  qaResult: { passed: boolean; scenarioCount: number } | null;
  error?: string;
};

export type LivePreflightOutput = {
  ok: boolean;
  mode: string;
  releaseReady: boolean;
  cronConfigured: boolean;
  wouldEnable: string[];
  blocked: string[];
  error?: string;
};

// ── Readiness ───────────────────────────────────────────────────────────────

export function runReadinessCheck(): ReadinessOutput {
  const readiness = getCommsReleaseReadiness();
  const exitCode = readiness.status === "blocked" ? 1 : 0;
  return { exitCode, readiness };
}

// ── Dry-run verification ────────────────────────────────────────────────────

export async function runDryRunVerification(): Promise<DryRunOutput> {
  const mode = getCommsMode();
  if (mode === "live") {
    return { ok: false, readiness: getCommsReleaseReadiness(), qaResult: null, error: "dry_run_refuses_live_mode" };
  }

  const readiness = getCommsReleaseReadiness();

  // Run QA harness
  const safeCheck = assertQaSafeMode();
  if (!safeCheck.safe) {
    return { ok: false, readiness, qaResult: null, error: safeCheck.reason };
  }

  try {
    const qa = await runAllCommsQaScenarios();
    return { ok: qa.passed, readiness, qaResult: { passed: qa.passed, scenarioCount: qa.scenarios.length } };
  } catch (err: any) {
    return { ok: false, readiness, qaResult: null, error: err?.message ?? "qa_failed" };
  }
}

// ── Live preflight ──────────────────────────────────────────────────────────

export function runLivePreflight(): LivePreflightOutput {
  const mode = getCommsMode();
  if (mode !== "live") {
    return { ok: false, mode, releaseReady: false, cronConfigured: false, wouldEnable: [], blocked: [], error: `Mode is ${mode}, not live. Set BROKERAGE_COMMS_MODE=live first.` };
  }

  const release = assertCommsLiveReleaseReady();
  const cronConfigured = Boolean(process.env.CRON_SECRET);

  const wouldEnable: string[] = [];
  const blocked: string[] = [];

  if (release.ok) {
    wouldEnable.push("Resend email delivery");
    wouldEnable.push("Telnyx SMS delivery");
    if (cronConfigured) wouldEnable.push("Scheduled cron processing");
    if (process.env.BROKERAGE_SLACK_WEBHOOK_URL) wouldEnable.push("Slack notifications");
  } else {
    blocked.push(...release.blockers);
  }

  return {
    ok: release.ok,
    mode,
    releaseReady: release.ok,
    cronConfigured,
    wouldEnable,
    blocked,
  };
}
