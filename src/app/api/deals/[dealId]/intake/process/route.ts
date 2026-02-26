/**
 * POST /api/deals/[dealId]/intake/process
 *
 * Thin wrapper for manual re-trigger of intake processing by a banker.
 * Primary processing is driven by the durable outbox consumer
 * (/api/workers/intake-outbox). This route exists for manual re-triggers only.
 *
 * Auth: Clerk banker (super_admin, bank_admin, underwriter)
 *
 * Delegates all orchestration to runIntakeProcessing() which guarantees
 * terminal phase transition on any failure path.
 *
 * maxDuration = 300 (5 minutes) — Vercel durable processing window.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runIntakeProcessing } from "@/lib/intake/processing/runIntakeProcessing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — durable processing window

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  let dealId: string | undefined;
  let runId: string | undefined;

  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

    const params = await ctx.params;
    dealId = params.dealId;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const bankId = access.bankId;

    // Read runId from deal (stamped by /intake/confirm's finalize RPC)
    const sb = supabaseAdmin();
    const { data: dealData } = await sb
      .from("deals")
      .select("intake_processing_run_id")
      .eq("id", dealId)
      .maybeSingle();

    runId = (dealData as any)?.intake_processing_run_id ?? undefined;

    if (!runId) {
      return NextResponse.json(
        { ok: false, error: "no_run_id", detail: "Deal has no processing run_id. Confirm intake first." },
        { status: 400 },
      );
    }

    await runIntakeProcessing(dealId, bankId, runId);

    return NextResponse.json({ ok: true, dealId, runId });
  } catch (error: any) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[intake/process] unexpected error", { dealId, runId, error: error?.message });
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
