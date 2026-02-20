import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { isIntakeConfirmationGateEnabled } from "@/lib/flags/intakeConfirmationGate";
import {
  INTAKE_CONFIRMATION_VERSION,
  INTAKE_SNAPSHOT_VERSION,
  computeIntakeSnapshotHash,
} from "@/lib/intake/confirmation/types";
import { enqueueDealProcessing } from "@/lib/intake/processing/enqueueDealProcessing";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/intake/confirm
 *
 * Lock + Start Processing:
 * 1. Rejects if any docs are still UPLOADED or CLASSIFIED_PENDING_REVIEW
 * 2. Locks all docs: intake_status = LOCKED_FOR_PROCESSING
 * 3. Computes intake_snapshot_hash → stores on deals
 * 4. Sets deals.intake_phase = CONFIRMED_READY_FOR_PROCESSING
 * 5. Calls enqueueDealProcessing → runs all downstream processing
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    if (!isIntakeConfirmationGateEnabled()) {
      return NextResponse.json(
        { ok: false, error: "intake_confirmation_gate_disabled" },
        { status: 400 },
      );
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status =
        access.error === "deal_not_found" ? 404 :
        access.error === "tenant_mismatch" ? 403 : 401;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const sb = supabaseAdmin();

    // Check deal is in correct phase
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("intake_phase")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    if ((deal as any).intake_phase === "CONFIRMED_READY_FOR_PROCESSING") {
      return NextResponse.json(
        { ok: false, error: "intake_already_confirmed" },
        { status: 409 },
      );
    }

    // Reject if any docs are still unreviewed
    const { count: pendingCount, error: countErr } = await (sb as any)
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .in("intake_status", ["UPLOADED", "CLASSIFIED_PENDING_REVIEW"]);

    if (countErr) {
      return NextResponse.json(
        { ok: false, error: "count_query_failed", detail: countErr.message },
        { status: 500 },
      );
    }

    if ((pendingCount ?? 0) > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "pending_documents_exist",
          pending_count: pendingCount,
        },
        { status: 422 },
      );
    }

    // Load all docs for locking + snapshot hash
    const { data: allDocs, error: docsErr } = await (sb as any)
      .from("deal_documents")
      .select("id, canonical_type, doc_year")
      .eq("deal_id", dealId);

    if (docsErr || !allDocs?.length) {
      return NextResponse.json(
        { ok: false, error: "no_documents_found" },
        { status: 422 },
      );
    }

    const now = new Date().toISOString();

    // Lock all docs
    const { error: lockErr } = await (sb as any)
      .from("deal_documents")
      .update({
        intake_status: "LOCKED_FOR_PROCESSING",
        intake_locked_at: now,
      })
      .eq("deal_id", dealId);

    if (lockErr) {
      return NextResponse.json(
        { ok: false, error: "lock_failed", detail: lockErr.message },
        { status: 500 },
      );
    }

    // Compute snapshot hash
    const snapshotHash = computeIntakeSnapshotHash(
      allDocs.map((d: any) => ({
        id: d.id,
        canonical_type: d.canonical_type,
        doc_year: d.doc_year,
      })),
    );

    // Transition deal to CONFIRMED_READY_FOR_PROCESSING
    const { error: phaseErr } = await (sb as any)
      .from("deals")
      .update({
        intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
        intake_snapshot_hash: snapshotHash,
        intake_snapshot_version: INTAKE_SNAPSHOT_VERSION,
      })
      .eq("id", dealId);

    if (phaseErr) {
      return NextResponse.json(
        { ok: false, error: "phase_update_failed", detail: phaseErr.message },
        { status: 500 },
      );
    }

    // Emit confirmation event
    void writeEvent({
      dealId,
      kind: "intake.confirmed_ready_for_processing",
      actorUserId: access.userId,
      scope: "intake",
      meta: {
        docs_locked: allDocs.length,
        snapshot_hash: snapshotHash,
        snapshot_version: INTAKE_SNAPSHOT_VERSION,
        confirmed_by: access.userId,
        intake_confirmation_version: INTAKE_CONFIRMATION_VERSION,
      },
    });

    // Trigger downstream processing
    const result = await enqueueDealProcessing(dealId, access.bankId);

    return NextResponse.json({
      ok: true,
      dealId,
      intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
      snapshot_hash: snapshotHash,
      docs_locked: allDocs.length,
      processing: result,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[intake/confirm]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
