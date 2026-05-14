/**
 * Phase 11K — Comms Production Hardening
 *
 * Rate limits, compliance footers, env readiness panel, observability metrics.
 */

import { getCommsMode } from "@/lib/brokerage/commsAdapters";

// ── Rate limits ─────────────────────────────────────────────────────────────

export const RATE_LIMITS = {
  maxBorrowerNudgesPerDealPerDay: 2,
  maxSmsPerBorrowerPerDay: 2,
  maxGlobalOutboxPerCronRun: 100,
};

export type RateLimitCheck = { allowed: boolean; reason?: string; current: number; max: number };

export async function checkDealNudgeRateLimit(
  dealId: string,
  sb: { from: (t: string) => any },
): Promise<RateLimitCheck> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from("brokerage_comms_outbox")
    .select("id")
    .eq("deal_id", dealId)
    .eq("trigger_key", "missing_documents");

  const todayItems = ((data ?? []) as Array<Record<string, any>>).filter(
    (r) => r.created_at && String(r.created_at).startsWith(today),
  );

  const count = todayItems.length;
  const max = RATE_LIMITS.maxBorrowerNudgesPerDealPerDay;
  return count >= max
    ? { allowed: false, reason: `deal_nudge_cap_${max}_per_day`, current: count, max }
    : { allowed: true, current: count, max };
}

export async function checkSmsBorrowerRateLimit(
  recipient: string,
  sb: { from: (t: string) => any },
): Promise<RateLimitCheck> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from("brokerage_comms_outbox")
    .select("id, created_at")
    .eq("channel", "sms")
    .eq("recipient", recipient);

  const todayItems = ((data ?? []) as Array<Record<string, any>>).filter(
    (r) => r.created_at && String(r.created_at).startsWith(today),
  );

  const count = todayItems.length;
  const max = RATE_LIMITS.maxSmsPerBorrowerPerDay;
  return count >= max
    ? { allowed: false, reason: `sms_borrower_cap_${max}_per_day`, current: count, max }
    : { allowed: true, current: count, max };
}

// ── Compliance footers ──────────────────────────────────────────────────────

const SMS_OPT_OUT = "\nReply STOP to opt out.";
const EMAIL_FOOTER = "\n\n—\nBuddy Brokerage | buddysba.com\nQuestions? Contact your Buddy representative.";

export function appendSmsCompliance(body: string): string {
  const mode = getCommsMode();
  if (mode !== "live") return body;
  if (body.includes("STOP")) return body; // already has opt-out
  return body + SMS_OPT_OUT;
}

export function appendEmailCompliance(body: string): string {
  if (body.includes("buddysba.com") || body.includes("Buddy Brokerage Team")) return body;
  return body + EMAIL_FOOTER;
}

// ── Env readiness panel (safe — no actual values) ───────────────────────────

export type CommsEnvPanel = {
  resend: "ready" | "missing";
  telnyx: "ready" | "missing";
  slack: "configured" | "not_configured";
  cron: "configured" | "missing";
  mode: string;
};

export function buildCommsEnvPanel(): CommsEnvPanel {
  return {
    resend: process.env.RESEND_API_KEY && process.env.BROKERAGE_FROM_EMAIL ? "ready" : "missing",
    telnyx: process.env.TELNYX_API_KEY && process.env.TELNYX_FROM_NUMBER ? "ready" : "missing",
    slack: process.env.BROKERAGE_SLACK_WEBHOOK_URL ? "configured" : "not_configured",
    cron: process.env.CRON_SECRET ? "configured" : "missing",
    mode: getCommsMode(),
  };
}

// ── Observability metrics ───────────────────────────────────────────────────

export type CommsMetrics = {
  byChannel: Record<string, number>;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
  retryCount: number;
  exhaustedCount: number;
  failureClasses: Record<string, number>;
};

export async function computeCommsMetrics(
  sb: { from: (t: string) => any },
): Promise<CommsMetrics> {
  const { data: outbox } = await sb
    .from("brokerage_comms_outbox")
    .select("channel, status, provider, last_failure_code");

  const rows = (outbox ?? []) as Array<Record<string, any>>;
  const byChannel: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  const failureClasses: Record<string, number> = {};
  let retryCount = 0;
  let exhaustedCount = 0;

  for (const r of rows) {
    const ch = String(r.channel ?? "unknown");
    const st = String(r.status ?? "unknown");
    const pr = String(r.provider ?? "unknown");
    byChannel[ch] = (byChannel[ch] ?? 0) + 1;
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    byProvider[pr] = (byProvider[pr] ?? 0) + 1;
    if (st === "retry_scheduled") retryCount++;
    if (st === "exhausted") exhaustedCount++;
    if (st === "failed" || st === "exhausted") {
      const fc = String(r.last_failure_code ?? "unknown");
      failureClasses[fc] = (failureClasses[fc] ?? 0) + 1;
    }
  }

  return { byChannel, byStatus, byProvider, retryCount, exhaustedCount, failureClasses };
}
