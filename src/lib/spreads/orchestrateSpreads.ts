/**
 * E2 — Spread Orchestration
 *
 * Server module — coordinates preflight, debounce, and spread enqueue.
 * NOT a queued job. Regular async function called after intake confirmation
 * or manual recompute triggers.
 *
 * Algorithm:
 *   1. Debounce check (60s active-run window)
 *   2. Run preflight
 *   3. If blocked → record run + emit event
 *   4. If passed → record run + enqueue spreads per doc + emit event
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { runSpreadPreflight } from "@/lib/spreads/preflight/runSpreadPreflight";
import { spreadsForDocType } from "@/lib/financialSpreads/docTypeToSpreadTypes";
import { enqueueSpreadRecompute } from "@/lib/financialSpreads/enqueueSpreadRecompute";
import type {
  PreflightBlocker,
  RunReason,
  SpreadRunStatus,
} from "@/lib/spreads/preflight/types";

// ── Types ────────────────────────────────────────────────────────────

export type OrchestrateResult = {
  ok: boolean;
  runId: string;
  status: SpreadRunStatus;
  blockers?: PreflightBlocker[];
};

// ── Main ─────────────────────────────────────────────────────────────

export async function orchestrateSpreads(
  dealId: string,
  bankId: string,
  trigger: RunReason,
  actorUserId?: string | null,
): Promise<OrchestrateResult> {
  const sb = supabaseAdmin();

  // ── 1. Debounce check ──────────────────────────────────────────────
  // If an active run exists within the 60s window, skip with "debounced".
  const { data: activeRun } = await (sb as any)
    .from("deal_spread_runs")
    .select("id")
    .eq("deal_id", dealId)
    .in("status", ["queued", "running"])
    .gte("created_at", new Date(Date.now() - 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeRun) {
    // Record the debounced attempt
    const { data: debouncedRow } = await (sb as any)
      .from("deal_spread_runs")
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        run_reason: trigger,
        status: "debounced",
        created_by: actorUserId ?? null,
      })
      .select("id")
      .maybeSingle();

    const debouncedId = debouncedRow?.id
      ? String(debouncedRow.id)
      : "unknown";

    // Fire-and-forget event
    writeEvent({
      dealId,
      kind: "spreads.orchestration_debounced",
      actorUserId: actorUserId ?? undefined,
      meta: {
        run_id: debouncedId,
        active_run_id: String(activeRun.id),
        trigger,
      },
    }).catch(() => {});

    return {
      ok: true,
      runId: debouncedId,
      status: "debounced",
    };
  }

  // ── 2. Run preflight ───────────────────────────────────────────────
  const preflightResult = await runSpreadPreflight(dealId);

  // ── 3. If blocked ──────────────────────────────────────────────────
  if (!preflightResult.ok) {
    const { data: blockedRow } = await (sb as any)
      .from("deal_spread_runs")
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        run_reason: trigger,
        status: "blocked",
        preflight_blockers: preflightResult.blockers,
        created_by: actorUserId ?? null,
      })
      .select("id")
      .maybeSingle();

    const blockedId = blockedRow?.id ? String(blockedRow.id) : "unknown";

    writeEvent({
      dealId,
      kind: "spreads.preflight_blocked",
      actorUserId: actorUserId ?? undefined,
      meta: {
        run_id: blockedId,
        blockers: preflightResult.blockers,
        blocker_count: preflightResult.blockers.length,
        trigger,
      },
    }).catch(() => {});

    return {
      ok: false,
      runId: blockedId,
      status: "blocked",
      blockers: preflightResult.blockers,
    };
  }

  // ── 4. Preflight passed — enqueue spreads ──────────────────────────
  const snapshot = preflightResult.snapshot;
  const warnings = preflightResult.warnings;

  const { data: runRow } = await (sb as any)
    .from("deal_spread_runs")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      run_reason: trigger,
      status: "queued",
      computed_snapshot_hash: snapshot.computedHash,
      started_at: new Date().toISOString(),
      created_by: actorUserId ?? null,
    })
    .select("id")
    .maybeSingle();

  const runId = runRow?.id ? String(runRow.id) : "unknown";

  writeEvent({
    dealId,
    kind: "spreads.preflight_passed",
    actorUserId: actorUserId ?? undefined,
    meta: {
      run_id: runId,
      doc_count: snapshot.docCount,
      spread_types: snapshot.spreadTypes,
      computed_hash: snapshot.computedHash,
      trigger,
      warnings: warnings?.map((w) => w.code),
    },
  }).catch(() => {});

  // Load active docs to get per-doc spread types + sourceDocumentId
  const { data: activeDocs } = await (sb as any)
    .from("deal_documents")
    .select("id, canonical_type")
    .eq("deal_id", dealId)
    .eq("is_active", true);

  // Enqueue spreads per doc (preserves sourceDocumentId for owner resolution)
  const enqueueErrors: string[] = [];
  for (const doc of activeDocs ?? []) {
    if (!doc.canonical_type) continue;
    const spreadTypes = spreadsForDocType(doc.canonical_type);
    if (spreadTypes.length === 0) continue;

    try {
      await enqueueSpreadRecompute({
        dealId,
        bankId,
        sourceDocumentId: doc.id,
        spreadTypes,
        skipPrereqCheck: true,
        meta: {
          source: "orchestrator",
          run_id: runId,
          trigger,
        },
      });
    } catch (err: any) {
      enqueueErrors.push(`${doc.id}:${err?.message}`);
    }
  }

  // Update run status to running
  await (sb as any)
    .from("deal_spread_runs")
    .update({
      status: "running",
      spread_job_id: null, // job IDs are managed by enqueueSpreadRecompute
    })
    .eq("id", runId);

  writeEvent({
    dealId,
    kind: "spreads.orchestration_started",
    actorUserId: actorUserId ?? undefined,
    meta: {
      run_id: runId,
      trigger,
      spread_count: snapshot.spreadTypes.length,
      enqueue_errors: enqueueErrors.length > 0 ? enqueueErrors : undefined,
    },
  }).catch(() => {});

  return {
    ok: true,
    runId,
    status: "queued",
  };
}
