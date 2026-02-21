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
import { computeAllBlockers } from "@/lib/intake/confirmation/computeDocBlockers";
import type { ActiveDoc } from "@/lib/intake/confirmation/computeDocBlockers";
import { enqueueDealProcessing } from "@/lib/intake/processing/enqueueDealProcessing";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { MAX_PROCESSING_WINDOW_MS } from "@/lib/intake/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/intake/confirm
 *
 * E1.2 God Tier — Single-pass fail-closed confirmation gate.
 *
 * 1. Loads all active docs in ONE query
 * 2. Computes per-doc blockers (E1–E4: confirmation, quality, segmentation, ambiguity, classification, year)
 * 3. Rejects with structured per-doc blocker response if any doc blocked
 * 4. If clean: locks all docs, computes snapshot hash, transitions deal, enqueues processing
 *
 * Supports ?dry_run=true — returns blockers without mutating.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
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

    const isDryRun = req.nextUrl.searchParams.get("dry_run") === "true";
    const sb = supabaseAdmin();

    // ── Deal phase check ───────────────────────────────────────────────
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
      // Lock TTL guard — if processing has been stuck longer than
      // MAX_PROCESSING_WINDOW_MS, auto-recover by transitioning to error
      // state so the banker can retry.
      const { data: lockCheck } = await (sb as any)
        .from("deal_documents")
        .select("intake_locked_at")
        .eq("deal_id", dealId)
        .eq("is_active", true)
        .eq("intake_status", "LOCKED_FOR_PROCESSING")
        .order("intake_locked_at", { ascending: true })
        .limit(1);

      const oldestLock = lockCheck?.[0]?.intake_locked_at;
      const lockAge = oldestLock
        ? Date.now() - new Date(oldestLock).getTime()
        : Infinity;

      if (lockAge > MAX_PROCESSING_WINDOW_MS) {
        // Stale lock detected — transition to error state for recovery
        void writeEvent({
          dealId,
          kind: "intake.processing_timeout_recovery",
          actorUserId: access.userId,
          scope: "intake",
          meta: {
            lock_age_ms: lockAge,
            max_processing_window_ms: MAX_PROCESSING_WINDOW_MS,
            oldest_lock_at: oldestLock,
          },
        });

        await (sb as any)
          .from("deals")
          .update({ intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS" })
          .eq("id", dealId);

        // Fall through to allow re-confirmation below
      } else {
        return NextResponse.json(
          { ok: false, error: "intake_already_confirmed" },
          { status: 409 },
        );
      }
    }

    // ── Single-pass: Load all active docs (E1.2 refactor) ─────────────
    const { data: rawDocs, error: docsErr } = await (sb as any)
      .from("deal_documents")
      .select(
        "id, original_filename, intake_status, quality_status, segmented, " +
        "canonical_type, doc_year, logical_key",
      )
      .eq("deal_id", dealId)
      .eq("is_active", true);

    if (docsErr) {
      return NextResponse.json(
        { ok: false, error: "doc_load_failed", detail: docsErr.message },
        { status: 500 },
      );
    }

    if (!rawDocs || rawDocs.length === 0) {
      return NextResponse.json(
        { ok: false, error: "no_documents_found" },
        { status: 422 },
      );
    }

    // Cast to ActiveDoc shape for pure blocker computation
    const activeDocs: ActiveDoc[] = (rawDocs as any[]).map((d) => ({
      id: d.id,
      original_filename: d.original_filename,
      intake_status: d.intake_status,
      quality_status: d.quality_status,
      segmented: d.segmented ?? null,
      canonical_type: d.canonical_type,
      doc_year: d.doc_year,
      logical_key: d.logical_key,
    }));

    // ── E1-E4: Compute per-doc blockers (pure) ────────────────────────
    const { blocked_documents, summary } = computeAllBlockers(activeDocs);

    if (blocked_documents.length > 0) {
      // Emit consolidated blocker event
      void writeEvent({
        dealId,
        kind: "intake.confirmation_blocked",
        actorUserId: access.userId,
        scope: "intake",
        meta: {
          summary,
          blocked_count: blocked_documents.length,
          total_active: activeDocs.length,
          intake_confirmation_version: INTAKE_CONFIRMATION_VERSION,
        },
      });

      return NextResponse.json(
        {
          ok: false,
          error: "confirmation_blocked",
          blocked_documents,
          summary,
        },
        { status: 422 },
      );
    }

    // ── Dry run: return clean status without mutating ──────────────────
    if (isDryRun) {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        blocked_documents: [],
        summary,
      });
    }

    // ── All gates passed — lock, seal, process ────────────────────────
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
    const sealableDocs = activeDocs.filter((d) => d.logical_key != null);
    const snapshotHash = computeIntakeSnapshotHash(
      sealableDocs.map((d) => ({
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
        docs_locked: activeDocs.length,
        snapshot_hash: snapshotHash,
        snapshot_version: INTAKE_SNAPSHOT_VERSION,
        confirmed_by: access.userId,
        intake_confirmation_version: INTAKE_CONFIRMATION_VERSION,
      },
    });

    // Trigger downstream processing (fire-and-forget — do NOT await)
    // Processing runs in the background; UI polls for PROCESSING_COMPLETE.
    // This prevents Vercel 504 timeouts on large document sets.
    void enqueueDealProcessing(dealId, access.bankId).catch((err) => {
      console.error("[intake/confirm] background processing failed", {
        dealId,
        error: err?.message,
      });
    });

    return NextResponse.json({
      ok: true,
      dealId,
      intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
      snapshot_hash: snapshotHash,
      docs_locked: activeDocs.length,
      processing_queued: true,
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
