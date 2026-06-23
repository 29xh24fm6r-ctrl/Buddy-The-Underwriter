import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { runGoldenBrokerageRun } from "@/lib/brokerage/goldenRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ops/golden-run
 *
 * Phase 9 — executes the deterministic golden brokerage run end-to-end:
 * intake → score → trident → seal → listing → claim → pick → unlock →
 * ops validation. Synthetic data only; lender side uses the dedicated
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
  if (!hasValidWorkerSecret(req)) {
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

    return NextResponse.json(
      { ...result, cleanup },
      { status: result.ok ? 200 : 500 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
