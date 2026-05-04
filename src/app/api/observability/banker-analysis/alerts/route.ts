/**
 * POST /api/observability/banker-analysis/alerts
 *
 * Cron-safe alert dispatcher. Pulls SLA alerts from
 * `loadBankerAnalysisSla({ windowHours: 24 })` and forwards them to Slack
 * via `sendBankerAnalysisAlert`, with 30-minute per-alert dedupe.
 *
 * Auth (any one):
 *   - `Authorization: Bearer <CRON_SECRET>` (Vercel cron injects this)
 *   - super-admin Clerk session
 *
 * Feature flag:
 *   `BANKER_ANALYSIS_ALERTS_ENABLED=true` is required. Otherwise the route
 *   short-circuits with `{ ok: true, disabled: true }` so the cron entry is
 *   safe to land before secrets are configured.
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

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  if (hasValidWorkerSecret(req)) return null;
  try {
    await requireSuperAdmin();
    return null;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "unauthorized") {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
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

function alertsEnabled(): boolean {
  return process.env.BANKER_ANALYSIS_ALERTS_ENABLED === "true";
}

export async function POST(req: NextRequest) {
  try {
    const authError = await authorize(req);
    if (authError) return authError;

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
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[observability/banker-analysis/alerts] error", err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
