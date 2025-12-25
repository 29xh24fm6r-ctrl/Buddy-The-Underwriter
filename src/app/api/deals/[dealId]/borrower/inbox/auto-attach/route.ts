import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:dealId/borrower/inbox/auto-attach
 *
 * Safe batch auto-attach:
 * - only uploads with:
 *    status='unmatched'
 *    match_confidence >= threshold
 *    matched_request_id not null
 * - only attaches to requests that are NOT already received
 *
 * Writes an audit run + run_items so we can undo within 15 minutes.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    const body = await req.json().catch(() => ({}));
    const threshold = Math.max(0, Math.min(100, Number(body?.threshold ?? 85)));

    // Pull eligible uploads
    const uploadsRes = await sb
      .from("borrower_upload_inbox")
      .select(
        "id, deal_id, bank_id, storage_path, filename, mime, bytes, status, matched_request_id, match_confidence, match_reason",
      )
      .eq("deal_id", dealId)
      .eq("status", "unmatched")
      .not("matched_request_id", "is", null)
      .gte("match_confidence", threshold)
      .order("created_at", { ascending: true });

    if (uploadsRes.error) throw new Error(uploadsRes.error.message);

    const uploads = uploadsRes.data || [];
    if (uploads.length === 0) {
      return NextResponse.json({
        ok: true,
        threshold,
        run: null,
        totals: { eligible: 0, attached: 0, skipped: 0, failed: 0 },
        results: [],
      });
    }

    const first = uploads[0];
    const bankId = first.bank_id as string;

    // Create run record
    const runIns = await sb
      .from("borrower_inbox_auto_attach_runs")
      .insert({ deal_id: dealId, bank_id: bankId, threshold })
      .select("id, created_at, threshold")
      .single();

    if (runIns.error) throw new Error(runIns.error.message);

    const runId = runIns.data.id as string;
    const createdAt = runIns.data.created_at as string;
    const expiresAt = new Date(
      Date.parse(createdAt) + 15 * 60 * 1000,
    ).toISOString();

    const nowIso = new Date().toISOString();

    const results: Array<{
      upload_inbox_id: string;
      request_id: string;
      confidence: number | null;
      ok: boolean;
      action: "attached" | "skipped" | "failed";
      reason?: string;
    }> = [];

    let attached = 0;
    let skipped = 0;
    let failed = 0;

    for (const u of uploads) {
      const uploadId = u.id as string;
      const requestId = u.matched_request_id as string;

      // Snapshot current states for audit
      const prevInboxStatus = (u.status as string) || null;
      const prevMatchedRequestId = (u.matched_request_id as string) || null;
      const prevMatchConfidence = (u.match_confidence as number | null) ?? null;
      const prevMatchReason = (u.match_reason as string | null) ?? null;

      let prevRequestStatus: string | null = null;
      let prevReceivedStoragePath: string | null = null;
      let prevReceivedFilename: string | null = null;
      let prevReceivedMime: string | null = null;
      let prevReceivedAt: string | null = null;
      let prevEvidence: any = null;

      try {
        // Read request before update
        const reqRes = await sb
          .from("borrower_document_requests")
          .select(
            "id, status, received_storage_path, received_filename, received_mime, received_at, evidence, bank_id, deal_id",
          )
          .eq("id", requestId)
          .single();

        if (reqRes.error) throw new Error(reqRes.error.message);

        prevRequestStatus = String(reqRes.data?.status || "");
        prevReceivedStoragePath =
          (reqRes.data?.received_storage_path as string | null) ?? null;
        prevReceivedFilename =
          (reqRes.data?.received_filename as string | null) ?? null;
        prevReceivedMime =
          (reqRes.data?.received_mime as string | null) ?? null;
        prevReceivedAt = (reqRes.data?.received_at as string | null) ?? null;
        prevEvidence = reqRes.data?.evidence ?? null;

        const status = prevRequestStatus;

        if (status === "received") {
          // Already received: mark inbox attached to remove from unmatched list
          const updInbox = await sb
            .from("borrower_upload_inbox")
            .update({
              status: "attached",
              matched_request_id: requestId,
              match_confidence: prevMatchConfidence,
              match_reason: prevMatchReason,
            })
            .eq("id", uploadId);

          if (updInbox.error) throw new Error(updInbox.error.message);

          skipped++;
          results.push({
            upload_inbox_id: uploadId,
            request_id: requestId,
            confidence: prevMatchConfidence,
            ok: true,
            action: "skipped",
            reason: "request_already_received",
          });

          // Audit item
          await sb.from("borrower_inbox_auto_attach_run_items").insert({
            run_id: runId,
            deal_id: dealId,
            bank_id: bankId,
            upload_inbox_id: uploadId,
            request_id: requestId,
            prev_inbox_status: prevInboxStatus,
            prev_matched_request_id: prevMatchedRequestId,
            prev_match_confidence: prevMatchConfidence,
            prev_match_reason: prevMatchReason,
            prev_request_status: prevRequestStatus,
            prev_received_storage_path: prevReceivedStoragePath,
            prev_received_filename: prevReceivedFilename,
            prev_received_mime: prevReceivedMime,
            prev_received_at: prevReceivedAt,
            prev_request_evidence: prevEvidence,
            new_inbox_status: "attached",
            new_request_status: prevRequestStatus,
            ok: true,
          });

          continue;
        }

        // Attach: update request -> received
        const updReq = await sb
          .from("borrower_document_requests")
          .update({
            status: "received",
            received_storage_path: u.storage_path,
            received_filename: u.filename,
            received_mime: u.mime,
            received_at: nowIso,
            updated_at: nowIso,
            evidence: {
              ...(typeof prevEvidence === "object" && prevEvidence
                ? prevEvidence
                : {}),
              auto_attached_batch: true,
              match_confidence: prevMatchConfidence,
              match_reason: prevMatchReason,
              threshold,
              auto_attach_run_id: runId,
            },
          })
          .eq("id", requestId);

        if (updReq.error) throw new Error(updReq.error.message);

        // Update inbox -> attached
        const updInbox = await sb
          .from("borrower_upload_inbox")
          .update({
            status: "attached",
            matched_request_id: requestId,
            match_confidence: prevMatchConfidence,
            match_reason: prevMatchReason,
          })
          .eq("id", uploadId);

        if (updInbox.error) throw new Error(updInbox.error.message);

        attached++;
        results.push({
          upload_inbox_id: uploadId,
          request_id: requestId,
          confidence: prevMatchConfidence,
          ok: true,
          action: "attached",
        });

        // Audit item
        await sb.from("borrower_inbox_auto_attach_run_items").insert({
          run_id: runId,
          deal_id: dealId,
          bank_id: bankId,
          upload_inbox_id: uploadId,
          request_id: requestId,

          prev_inbox_status: prevInboxStatus,
          prev_matched_request_id: prevMatchedRequestId,
          prev_match_confidence: prevMatchConfidence,
          prev_match_reason: prevMatchReason,

          prev_request_status: prevRequestStatus,
          prev_received_storage_path: prevReceivedStoragePath,
          prev_received_filename: prevReceivedFilename,
          prev_received_mime: prevReceivedMime,
          prev_received_at: prevReceivedAt,
          prev_request_evidence: prevEvidence,

          new_inbox_status: "attached",
          new_request_status: "received",
          ok: true,
        });
      } catch (e: any) {
        failed++;
        results.push({
          upload_inbox_id: uploadId,
          request_id: requestId,
          confidence: prevMatchConfidence,
          ok: false,
          action: "failed",
          reason: e?.message || "attach_failed",
        });

        // Audit failed item (best effort)
        await sb.from("borrower_inbox_auto_attach_run_items").insert({
          run_id: runId,
          deal_id: dealId,
          bank_id: bankId,
          upload_inbox_id: uploadId,
          request_id: requestId,

          prev_inbox_status: prevInboxStatus,
          prev_matched_request_id: prevMatchedRequestId,
          prev_match_confidence: prevMatchConfidence,
          prev_match_reason: prevMatchReason,

          prev_request_status: prevRequestStatus,
          prev_received_storage_path: prevReceivedStoragePath,
          prev_received_filename: prevReceivedFilename,
          prev_received_mime: prevReceivedMime,
          prev_received_at: prevReceivedAt,
          prev_request_evidence: prevEvidence,

          new_inbox_status: null,
          new_request_status: null,
          ok: false,
          error: e?.message || "attach_failed",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      threshold,
      run: {
        id: runId,
        created_at: createdAt,
        expires_at: expiresAt,
      },
      totals: { eligible: uploads.length, attached, skipped, failed },
      results,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "auto_attach_failed" },
      { status: 400 },
    );
  }
}
