/**
 * Banker analysis SLA alert sender.
 *
 * Posts a structured Slack message for each SLA alert produced by the
 * aggregator (`computeAlerts` in bankerAnalysisSla.ts) and records the send
 * in `buddy_system_events` for dedupe.
 *
 * Why `buddy_system_events`:
 *   `deal_events` requires NOT NULL `deal_id` (FK to `deals`), but SLA
 *   alerts are system-level — not scoped to any deal. `buddy_system_events`
 *   is the existing system event table with no `deal_id` requirement.
 *
 * Dedupe rule:
 *   Skip a send if any `buddy_system_events` row exists with
 *     payload.kind     = 'banker_analysis.sla_alert_sent'
 *     payload.alert_id = <id>
 *     created_at       > now() - 30 minutes
 *
 * Failure modes (none throw):
 *   - SLACK_WEBHOOK_URL missing → return { sent: false, reason: 'alert_not_configured' }
 *   - Cooldown hit             → { sent: false, reason: 'cooldown' }
 *   - Slack 4xx/5xx            → { sent: false, reason: 'slack_failed', detail: ... }
 *   - DB write failure         → still returns sent:true (already posted), logs warning
 */

import { assertServerOnly } from "@/lib/serverOnly";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SlaAlert,
  BankerAnalysisSlaResponse,
} from "./bankerAnalysisSla";

assertServerOnly();

export const COOLDOWN_MINUTES = 30;
export const ALERT_SENT_KIND = "banker_analysis.sla_alert_sent";
const SYSTEM_EVENT_TYPE = "info"; // AegisEventType (existing enum)
const SYSTEM_EVENT_SOURCE = "observer"; // AegisSourceSystem (existing enum)

export type SendAlertReason =
  | "alert_not_configured"
  | "cooldown"
  | "slack_failed"
  | "ok";

export type SendAlertResult = {
  sent: boolean;
  reason: SendAlertReason;
  detail?: string;
};

export type SendAlertInput = {
  alert: SlaAlert;
  metricsSummary: BankerAnalysisSlaResponse;
  /** Origin (e.g. https://app.example.com). Used to build the metrics link. */
  appUrl?: string | null;
  /** Test seam — production callers leave undefined. */
  _deps?: {
    sb?: SupabaseClient;
    fetchImpl?: typeof fetch;
    webhookUrl?: string | null;
    now?: Date;
  };
};

export async function sendBankerAnalysisAlert(
  input: SendAlertInput,
): Promise<SendAlertResult> {
  const deps = input._deps ?? {};
  const now = deps.now ?? new Date();

  const webhookUrl =
    deps.webhookUrl !== undefined
      ? deps.webhookUrl
      : process.env.SLACK_WEBHOOK_URL ?? null;

  if (!webhookUrl) {
    console.warn("[bankerAnalysisAlert] alert_not_configured — SLACK_WEBHOOK_URL missing");
    return { sent: false, reason: "alert_not_configured" };
  }

  const sb = deps.sb ?? (await loadAdmin());

  // 1. Cooldown check
  const cooldownStart = new Date(
    now.getTime() - COOLDOWN_MINUTES * 60 * 1000,
  ).toISOString();
  const recent = await sb
    .from("buddy_system_events")
    .select("id, created_at, payload")
    .gte("created_at", cooldownStart)
    .eq("payload->>kind", ALERT_SENT_KIND)
    .eq("payload->>alert_id", input.alert.id)
    .limit(1);
  if (Array.isArray(recent.data) && recent.data.length > 0) {
    return { sent: false, reason: "cooldown" };
  }

  // 2. Post to Slack
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = buildSlackPayload(input);
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

  // 3. Record send for dedupe
  try {
    await sb.from("buddy_system_events").insert({
      event_type: SYSTEM_EVENT_TYPE,
      severity: input.alert.severity === "error" ? "error" : "warning",
      source_system: SYSTEM_EVENT_SOURCE,
      payload: {
        kind: ALERT_SENT_KIND,
        alert_id: input.alert.id,
        severity: input.alert.severity,
        message: input.alert.message,
        window_hours: input.metricsSummary.windowHours,
        generated_at: input.metricsSummary.generatedAt,
      },
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    } as any);
  } catch (e) {
    // Dedupe write is best-effort. We've already posted to Slack.
    console.warn(
      "[bankerAnalysisAlert] dedupe write failed (non-fatal):",
      e instanceof Error ? e.message : "unknown",
    );
  }

  return { sent: true, reason: "ok" };
}

// ─── Slack payload ───────────────────────────────────────────────────────────

function buildSlackPayload(input: SendAlertInput): Record<string, unknown> {
  const { alert, metricsSummary, appUrl } = input;
  const link = buildMetricsLink(appUrl, metricsSummary.windowHours);
  const summary = summarizeMetrics(metricsSummary);

  return {
    text: `[${alert.severity.toUpperCase()}] Banker Analysis SLA: ${alert.id}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${severityEmoji(alert.severity)} Banker Analysis SLA: ${alert.id}`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${alert.message}*` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Severity*\n${alert.severity}` },
          { type: "mrkdwn", text: `*Window*\n${metricsSummary.windowHours}h` },
          {
            type: "mrkdwn",
            text: `*Generated*\n${metricsSummary.generatedAt}`,
          },
          { type: "mrkdwn", text: `*p95 latency*\n${summary.p95}` },
          { type: "mrkdwn", text: `*Failures*\n${summary.failures}` },
          {
            type: "mrkdwn",
            text: `*Stale recoveries*\n${metricsSummary.staleRecoveries}`,
          },
          {
            type: "mrkdwn",
            text: `*Retry success*\n${summary.retry}`,
          },
          {
            type: "mrkdwn",
            text: `*Run volume*\n${metricsSummary.runVolume}`,
          },
        ],
      },
      ...(link
        ? [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `<${link}|View metrics endpoint>`,
                },
              ],
            },
          ]
        : []),
    ],
  };
}

function severityEmoji(s: SlaAlert["severity"]): string {
  return s === "error" ? ":rotating_light:" : ":warning:";
}

function summarizeMetrics(m: BankerAnalysisSlaResponse): {
  p95: string;
  failures: string;
  retry: string;
} {
  const p95 =
    m.latency.p95Seconds === null
      ? "—"
      : `${m.latency.p95Seconds.toFixed(1)}s`;
  const failures = m.failures.total === 0
    ? "0"
    : `${m.failures.total} (${m.failures.byCode
        .slice(0, 3)
        .map((f) => `${f.code}=${f.count}`)
        .join(", ")})`;
  const retry =
    m.retry.successRate === null
      ? "—"
      : `${(m.retry.successRate * 100).toFixed(0)}% (${m.retry.recoveredDeals}/${m.retry.failedRunsInWindow})`;
  return { p95, failures, retry };
}

function buildMetricsLink(
  appUrl: string | null | undefined,
  windowHours: number,
): string | null {
  const base = appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/api/observability/banker-analysis?windowHours=${windowHours}`;
}

async function loadAdmin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin();
}
