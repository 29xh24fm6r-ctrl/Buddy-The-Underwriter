import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:dealId/borrower/inbox/auto-attach/undo
 * Body: { run_id: string }
 *
 * Safety:
 * - only allows undo within 15 minutes of run.created_at
 * - reverts request + inbox states using run_items snapshots
 */
export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    const body = await req.json();
    const runId = String(body?.run_id || "").trim();
    if (!runId) throw new Error("missing_run_id");

    const runRes = await sb
      .from("borrower_inbox_auto_attach_runs")
      .select("id, deal_id, bank_id, created_at, threshold")
      .eq("id", runId)
      .single();

    if (runRes.error) throw new Error(runRes.error.message);
    if (String(runRes.data.deal_id) !== String(dealId)) throw new Error("run_deal_mismatch");

    const createdAt = new Date(runRes.data.created_at as string).getTime();
    const now = Date.now();
    const ttlMs = 15 * 60 * 1000;

    if (now - createdAt > ttlMs) {
      return NextResponse.json(
        { ok: false, error: "undo_window_expired", created_at: runRes.data.created_at },
        { status: 400 }
      );
    }

    // Get items (only ok=true items are revertable)
    const itemsRes = await sb
      .from("borrower_inbox_auto_attach_run_items")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });

    if (itemsRes.error) throw new Error(itemsRes.error.message);

    const items = itemsRes.data || [];
    if (items.length === 0) {
      return NextResponse.json({ ok: true, run_id: runId, totals: { items: 0, reverted: 0, failed: 0 }, results: [] });
    }

    let reverted = 0;
    let failed = 0;

    const results: Array<{
      upload_inbox_id: string;
      request_id: string;
      ok: boolean;
      action: "reverted" | "failed";
      reason?: string;
    }> = [];

    for (const it of items) {
      // Only revert items we successfully processed (ok=true).
      if (it.ok !== true) continue;

      const uploadInboxId = String(it.upload_inbox_id);
      const requestId = String(it.request_id);

      try {
        // Revert request to previous snapshot
        const updReq = await sb
          .from("borrower_document_requests")
          .update({
            status: it.prev_request_status ?? null,
            received_storage_path: it.prev_received_storage_path ?? null,
            received_filename: it.prev_received_filename ?? null,
            received_mime: it.prev_received_mime ?? null,
            received_at: it.prev_received_at ?? null,
            evidence: it.prev_request_evidence ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", requestId);

        if (updReq.error) throw new Error(updReq.error.message);

        // Revert inbox to previous snapshot
        const updInbox = await sb
          .from("borrower_upload_inbox")
          .update({
            status: it.prev_inbox_status ?? "unmatched",
            matched_request_id: it.prev_matched_request_id ?? null,
            match_confidence: it.prev_match_confidence ?? null,
            match_reason: it.prev_match_reason ?? null,
          })
          .eq("id", uploadInboxId);

        if (updInbox.error) throw new Error(updInbox.error.message);

        reverted++;
        results.push({ upload_inbox_id: uploadInboxId, request_id: requestId, ok: true, action: "reverted" });
      } catch (e: any) {
        failed++;
        results.push({
          upload_inbox_id: uploadInboxId,
          request_id: requestId,
          ok: false,
          action: "failed",
          reason: e?.message || "revert_failed",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      run_id: runId,
      totals: { items: items.length, reverted, failed },
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "undo_failed" }, { status: 400 });
  }
}
