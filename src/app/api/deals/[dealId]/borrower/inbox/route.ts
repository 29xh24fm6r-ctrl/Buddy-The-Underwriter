import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/:dealId/borrower/inbox
 * Query params:
 * - q: filename search (uploads)
 * - min_conf: minimum match_confidence (uploads)
 * - include_received: "1" to include requests with status=received, default excludes
 * - req_q: request title search
 * - req_category: request category filter
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const minConfRaw = url.searchParams.get("min_conf");
  const min_conf = minConfRaw ? Number(minConfRaw) : null;

  const include_received = url.searchParams.get("include_received") === "1";

  const req_q = (url.searchParams.get("req_q") || "").trim();
  const req_category = (url.searchParams.get("req_category") || "").trim();

  // ---- Unmatched uploads (inbox) ----
  let inboxQuery = sb
    .from("borrower_upload_inbox")
    .select(
      "id, bank_id, deal_id, filename, mime, bytes, storage_path, status, matched_request_id, match_confidence, match_reason, created_at",
    )
    .eq("deal_id", dealId)
    .in("status", ["unmatched"])
    .order("created_at", { ascending: false });

  if (q) {
    inboxQuery = inboxQuery.ilike("filename", `%${q}%`);
  }
  if (Number.isFinite(min_conf as any)) {
    inboxQuery = inboxQuery.gte("match_confidence", min_conf as number);
  }

  const inboxRes = await inboxQuery;

  if (inboxRes.error) {
    Sentry.captureException(inboxRes.error, {
      tags: { route: "borrower_inbox", phase: "list_inbox" },
      extra: { dealId, q, min_conf, include_received, req_q, req_category },
    });
    return NextResponse.json(
      { ok: false, error: inboxRes.error.message },
      { status: 400 },
    );
  }

  // ---- Requests to attach to ----
  let reqQuery = sb
    .from("borrower_document_requests")
    .select("id, title, category, doc_type, status, created_at, updated_at")
    .eq("deal_id", dealId)
    .order("title", { ascending: true });

  if (!include_received) {
    reqQuery = reqQuery.neq("status", "received");
  }
  if (req_q) {
    reqQuery = reqQuery.ilike("title", `%${req_q}%`);
  }
  if (req_category) {
    // category is often a string label in your schema; if not, adjust here
    reqQuery = reqQuery.eq("category", req_category);
  }

  const reqsRes = await reqQuery;

  if (reqsRes.error) {
    Sentry.captureException(reqsRes.error, {
      tags: { route: "borrower_inbox", phase: "list_requests" },
      extra: { dealId, q, min_conf, include_received, req_q, req_category },
    });
    return NextResponse.json(
      { ok: false, error: reqsRes.error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    deal_id: dealId,
    inbox: inboxRes.data || [],
    requests: reqsRes.data || [],
  });
}
