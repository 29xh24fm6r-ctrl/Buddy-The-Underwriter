/**
 * POST /api/deals/[dealId]/artifacts/process
 *
 * Process all queued artifacts for a specific deal.
 */

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processArtifact } from "@/lib/artifacts/processArtifact";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

type Context = {
  params: Promise<{ dealId: string }>;
};

export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();

    const sb = supabaseAdmin();

    // Verify deal exists and belongs to bank
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
    }

    if (String(deal.bank_id) !== String(bankId)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    // Get all queued artifacts for this deal
    const { data: artifacts, error: fetchErr } = await sb
      .from("document_artifacts")
      .select("id, deal_id, bank_id, source_table, source_id, retry_count")
      .eq("deal_id", dealId)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchErr) {
      console.error("[artifacts/process] fetch error", fetchErr);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch artifacts" },
        { status: 500 }
      );
    }

    if (!artifacts || artifacts.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No queued artifacts to process",
        processed: 0,
      });
    }

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifacts.process.start",
      uiState: "working",
      uiMessage: `Processing ${artifacts.length} documents`,
      meta: { count: artifacts.length, triggered_by: userId },
    });

    // Process each artifact
    const results = [];
    for (const artifact of artifacts) {
      // Mark as processing first
      await sb
        .from("document_artifacts")
        .update({ status: "processing", processed_at: new Date().toISOString() })
        .eq("id", artifact.id);

      const result = await processArtifact(artifact as any);
      results.push(result);
    }

    const summary = {
      processed: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifacts.process.complete",
      uiState: "done",
      uiMessage: `Processed ${summary.succeeded}/${summary.processed} documents`,
      meta: { ...summary, triggered_by: userId },
    });

    return NextResponse.json({
      ok: true,
      ...summary,
      results: results.map((r) => ({
        artifact_id: r.artifactId,
        ok: r.ok,
        doc_type: r.classification?.docType,
        confidence: r.classification?.confidence,
        matched_keys: r.matchedKeys,
        error: r.error,
      })),
    });
  } catch (error: any) {
    console.error("[artifacts/process] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
