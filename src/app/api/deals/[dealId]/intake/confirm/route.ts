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
import { detectStuckProcessing } from "@/lib/intake/processing/detectStuckProcessing";
import { updateDealIfRunOwner } from "@/lib/intake/processing/updateDealIfRunOwner";
import { computeDealPhasePatch } from "@/lib/intake/processing/computeDealPhasePatch";
import { PROCESSING_OBSERVABILITY_VERSION } from "@/lib/intake/constants";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitPipelineEvent } from "@/lib/pulseMcp/emitPipelineEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
      .select(
        "intake_phase, intake_processing_queued_at, intake_processing_started_at, " +
        "intake_processing_last_heartbeat_at, intake_processing_run_id",
      )
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    if ((deal as any).intake_phase === "CONFIRMED_READY_FOR_PROCESSING") {
      // Stuck detection — replaces coarse lock TTL guard with run-marker awareness
      const queuedAt = (deal as any).intake_processing_queued_at ?? null;
      const confirmedSinceMs = queuedAt ? new Date(queuedAt as string).getTime() : undefined;

      const verdict = detectStuckProcessing(
        {
          intake_phase: (deal as any).intake_phase,
          intake_processing_queued_at: queuedAt,
          intake_processing_started_at: (deal as any).intake_processing_started_at ?? null,
          intake_processing_last_heartbeat_at: (deal as any).intake_processing_last_heartbeat_at ?? null,
          intake_processing_run_id: (deal as any).intake_processing_run_id ?? null,
        },
        Date.now(),
        confirmedSinceMs,
      );

      if (verdict.stuck) {
        const staleRunId: string | undefined = (deal as any).intake_processing_run_id ?? undefined;

        void writeEvent({
          dealId,
          kind: "intake.processing_stuck_recovery",
          actorUserId: access.userId,
          scope: "intake",
          meta: {
            reason: verdict.reason,
            age_ms: verdict.age_ms,
            previous_run_id: staleRunId ?? null,
            observability_version: PROCESSING_OBSERVABILITY_VERSION,
          },
        });

        await updateDealIfRunOwner(dealId, staleRunId, computeDealPhasePatch(
          "PROCESSING_COMPLETE_WITH_ERRORS",
          { errorSummary: `stuck_recovery: ${verdict.reason}` },
        ));

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

    // ── In-flight artifact guard — fail closed ──────────────────────
    // Buddy does not allow sealing while work is in-flight.
    // No best guesses. No partial states.
    const { count: inFlightCount } = await (sb as any)
      .from("document_artifacts")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .in("status", ["queued", "processing"]);

    if ((inFlightCount ?? 0) > 0) {
      void writeEvent({
        dealId,
        kind: "intake.confirmation_blocked_inflight",
        actorUserId: access.userId,
        scope: "intake",
        meta: { in_flight_count: inFlightCount },
      });

      return NextResponse.json(
        {
          ok: false,
          error: "artifacts_in_flight",
          in_flight_count: inFlightCount,
          message: "Documents are still being classified. Please wait a moment and try again.",
        },
        { status: 409 },
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

      // Derive REQUIRED_ACTIONS from blocker summary so banker knows exactly what to fix
      const requiredActions: string[] = [];
      if (summary.needs_intake_review > 0) requiredActions.push(`Confirm ${summary.needs_intake_review} pending document(s) in intake review`);
      if (summary.quality_not_passed > 0) requiredActions.push(`Re-upload ${summary.quality_not_passed} document(s) that failed quality checks`);
      if (summary.segmented_parent > 0) requiredActions.push(`Wait for ${summary.segmented_parent} document(s) still being segmented`);
      if (summary.unclassified > 0) requiredActions.push(`Classify ${summary.unclassified} unclassified document(s)`);
      if (summary.entity_ambiguous > 0) requiredActions.push(`Assign entity for ${summary.entity_ambiguous} ambiguous document(s)`);
      if (summary.missing_required_year > 0) requiredActions.push(`Set year for ${summary.missing_required_year} document(s) missing doc_year`);

      return NextResponse.json(
        {
          ok: false,
          error: "confirmation_blocked",
          blocked_documents,
          summary,
          REQUIRED_ACTIONS: requiredActions,
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
    const runId = crypto.randomUUID();

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

    // ── Checklist truth: safety net before deal enters cockpit ────────────
    // Belt-and-suspenders alongside the per-doc reconcile. Ensures deal_checklist_items
    // reflects all manual corrections before the deal is visible in the cockpit as
    // CONFIRMED_READY_FOR_PROCESSING — no false "missing documents" blockers.
    const reconcileStartMs = Date.now();
    try {
      const { reconcileChecklistForDeal } = await import("@/lib/checklist/engine");
      const r = await reconcileChecklistForDeal({ sb, dealId });
      const durationMs = Date.now() - reconcileStartMs;

      void writeEvent({
        dealId,
        kind: "checklist.reconciled",
        scope: "checklist",
        actorUserId: access.userId,
        meta: {
          trigger: "intake_confirm",
          route: "/api/deals/[dealId]/intake/confirm",
          duration_ms: durationMs,
          updated: (r as any)?.updated ?? null,
          note: "non_blocking",
        },
      });

      void logLedgerEvent({
        dealId,
        bankId: access.bankId ?? "",
        eventKey: "deal.checklist.reconciled",
        uiState: "done",
        uiMessage: "Checklist reconciled (intake confirm)",
        meta: { trigger: "intake_confirm", duration_ms: durationMs, updated: (r as any)?.updated ?? null },
      });

      void emitPipelineEvent({
        kind: "checklist_reconciled",
        deal_id: dealId,
        bank_id: access.bankId,
        payload: { trigger: "intake_confirm", duration_ms: durationMs, updated: (r as any)?.updated ?? null },
      });
    } catch (reconcileErr: any) {
      // Non-blocking — reconciliation failure must not block intake confirmation
      console.error("[intake/confirm] checklist reconcile failed:", (reconcileErr as any)?.message);
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

    // ── ATOMIC INVARIANT: finalize_intake_and_enqueue_processing RPC ──
    // Single Postgres transaction guarantees ALL-or-NOTHING:
    //   (a) Stamp quality_status='PASSED' + finalized_at on ALL active docs (idempotent)
    //   (b) Emit intake.documents_finalized event into deal_events
    //   (c) Insert intake.process outbox row into buddy_outbox_events
    //   (d) Transition deal to CONFIRMED_READY_FOR_PROCESSING + stamp run markers
    // Fail closed: any step failure rolls back the entire transaction.
    const { data: rpcResult, error: rpcErr } = await (sb as any).rpc(
      "finalize_intake_and_enqueue_processing",
      {
        p_deal_id: dealId,
        p_run_id: runId,
        p_bank_id: access.bankId ?? null,
        p_snapshot_hash: snapshotHash,
        p_snapshot_version: INTAKE_SNAPSHOT_VERSION,
        p_confirmed_by: access.userId,
        p_docs_locked: activeDocs.length,
      },
    );

    if (rpcErr) {
      return NextResponse.json(
        { ok: false, error: "finalize_rpc_failed", detail: rpcErr.message },
        { status: 500 },
      );
    }

    const stampedDocIds: string[] = (rpcResult as any)?.stamped_doc_ids ?? [];

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
        run_id: runId,
        observability_version: PROCESSING_OBSERVABILITY_VERSION,
      },
    });

    // Processing is triggered exclusively via the durable outbox consumer.
    // The finalize RPC (above) atomically inserted an intake.process outbox row.
    // The /api/workers/intake-outbox cron picks it up within 60s.
    // No HTTP handoff. No void fetch(). No background promises.

    return NextResponse.json({
      ok: true,
      dealId,
      intake_phase: "CONFIRMED_READY_FOR_PROCESSING",
      snapshot_hash: snapshotHash,
      docs_locked: activeDocs.length,
      processing_queued: true,
      run_id: runId,
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
