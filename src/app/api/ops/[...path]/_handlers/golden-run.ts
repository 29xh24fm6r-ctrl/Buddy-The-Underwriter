import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { runGoldenBrokerageRun } from "@/lib/brokerage/goldenRun";
import { hasValidBrokerageCertificationOidc } from "@/lib/auth/githubActionsOidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ops/golden-run
 *
 * Phase 9 compatibility simulator — validates synthetic table choreography:
 * intake → score → trident → seal → listing → claim → pick → unlock →
 * ops validation. It does not invoke the Final Golden Trident, release gate,
 * sealing gate, identity, SignWell, or real-route distribution. Synthetic data
 * only; lender side uses the dedicated
 * "Golden Test Bank".
 *
 * Body (all optional):
 *   { cleanup?: boolean }   — delete all golden-run rows afterward
 *                             (default true; pass false to inspect the
 *                             deal in the dashboard after the run)
 *
 * Auth: WORKER_SECRET (ops/cron) OR requireSuperAdmin()
 */
export async function POST(req: NextRequest) {
  if (!hasValidWorkerSecret(req) && !(await hasValidBrokerageCertificationOidc(req))) {
    try {
      await requireSuperAdmin();
    } catch {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  let body: { cleanup?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine — defaults apply */
  }

  const cleanup = body?.cleanup !== false;

  try {
    const sb = supabaseAdmin();
    const brokerageBankId = await getBrokerageBankId();

    const result = await runGoldenBrokerageRun({
      sb,
      brokerageBankId,
      cleanup,
    });
    const { error: evidenceError } = await sb.from("ai_events").insert({
      deal_id: null,
      scope: "golden_brokerage_run",
      action: result.ok ? "passed" : "failed",
      output_json: {
        baseline_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "unknown",
        failed_stage: result.failedStage ?? null,
        failed_reason: result.failedReason ?? null,
        elapsed_ms: result.elapsed,
        cleanup,
        evidence_class: result.evidenceClass,
      },
      confidence: 1,
      requires_human_review: !result.ok,
    });
    if (evidenceError) {
      return NextResponse.json({ ok: false, error: "golden_evidence_persistence_failed" }, { status: 500 });
    }

    return NextResponse.json(
      { ...result, cleanup },
      { status: result.ok ? 200 : 500 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
