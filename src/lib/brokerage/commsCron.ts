/**
 * Phase 11J — Scheduled Comms Runner
 *
 * Cron-compatible logic for batch comms orchestration + outbox processing.
 * Separated from the route so it's testable with stubs.
 */

import { assertCommsEnvReady, getCommsMode } from "@/lib/brokerage/commsAdapters";
import { redactResponseSecrets } from "@/lib/brokerage/commsAuth";

export type CronAuthResult = { authorized: boolean; error?: string };
export type CronRunResult = {
  ok: boolean;
  mode: string;
  dealsProcessed: number;
  totalEnqueued: number;
  totalSkipped: number;
  outboxProcessed?: number;
  outboxSent?: number;
  outboxFailed?: number;
  warnings: string[];
  error?: string;
};

type SB = { from: (t: string) => any };

// ── Auth ────────────────────────────────────────────────────────────────────

export function verifyCronSecret(request: Request): CronAuthResult {
  const expected = process.env.CRON_SECRET;
  if (!expected) return { authorized: false, error: "CRON_SECRET not configured" };

  // Check Authorization: Bearer <secret>
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token === expected) return { authorized: true };
  }

  // Check x-cron-secret header
  const cronHeader = request.headers.get("x-cron-secret");
  if (cronHeader === expected) return { authorized: true };

  return { authorized: false, error: "invalid_secret" };
}

// ── Env readiness ───────────────────────────────────────────────────────────

export function checkCronEnvReadiness(): { ready: boolean; issues: string[] } {
  const mode = getCommsMode();
  if (mode !== "live") return { ready: true, issues: [] };

  const status = assertCommsEnvReady();
  const criticalIssues = status.issues.filter(i => i.includes("critical"));
  return { ready: criticalIssues.length === 0, issues: criticalIssues };
}

// ── Parse limit ─────────────────────────────────────────────────────────────

export function parseCronLimit(body: Record<string, any>): number {
  const raw = body?.limit;
  if (typeof raw === "number" && raw > 0) return Math.min(raw, 100);
  return 25;
}

// ── Ledger helpers ──────────────────────────────────────────────────────────

export async function emitCronStarted(sb: SB, mode: string, limit: number): Promise<void> {
  await sb.from("brokerage_comms_ledger").insert({
    event_type: "brokerage_comms_cron_started",
    channel: "email",
    recipient_masked: "cron",
    metadata: { mode, limit },
    created_at: new Date().toISOString(),
  });
}

export async function emitCronCompleted(sb: SB, result: CronRunResult): Promise<void> {
  await sb.from("brokerage_comms_ledger").insert({
    event_type: "brokerage_comms_cron_completed",
    channel: "email",
    recipient_masked: "cron",
    metadata: { mode: result.mode, dealsProcessed: result.dealsProcessed, totalEnqueued: result.totalEnqueued, totalSkipped: result.totalSkipped, outboxSent: result.outboxSent, warnings: result.warnings.slice(0, 5) },
    created_at: new Date().toISOString(),
  });
}

export async function emitCronFailed(sb: SB, error: string): Promise<void> {
  await sb.from("brokerage_comms_ledger").insert({
    event_type: "brokerage_comms_cron_failed",
    channel: "email",
    recipient_masked: "cron",
    metadata: { error },
    created_at: new Date().toISOString(),
  }).then(() => {}, () => {});
}
