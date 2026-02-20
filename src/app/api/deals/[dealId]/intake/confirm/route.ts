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

    // Reject if any active docs are still unreviewed
    const { count: pendingCount, error: countErr } = await (sb as any)
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("is_active", true)
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

    // E2: Quality gate — NULL or non-PASSED blocks confirmation (fail-closed)
    const { count: failedQualityCount, error: qualityErr } = await (sb as any)
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("is_active", true)
      .or("quality_status.is.null,quality_status.neq.PASSED");

    if (qualityErr) {
      return NextResponse.json(
        { ok: false, error: "quality_check_failed", detail: qualityErr.message },
        { status: 500 },
      );
    }

    if ((failedQualityCount ?? 0) > 0) {
      void writeEvent({
        dealId,
        kind: "intake.confirmation_blocked_quality_failure",
        actorUserId: access.userId,
        scope: "intake",
        meta: { failed_count: failedQualityCount },
      });
      return NextResponse.json(
        {
          ok: false,
          error: "quality_gate_failed",
          failed_count: failedQualityCount,
        },
        { status: 422 },
      );
    }

    // E3: Entity ambiguity gate — fail-closed
    // Cannot seal multiple unresolved entity-scoped docs of same type+year
    const { data: ambiguousDocs, error: ambiguityErr } = await (sb as any)
      .from("deal_documents")
      .select("canonical_type, doc_year")
      .eq("deal_id", dealId)
      .eq("is_active", true)
      .is("logical_key", null)
      .in("canonical_type", [
        "PERSONAL_TAX_RETURN",
        "PERSONAL_FINANCIAL_STATEMENT",
        "BUSINESS_TAX_RETURN",
      ]);

    if (ambiguityErr) {
      return NextResponse.json(
        { ok: false, error: "ambiguity_check_failed", detail: ambiguityErr.message },
        { status: 500 },
      );
    }

    if (ambiguousDocs && ambiguousDocs.length > 0) {
      // Group by canonical_type + doc_year, check for duplicates
      const groups = new Map<string, number>();
      for (const d of ambiguousDocs) {
        const key = `${d.canonical_type}|${d.doc_year ?? "NA"}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      const duplicateGroups = [...groups.entries()].filter(([, count]) => count > 1);

      if (duplicateGroups.length > 0) {
        void writeEvent({
          dealId,
          kind: "intake.confirmation_blocked_entity_ambiguity",
          actorUserId: access.userId,
          scope: "intake",
          meta: {
            ambiguous_groups: duplicateGroups.map(([key, count]) => ({ key, count })),
            total_unresolved: ambiguousDocs.length,
          },
        });
        return NextResponse.json(
          {
            ok: false,
            error: "entity_ambiguity_unresolved",
            ambiguous_groups: duplicateGroups.map(([key, count]) => ({ key, count })),
          },
          { status: 422 },
        );
      }
    }

    // Load all active docs for locking + snapshot hash
    const { data: allDocs, error: docsErr } = await (sb as any)
      .from("deal_documents")
      .select("id, canonical_type, doc_year, logical_key")
      .eq("deal_id", dealId)
      .eq("is_active", true);

    if (docsErr || !allDocs?.length) {
      return NextResponse.json(
        { ok: false, error: "no_documents_found" },
        { status: 422 },
      );
    }

    const now = new Date().toISOString();

    // Lock all active docs
    const { error: lockErr } = await (sb as any)
      .from("deal_documents")
      .update({
        intake_status: "LOCKED_FOR_PROCESSING",
        intake_locked_at: now,
      })
      .eq("deal_id", dealId)
      .eq("is_active", true);

    if (lockErr) {
      return NextResponse.json(
        { ok: false, error: "lock_failed", detail: lockErr.message },
        { status: 500 },
      );
    }

    // Compute snapshot hash — only identity-resolved docs (logical_key IS NOT NULL)
    const sealableDocs = allDocs.filter((d: any) => d.logical_key != null);
    const snapshotHash = computeIntakeSnapshotHash(
      sealableDocs.map((d: any) => ({
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
