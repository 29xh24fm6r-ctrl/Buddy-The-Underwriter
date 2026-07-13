/**
 * Research system critical-failure alerting.
 *
 * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md — "external alerting" open
 * item): degraded research/BIE/trust-layer outcomes were previously only
 * loud in logs and queryable via writeDegradedQualityGate()'s DB row —
 * nothing pushed to an external on-call channel. This reuses the exact
 * SLACK_WEBHOOK_URL + buddy_system_events dedup pattern already proven in
 * production by src/lib/observability/sendBankerAnalysisAlert.ts, rather
 * than inventing new alerting infrastructure. If SLACK_WEBHOOK_URL isn't
 * set, this safely no-ops (same posture as the SLA alert sender) — no new
 * credentials are required to deploy this, only to activate it.
 */

import { assertServerOnly } from "@/lib/serverOnly";
import type { SupabaseClient } from "@supabase/supabase-js";

assertServerOnly();

export const RESEARCH_ALERT_COOLDOWN_MINUTES = 30;
export const RESEARCH_ALERT_SENT_KIND = "research.critical_failure_alert_sent";

export type ResearchAlertReason = "alert_not_configured" | "cooldown" | "slack_failed" | "ok";

export type ResearchAlertResult = {
  sent: boolean;
  reason: ResearchAlertReason;
  detail?: string;
};

export type ResearchAlertInput = {
  missionId: string;
  dealId: string;
  /** The gate_id passed to writeDegradedQualityGate, e.g. "bie_exception". */
  gateId: string;
  reason: string;
  /** Test seam — production callers leave undefined. */
  _deps?: {
    sb?: SupabaseClient;
    fetchImpl?: typeof fetch;
    webhookUrl?: string | null;
    now?: Date;
  };
};

export async function sendResearchCriticalAlert(
  input: ResearchAlertInput,
): Promise<ResearchAlertResult> {
  const deps = input._deps ?? {};
  const now = deps.now ?? new Date();

  const webhookUrl =
    deps.webhookUrl !== undefined
      ? deps.webhookUrl
      : process.env.SLACK_WEBHOOK_URL ?? null;

  if (!webhookUrl) {
    // Not an error — most environments won't have this configured. The
    // failure is still fully captured via writeDegradedQualityGate's DB row
    // and the failure library; this is best-effort on top of that.
    return { sent: false, reason: "alert_not_configured" };
  }

  const sb = deps.sb ?? (await loadAdmin());
  const alertId = `${input.missionId}:${input.gateId}`;

  // 1. Cooldown check — don't re-alert on the same mission+gate every retry.
  const cooldownStart = new Date(
    now.getTime() - RESEARCH_ALERT_COOLDOWN_MINUTES * 60 * 1000,
  ).toISOString();
  try {
    const recent = await sb
      .from("buddy_system_events")
      .select("id")
      .gte("created_at", cooldownStart)
      .eq("payload->>kind", RESEARCH_ALERT_SENT_KIND)
      .eq("payload->>alert_id", alertId)
      .limit(1);
    if (Array.isArray(recent.data) && recent.data.length > 0) {
      return { sent: false, reason: "cooldown" };
    }
  } catch (e) {
    // Cooldown check failing must never block the alert itself — fail open
    // toward "send it" rather than silently swallowing a real failure.
    console.warn("[researchAlerts] cooldown check failed (proceeding to send):", e instanceof Error ? e.message : "unknown");
  }

  // 2. Post to Slack
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = buildSlackPayload(input, alertId);
  let postOk = false;
  let postDetail: string | undefined;
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      postDetail = `slack_status_${res.status}`;
    } else {
      postOk = true;
    }
  } catch (e) {
    postDetail = e instanceof Error ? e.message.slice(0, 200) : "unknown";
  }

  if (!postOk) {
    return { sent: false, reason: "slack_failed", detail: postDetail };
  }

  // 3. Record send for dedupe (best-effort — we've already posted).
  try {
    await sb.from("buddy_system_events").insert({
      event_type: "error",
      severity: "error",
      source_system: "research",
      payload: {
        kind: RESEARCH_ALERT_SENT_KIND,
        alert_id: alertId,
        mission_id: input.missionId,
        deal_id: input.dealId,
        gate_id: input.gateId,
        reason: input.reason,
      },
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    } as any);
  } catch (e) {
    console.warn("[researchAlerts] dedupe write failed (non-fatal):", e instanceof Error ? e.message : "unknown");
  }

  return { sent: true, reason: "ok" };
}

function buildSlackPayload(input: ResearchAlertInput, alertId: string): Record<string, unknown> {
  return {
    text: `[RESEARCH] Degraded mission: ${input.gateId}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `:rotating_light: Research mission degraded — ${input.gateId}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${input.reason}*` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Deal*\n${input.dealId}` },
          { type: "mrkdwn", text: `*Mission*\n${input.missionId}` },
          { type: "mrkdwn", text: `*Gate*\n${input.gateId}` },
          { type: "mrkdwn", text: `*Alert ID*\n${alertId}` },
        ],
      },
    ],
  };
}

async function loadAdmin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin();
}
