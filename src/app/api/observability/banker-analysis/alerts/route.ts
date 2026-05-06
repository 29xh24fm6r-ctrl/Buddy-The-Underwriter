/**
 * /api/observability/banker-analysis/alerts
 *
 * Cron-driven alert dispatcher. Pulls SLA alerts from
 * `loadBankerAnalysisSla({ windowHours: 24 })` and forwards them to Slack
 * via `sendBankerAnalysisAlert`, with 30-minute per-alert dedupe.
 *
 * Methods:
 *   - GET  — Vercel cron path. Requires CRON_SECRET via
 *            hasValidWorkerSecret. **No super-admin fallback** — a logged-in
 *            admin must NOT be able to trigger this by navigating to the
 *            URL in a browser.
 *   - POST — Manual / scripted trigger. Allows CRON_SECRET OR super-admin
 *            Clerk session for ad-hoc operator runs.
 *
 * Both methods share `dispatchBankerAnalysisAlerts()`.
 *
 * Feature flag:
 *   `BANKER_ANALYSIS_ALERTS_ENABLED=true` is required. Otherwise both
 *   methods short-circuit with `{ ok: true, disabled: true }` so the cron
 *   entry is safe to land before secrets are configured.
 */

import "server-only";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { loadBankerAnalysisSla } from "@/lib/observability/bankerAnalysisSla";
import { sendBankerAnalysisAlert } from "@/lib/observability/sendBankerAnalysisAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function alertsEnabled(): boolean {
  return process.env.BANKER_ANALYSIS_ALERTS_ENABLED === "true";
}

// Shared dispatch — both GET and POST funnel through here once auth + flag
// have been validated. No request-specific behaviour lives below this line.
async function dispatchBankerAnalysisAlerts(): Promise<NextResponse> {
  if (!alertsEnabled()) {
    return NextResponse.json({ ok: true, disabled: true });
  }

  const sla = await loadBankerAnalysisSla({ windowHours: 24 });
  if (sla.alerts.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      skipped: 0,
      alerts: [],
    });
  }

  const results: Array<{
    id: string;
    severity: string;
    sent: boolean;
    reason?: string;
  }> = [];
  let sent = 0;
  let skipped = 0;

  for (const alert of sla.alerts) {
    const r = await sendBankerAnalysisAlert({
      alert,
      metricsSummary: sla,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
    });
    results.push({
      id: alert.id,
      severity: alert.severity,
      sent: r.sent,
      reason: r.sent ? undefined : r.reason,
    });
    if (r.sent) sent++;
    else skipped++;
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    alerts: results,
  });
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401 },
  );
}

// GET — Vercel cron only. CRON_SECRET required, no super-admin fallback.
export async function GET(req: NextRequest) {
  try {
    if (!hasValidWorkerSecret(req)) return unauthorized();
    return await dispatchBankerAnalysisAlerts();
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[observability/banker-analysis/alerts:GET] error", err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}

// POST — manual / scripted trigger. CRON_SECRET OR super-admin.
export async function POST(req: NextRequest) {
  try {
    if (!hasValidWorkerSecret(req)) {
      try {
        await requireSuperAdmin();
      } catch (authErr: any) {
        const msg = String(authErr?.message ?? authErr);
        if (msg === "unauthorized") return unauthorized();
        if (msg === "forbidden") {
          return NextResponse.json(
            { ok: false, error: "forbidden" },
            { status: 403 },
          );
        }
        return NextResponse.json(
          { ok: false, error: msg },
          { status: 500 },
        );
      }
    }
    return await dispatchBankerAnalysisAlerts();
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[observability/banker-analysis/alerts:POST] error", err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
