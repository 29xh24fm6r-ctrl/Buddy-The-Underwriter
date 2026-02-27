/**
 * POST /api/deals/[dealId]/intake/processing/kick
 *
 * Manual safety valve: re-enqueues intake processing via the outbox.
 *
 * Invariants:
 * - NEVER calls runIntakeProcessing() directly — all processing enters through the outbox.
 * - CAS on run_id prevents clobbering concurrent runs.
 * - Emits intake.processing_manual_kick ledger event for observability.
 *
 * Auth: Clerk banker (super_admin, bank_admin, underwriter)
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { insertOutboxEvent } from "@/lib/outbox/insertOutboxEvent";
import { updateDealIfRunOwner } from "@/lib/intake/processing/updateDealIfRunOwner";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { PROCESSING_OBSERVABILITY_VERSION } from "@/lib/intake/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const bankId = access.bankId;
    const sb = supabaseAdmin();

    // ── Read deal state ──────────────────────────────────────────────────
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("intake_phase, intake_processing_run_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    const phase = (deal as any).intake_phase as string | null;
    const staleRunId = (deal as any).intake_processing_run_id as string | null;

    // ── Phase guard ──────────────────────────────────────────────────────
    if (phase !== "CONFIRMED_READY_FOR_PROCESSING") {
      return NextResponse.json(
        {
          ok: false,
          error: "phase_not_confirmed",
          intake_phase: phase,
          detail: "Deal is not in CONFIRMED_READY_FOR_PROCESSING phase.",
        },
        { status: 409 },
      );
    }

    // ── Generate fresh run markers ───────────────────────────────────────
    const newRunId = crypto.randomUUID();
    const now = new Date().toISOString();

    const casUpdated = await updateDealIfRunOwner(dealId, staleRunId ?? undefined, {
      intake_processing_queued_at: now,
      intake_processing_started_at: null,
      intake_processing_run_id: newRunId,
      intake_processing_last_heartbeat_at: null,
      intake_processing_error: null,
    });

    if (!casUpdated) {
      // Another recovery path beat us — deal is no longer stuck with our stale run_id.
      return NextResponse.json({
        ok: true,
        action: "cas_conflict",
        detail: "Another recovery or processing run is already active.",
      });
    }

    // ── Enqueue outbox row (the ONLY path to processing) ─────────────────
    await insertOutboxEvent({
      kind: "intake.process",
      dealId,
      bankId,
      payload: {
        deal_id: dealId,
        run_id: newRunId,
        reason: "manual_kick",
      },
    });

    // ── Ledger event ─────────────────────────────────────────────────────
    void writeEvent({
      dealId,
      kind: "intake.processing_manual_kick",
      scope: "intake",
      meta: {
        run_id: newRunId,
        previous_run_id: staleRunId ?? null,
        observability_version: PROCESSING_OBSERVABILITY_VERSION,
      },
    });

    return NextResponse.json({
      ok: true,
      action: "enqueued",
      run_id: newRunId,
      previous_run_id: staleRunId,
    });
  } catch (error: unknown) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const msg = error instanceof Error ? error.message : "unexpected_error";
    console.error("[intake/processing/kick] error:", msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}
