/**
 * Durable outbox consumer for per-document extraction.
 *
 * Claims 'doc.extract' rows from buddy_outbox_events via FOR UPDATE SKIP LOCKED.
 * Runs extractByDocType() for each claimed doc.
 * After each success: triggers deal-level recomputation (spreads, facts, readiness).
 *
 * Called by: /api/workers/doc-extraction (Vercel Cron, every 1 min)
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractByDocType } from "@/lib/extract/router/extractByDocType";
import { writeEvent } from "@/lib/ledger/writeEvent";

const DEAD_LETTER_THRESHOLD = 5;
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_CAP_SECONDS = 3600;

export type DocExtractionResult = {
  claimed: number;
  processed: number;
  failed: number;
  dead_lettered: number;
};

interface ClaimedRow {
  id: string;
  deal_id: string;
  bank_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

function backoffSeconds(attempts: number): number {
  return Math.min(Math.pow(2, attempts) * BACKOFF_BASE_SECONDS, BACKOFF_CAP_SECONDS);
}

export async function processDocExtractionOutbox(
  maxRows?: number,
): Promise<DocExtractionResult> {
  const sb = supabaseAdmin();
  const claimOwner = `vercel-doc-extract-${Date.now()}`;

  const { data: rows, error: claimErr } = await sb.rpc(
    "claim_doc_extraction_outbox_batch",
    {
      p_claim_owner: claimOwner,
      p_claim_ttl_seconds: 300,
      p_limit: maxRows ?? 10,
    },
  );

  if (claimErr) {
    console.error("[doc-extraction] claim RPC failed:", claimErr.message);
    return { claimed: 0, processed: 0, failed: 0, dead_lettered: 0 };
  }

  const claimed = (rows as ClaimedRow[] | null) ?? [];
  if (claimed.length === 0) {
    return { claimed: 0, processed: 0, failed: 0, dead_lettered: 0 };
  }

  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of claimed) {
    const docId = (row.payload as any)?.doc_id as string | undefined;
    const dealId = row.deal_id;
    const bankId = row.bank_id;

    if (!docId || !bankId) {
      console.error("[doc-extraction] missing docId or bankId in outbox row", {
        rowId: row.id,
        dealId,
      });
      await markFailed(sb, row.id, "missing_doc_id_or_bank_id", row.attempts);
      failed += 1;
      continue;
    }

    const startMs = Date.now();
    try {
      console.log("[doc-extraction] starting extraction", { rowId: row.id, docId, dealId });

      const forceRefresh = (row.payload as any)?.force_refresh === true;
      await extractByDocType(docId, { forceRefresh });

      const elapsedMs = Date.now() - startMs;
      console.log("[doc-extraction] extraction complete", { rowId: row.id, docId, dealId, elapsedMs });

      // Mark outbox row delivered
      await sb
        .from("buddy_outbox_events")
        .update({
          delivered_at: new Date().toISOString(),
          delivered_to: "doc_extraction_worker",
          last_error: null,
        })
        .eq("id", row.id);

      // Post-extraction: trigger deal-level recomputation (idempotent, best-effort)
      void triggerPostExtractionOps(dealId, bankId, docId).catch((e) => {
        console.error("[doc-extraction] post-extraction ops failed (non-fatal)", {
          dealId,
          docId,
          error: e?.message,
        });
      });

      void writeEvent({
        dealId,
        kind: "intake.doc_extraction_complete",
        scope: "intake",
        meta: { doc_id: docId, elapsed_ms: elapsedMs },
      });

      processed += 1;
    } catch (err: any) {
      const elapsedMs = Date.now() - startMs;
      console.error("[doc-extraction] extraction failed", {
        rowId: row.id,
        docId,
        dealId,
        error: err?.message?.slice(0, 200),
        elapsedMs,
      });

      void writeEvent({
        dealId,
        kind: "intake.doc_extraction_error",
        scope: "intake",
        meta: {
          doc_id: docId,
          error: err?.message?.slice(0, 200),
          elapsed_ms: elapsedMs,
        },
      });

      const isDeadLetter = await markFailed(
        sb,
        row.id,
        err?.message?.slice(0, 500) ?? "unknown",
        row.attempts,
      );

      if (isDeadLetter) deadLettered += 1;
      failed += 1;
    }
  }

  console.log("[doc-extraction] batch complete", {
    claimed: claimed.length,
    processed,
    failed,
    deadLettered,
  });

  return { claimed: claimed.length, processed, failed, dead_lettered: deadLettered };
}

/**
 * After each doc extraction, recompute spread, facts, and readiness.
 * Idempotent — safe to run multiple times as extractions complete.
 */
async function triggerPostExtractionOps(
  dealId: string,
  bankId: string,
  docId: string,
): Promise<void> {
  // 1. Orchestrate spreads (uses whatever facts exist now)
  try {
    const { orchestrateSpreads } = await import("@/lib/spreads/orchestrateSpreads");
    await orchestrateSpreads(dealId, bankId, "recompute");
  } catch (e: any) {
    console.error("[doc-extraction] orchestrateSpreads failed", { dealId, docId, error: e?.message });
  }

  // 2. Materialize facts from artifacts
  try {
    const { materializeFactsFromArtifacts } = await import(
      "@/lib/financialFacts/materializeFactsFromArtifacts"
    );
    await materializeFactsFromArtifacts({ dealId, bankId });
  } catch (e: any) {
    console.error("[doc-extraction] materializeFactsFromArtifacts failed", { dealId, docId, error: e?.message });
  }

  // 3. Recompute deal readiness
  try {
    const { recomputeDealReady } = await import("@/lib/deals/readiness");
    await recomputeDealReady(dealId);
  } catch (e: any) {
    console.error("[doc-extraction] recomputeDealReady failed", { dealId, docId, error: e?.message });
  }
}

async function markFailed(
  sb: ReturnType<typeof supabaseAdmin>,
  rowId: string,
  error: string,
  currentAttempts: number,
): Promise<boolean> {
  const newAttempts = currentAttempts + 1;

  if (newAttempts >= DEAD_LETTER_THRESHOLD) {
    await sb
      .from("buddy_outbox_events")
      .update({
        attempts: newAttempts,
        last_error: error.slice(0, 500),
        dead_lettered_at: new Date().toISOString(),
        next_attempt_at: null,
        claimed_at: null,
        claim_owner: null,
      })
      .eq("id", rowId);

    console.error("[doc-extraction] DEAD-LETTERED", {
      rowId,
      attempts: newAttempts,
      error: error.slice(0, 200),
    });
    return true;
  }

  const delaySec = backoffSeconds(newAttempts);
  const nextAttempt = new Date(Date.now() + delaySec * 1000).toISOString();

  await sb
    .from("buddy_outbox_events")
    .update({
      attempts: newAttempts,
      last_error: error.slice(0, 500),
      next_attempt_at: nextAttempt,
      claimed_at: null,
      claim_owner: null,
    })
    .eq("id", rowId);

  return false;
}
