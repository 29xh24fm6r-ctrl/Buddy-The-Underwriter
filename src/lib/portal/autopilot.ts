// src/lib/portal/autopilot.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

type UploadRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  request_id: string | null;
  original_filename: string;
  storage_bucket: string;
  storage_path: string;
};

type RequestRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
};

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreMatch(filename: string, req: RequestRow): { score: number; hits: string[] } {
  const f = norm(filename);
  const title = norm(req.title);
  const desc = norm(req.description || "");
  const cat = norm(req.category || "");

  const fTokens = new Set(f.split(" ").filter(Boolean));
  const reqTokens = new Set([...title.split(" "), ...desc.split(" "), ...cat.split(" ")].filter(Boolean));

  const hits: string[] = [];
  let score = 0;

  // strong signal: direct substring title in filename
  if (title && f.includes(title)) {
    score += 0.65;
    hits.push("filename_contains_title");
  }

  // token overlap
  let overlap = 0;
  for (const t of fTokens) if (reqTokens.has(t) && t.length >= 3) overlap++;
  if (overlap >= 2) {
    score += Math.min(0.35, overlap * 0.08);
    hits.push(`token_overlap:${overlap}`);
  }

  // category hints
  if (cat && f.includes(cat)) {
    score += 0.15;
    hits.push("filename_contains_category");
  }

  // clamp
  score = Math.max(0, Math.min(0.99, score));
  return { score, hits };
}

export async function runPortalAutopilotForDeal(dealId: string) {
  const sb = supabaseAdmin();

  // Pull recent uploads that aren't matched to a request yet (or were "extra docs")
  const { data: uploads = [] } = await sb
    .from("borrower_uploads")
    .select("id,deal_id,bank_id,request_id,original_filename,storage_bucket,storage_path,uploaded_at")
    .eq("deal_id", dealId)
    .order("uploaded_at", { ascending: false })
    .limit(50);

  // Pull active requests
  const { data: requests = [] } = await sb
    .from("borrower_document_requests")
    .select("id,title,description,category,status,deal_id")
    .eq("deal_id", dealId)
    .in("status", ["requested", "rejected"]);

  const events: any[] = [];
  const notifs: any[] = [];

  for (const u of uploads as any as UploadRow[]) {
    // If upload already tied to a request_id, just ensure status is uploaded
    if (u.request_id) {
      await sb.from("borrower_document_requests").update({ status: "uploaded" }).eq("id", u.request_id);
      events.push({
        upload_id: u.id,
        deal_id: u.deal_id,
        bank_id: u.bank_id,
        type: "request_status_updated",
        payload: { request_id: u.request_id, status: "uploaded", reason: "upload_linked_directly" },
      });
      continue;
    }

    // Try to find best match among requests
    let best: { req: RequestRow; score: number; hits: string[] } | null = null;

    for (const r of requests as any as RequestRow[]) {
      const { score, hits } = scoreMatch(u.original_filename, r);
      if (!best || score > best.score) best = { req: r, score, hits };
    }

    // thresholding: only auto-match above 0.72
    if (best && best.score >= 0.72) {
      // Insert match (idempotent)
      await sb.from("borrower_upload_matches").upsert(
        {
          upload_id: u.id,
          request_id: best.req.id,
          deal_id: u.deal_id,
          bank_id: u.bank_id,
          confidence: best.score,
          method: "auto",
          evidence: { hits: best.hits, filename: u.original_filename },
        },
        { onConflict: "upload_id,request_id" }
      );

      // Update request status
      await sb.from("borrower_document_requests").update({ status: "uploaded" }).eq("id", best.req.id);

      events.push({
        upload_id: u.id,
        deal_id: u.deal_id,
        bank_id: u.bank_id,
        type: "matched",
        payload: { request_id: best.req.id, confidence: best.score, evidence: best.hits },
      });

      notifs.push({
        deal_id: u.deal_id,
        bank_id: u.bank_id,
        audience: "bank",
        channel: "in_app",
        type: "info",
        title: "Borrower upload matched",
        body: `Matched "${u.original_filename}" to request "${best.req.title}" (${Math.round(best.score * 100)}%).`,
        data: { upload_id: u.id, request_id: best.req.id, confidence: best.score },
      });
    } else {
      // No confident match — flag for banker review
      notifs.push({
        deal_id: u.deal_id,
        bank_id: u.bank_id,
        audience: "bank",
        channel: "in_app",
        type: "info",
        title: "Borrower uploaded an unassigned document",
        body: `"${u.original_filename}" needs assignment to a request.`,
        data: { upload_id: u.id, filename: u.original_filename },
      });
    }
  }

  if (events.length) {
    await sb.from("borrower_upload_events").insert(events);
  }
  if (notifs.length) {
    await sb.from("borrower_notifications").insert(notifs);
  }

  return { ok: true, uploadsProcessed: uploads?.length || 0, requestsConsidered: requests?.length || 0 };
}
