/**
 * POST /api/deals/[dealId]/artifacts/[artifactId]/requeue
 *
 * Re-queue a single failed or stuck artifact for reprocessing.
 * Uses the existing queue_document_artifact RPC which handles
 * the failed → queued transition atomically with retry_count increment.
 */

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string; artifactId: string }>;
};

export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId, artifactId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // 1. Verify artifact exists and belongs to this deal
    const { data: artifact, error: artErr } = await sb
      .from("document_artifacts")
      .select("id, deal_id, bank_id, source_table, source_id, status")
      .eq("id", artifactId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (artErr || !artifact) {
      return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 });
    }

    // 2. Only allow requeue of failed or stuck-processing artifacts
    if (!["failed", "processing"].includes(artifact.status)) {
      return NextResponse.json(
        { ok: false, error: `Cannot requeue artifact in '${artifact.status}' state` },
        { status: 409 },
      );
    }

    // 3. Reset to queued via RPC (handles retry_count increment atomically)
    const { error: rpcErr } = await sb.rpc("queue_document_artifact", {
      p_deal_id: dealId,
      p_bank_id: artifact.bank_id,
      p_source_table: artifact.source_table,
      p_source_id: artifact.source_id,
    });

    if (rpcErr) {
      console.error("[artifacts/requeue] RPC error", rpcErr);
      return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
    }

    // 4. Ledger event
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifact.requeued",
      uiState: "working",
      uiMessage: "Document re-queued for AI processing",
      meta: { artifact_id: artifactId, previous_status: artifact.status, triggered_by: userId },
    });

    return NextResponse.json({ ok: true, artifact_id: artifactId });
  } catch (error: any) {
    console.error("[artifacts/requeue] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
