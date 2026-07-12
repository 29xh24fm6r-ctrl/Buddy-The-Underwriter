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
import { updateDealIfRunOwner } from "@/lib/intake/processing/updateDealIfRunOwner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — durable processing window

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  let dealId: string | undefined;
  let runId: string | undefined;

  try {

    const params = await ctx.params;
    dealId = params.dealId;

    // Banker role gate — must be super_admin, bank_admin, or underwriter
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

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

    const staleRunId = (dealData as any)?.intake_processing_run_id ?? undefined;

    if (!staleRunId) {
      return NextResponse.json(
        { ok: false, error: "no_run_id", detail: "Deal has no processing run_id. Confirm intake first." },
        { status: 400 },
      );
    }

    // Mint a fresh run_id and CAS-claim off the stale one before processing —
    // mirrors processing/kick/route.ts. Without this, re-reading and reusing
    // the existing run_id lets a double-click or concurrent request pass the
    // same CAS checks twice, running matching/extraction fan-out in duplicate.
    runId = crypto.randomUUID();
    const casClaimed = await updateDealIfRunOwner(dealId, staleRunId, {
      intake_processing_run_id: runId,
    });

    if (!casClaimed) {
      return NextResponse.json(
        {
          ok: false,
          error: "already_processing",
          detail: "Another processing run is already active for this deal.",
        },
        { status: 409 },
      );
    }

    await runIntakeProcessing(dealId, bankId, runId);

    return NextResponse.json({ ok: true, dealId, runId });
  } catch (error: any) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", detail: error.message },
        { status: 403 },
      );
    }

    console.error("[intake/process] unexpected error", { dealId, runId, error: error?.message });
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
