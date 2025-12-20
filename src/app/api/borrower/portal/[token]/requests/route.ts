import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidInvite } from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    // Use existing canonical token validation
    const invite = await requireValidInvite(token);

    // 1) Pull current doc requests for this deal
    const reqs = await sb
      .from("borrower_document_requests")
      .select("id, title, category, description, required, status, due_at, received_filename, received_at, sort_order")
      .eq("deal_id", invite.deal_id)
      .order("sort_order", { ascending: true });

    if (reqs.error) throw new Error(reqs.error.message);

    // 2) Attach pack intelligence (rankings + confidence) if available
    const { data: confidence } = await sb
      .from("borrower_pack_confidence_summary")
      .select("*")
      .eq("deal_id", invite.deal_id)
      .eq("bank_id", invite.bank_id)
      .order("rank", { ascending: true });

    // 3) Progress summary (safe view) if available
    const { data: progress } = await sb
      .from("borrower_progress_and_risk")
      .select("*")
      .eq("deal_id", invite.deal_id)
      .eq("bank_id", invite.bank_id)
      .maybeSingle();

    // 4) Inbox count for banker visibility
    const { count: inboxCount } = await sb
      .from("borrower_upload_inbox")
      .select("*", { count: "exact", head: true })
      .eq("deal_id", invite.deal_id)
      .eq("status", "unmatched");

    // Transform pack confidence data to borrower-safe format
    const packSuggestions = (confidence ?? []).map((c: any) => ({
      pack_id: c.pack_id,
      pack_name: c.pack_name,
      confidence: typeof c.match_score === 'number' ? c.match_score / 100 : 0,
      matched_doc_count: null, // TODO: calculate from requests
      missing_doc_count: null, // TODO: calculate from pack items
      reason_codes: null, // TODO: extract from metadata
    }));

    // Transform progress data to borrower-safe format
    const progressData = progress ? {
      progress_pct: progress.completion_percentage ?? 0,
      uploaded_count: progress.completed_count ?? 0,
      expected_count: progress.total_count ?? 0,
      missing_critical_count: progress.blockers ?? 0,
      stale_items_count: progress.overdue_count ?? 0,
      updated_at: progress.last_activity ?? null,
    } : null;

    // Transform requests to match portal types
    const requestsData = (reqs.data || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status === 'received' ? 'COMPLETE' : 
              r.status === 'requested' ? 'OPEN' : 
              'IN_REVIEW',
      created_at: r.created_at,
      updated_at: r.updated_at,
      category: r.category,
      due_date: r.due_at,
    }));

    // Generate borrower-safe missing items from open requests
    const missingItems = (reqs.data || [])
      .filter((r: any) => r.status !== 'received')
      .map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description || "Upload the requested document",
        examples: null, // TODO: derive from doc_type
        priority: r.required ? "HIGH" : "MEDIUM",
        status: "MISSING",
        category_label: r.category || null,
      }));

    // Generate recent activity from upload inbox and requests
    const { data: recentUploads } = await sb
      .from("borrower_upload_inbox")
      .select("id, filename, created_at, matched_request_id, match_confidence, status")
      .eq("deal_id", invite.deal_id)
      .order("created_at", { ascending: false })
      .limit(10);

    const recentActivity = (recentUploads || []).map((upload: any) => {
      const matched = upload.matched_request_id && upload.status === 'attached';
      const matchedReq = matched 
        ? (reqs.data || []).find((r: any) => r.id === upload.matched_request_id)
        : null;

      const confidence = typeof upload.match_confidence === 'number' 
        ? upload.match_confidence / 100 
        : null;

      return {
        id: upload.id,
        timestamp: upload.created_at,
        type: matched ? "matched" : "upload",
        title: matched 
          ? "We recognized your upload" 
          : "Upload received",
        description: matched && matchedReq
          ? `Filed as: ${matchedReq.title}`
          : "Your banker will review and file this document",
        confidence,
        icon: matched ? "check" : "upload",
        filename: upload.filename,
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
    return NextResponse.json({ ok: false, error: e?.message || "portal_failed" }, { status: 400 });
  }
}
