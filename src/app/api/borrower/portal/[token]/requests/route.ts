import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    // Use existing canonical token validation
    const invite = await requireValidInvite(token);

    // 1) Pull current doc requests for this deal.
    // `required`, `received_filename`, `received_at` don't exist on this
    // table — the old select always errored, so this route always 400'd.
    const reqs = await sb
      .from("borrower_document_requests")
      .select(
        "id, title, category, description, status, due_at, created_at, updated_at, sort_order",
      )
      .eq("deal_id", invite.deal_id)
      .order("sort_order", { ascending: true });

    if (reqs.error) throw new Error(reqs.error.message);

    // 2) Attach pack intelligence (rankings + confidence) if available.
    // `borrower_pack_confidence_summary` is a view keyed on
    // pack_template_id with a categorical ('low'/'medium'/'high')
    // `confidence` label, not `pack_id`/`pack_name`/a numeric `match_score`.
    const { data: confidence } = await sb
      .from("borrower_pack_confidence_summary")
      .select("pack_template_id, rank, avg_blockers, samples, confidence")
      .eq("deal_id", invite.deal_id)
      .eq("bank_id", invite.bank_id)
      .order("rank", { ascending: true });

    // 3) Progress summary (safe view) if available.
    // `completion_percentage`/`completed_count`/`total_count`/
    // `overdue_count`/`last_activity` don't exist — real columns are
    // `completion_ratio` (0-1), `blockers` (count), `sla_risk` (label).
    const { data: progress } = await sb
      .from("borrower_progress_and_risk")
      .select("completion_ratio, blockers, sla_risk")
      .eq("deal_id", invite.deal_id)
      .eq("bank_id", invite.bank_id)
      .maybeSingle();

    // 4) Inbox count for banker visibility
    const { count: inboxCount } = await sb
      .from("borrower_upload_inbox")
      .select("*", { count: "exact", head: true })
      .eq("deal_id", invite.deal_id)
      .eq("status", "unmatched");

    // Transform pack confidence data to borrower-safe format. No `pack_name`
    // column exists anywhere on this view — left null rather than invented.
    const packSuggestions = (confidence ?? []).map((c: any) => ({
      pack_id: c.pack_template_id,
      pack_name: null,
      confidence: c.confidence ?? null, // categorical: "low" | "medium" | "high"
      matched_doc_count: null, // TODO: calculate from requests
      missing_doc_count: null, // TODO: calculate from pack items
      reason_codes: null, // TODO: extract from metadata
    }));

    // Transform progress data to borrower-safe format
    const receivedCount = (reqs.data || []).filter((r: any) => r.status === "received").length;
    const progressData = progress
      ? {
          progress_pct: Math.round((Number(progress.completion_ratio) || 0) * 100),
          uploaded_count: receivedCount,
          expected_count: (reqs.data || []).length,
          missing_critical_count: progress.blockers ?? 0,
          stale_items_count: null, // no numeric count on this view — sla_risk (below) is the categorical signal
          sla_risk: progress.sla_risk ?? null,
          updated_at: null,
        }
      : null;

    // Transform requests to match portal types
    const requestsData = (reqs.data || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status:
        r.status === "received"
          ? "COMPLETE"
          : r.status === "requested"
            ? "OPEN"
            : "IN_REVIEW",
      created_at: r.created_at,
      updated_at: r.updated_at,
      category: r.category,
      due_date: r.due_at,
    }));

    // Generate borrower-safe missing items from open requests. No
    // `required` column exists — every row in this table represents an
    // active request, so all are treated as MEDIUM priority by default.
    const missingItems = (reqs.data || [])
      .filter((r: any) => r.status !== "received")
      .map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description || "Upload the requested document",
        examples: null, // TODO: derive from doc_type
        priority: "MEDIUM",
        status: "MISSING",
        category_label: r.category || null,
      }));

    // Generate recent activity from upload inbox and requests.
    // `filename`/`match_confidence` don't exist — real columns are
    // `file_name`/`confidence`.
    const { data: recentUploads } = await sb
      .from("borrower_upload_inbox")
      .select(
        "id, file_name, created_at, matched_request_id, confidence, status",
      )
      .eq("deal_id", invite.deal_id)
      .order("created_at", { ascending: false })
      .limit(10);

    const recentActivity = (recentUploads || []).map((upload: any) => {
      const matched = upload.matched_request_id && upload.status === "attached";
      const matchedReq = matched
        ? (reqs.data || []).find((r: any) => r.id === upload.matched_request_id)
        : null;

      const confidence =
        typeof upload.confidence === "number" ? upload.confidence / 100 : null;

      return {
        id: upload.id,
        timestamp: upload.created_at,
        type: matched ? "matched" : "upload",
        title: matched ? "We recognized your upload" : "Upload received",
        description:
          matched && matchedReq
            ? `Filed as: ${matchedReq.title}`
            : "Your banker will review and file this document",
        confidence,
        icon: matched ? "check" : "upload",
        filename: upload.file_name,
        category: matchedReq?.category || null,
      };
    });

    return NextResponse.json({
      ok: true,
      deal: {
        id: invite.deal_id,
        name: null,
      },
      requests: requestsData,
      packSuggestions,
      progress: progressData,
      missingItems,
      recentActivity,
      serverTime: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "portal_failed" },
      { status: 400 },
    );
  }
}
