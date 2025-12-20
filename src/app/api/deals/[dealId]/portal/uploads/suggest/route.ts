// src/app/api/deals/[dealId]/portal/uploads/suggest/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type RequestRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
};

function scoreMatch(filename: string, req: RequestRow): { score: number; hits: string[] } {
  const f = norm(filename);
  const title = norm(req.title);
  const desc = norm(req.description || "");
  const cat = norm(req.category || "");

  const fTokens = new Set(f.split(" ").filter(Boolean));
  const reqTokens = new Set([...title.split(" "), ...desc.split(" "), ...cat.split(" ")].filter(Boolean));

  let hits: string[] = [];
  let score = 0;

  if (title && f.includes(title)) {
    score += 0.65;
    hits.push("filename_contains_title");
  }

  let overlap = 0;
  for (const t of fTokens) if (reqTokens.has(t) && t.length >= 3) overlap++;
  if (overlap >= 2) {
    score += Math.min(0.35, overlap * 0.08);
    hits.push(`token_overlap:${overlap}`);
  }

  if (cat && f.includes(cat)) {
    score += 0.15;
    hits.push("filename_contains_category");
  }

  score = Math.max(0, Math.min(0.99, score));
  return { score, hits };
}

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const uploadId = body?.uploadId;

  if (!uploadId || typeof uploadId !== "string") {
    return NextResponse.json({ error: "Missing uploadId" }, { status: 400 });
  }

  const { data: upload, error: upErr } = await sb
    .from("borrower_uploads")
    .select("id,deal_id,bank_id,original_filename,request_id")
    .eq("id", uploadId)
    .single();

  if (upErr || !upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  if (upload.deal_id !== dealId) return NextResponse.json({ error: "Upload not in deal" }, { status: 400 });

  // If already assigned, return that as suggestion
  if (upload.request_id) {
    return NextResponse.json({
      ok: true,
      suggestedRequestId: upload.request_id,
      confidence: 1,
      evidence: { hits: ["already_assigned"] },
    });
  }

  const { data: requests = [], error: rqErr } = await sb
    .from("borrower_document_requests")
    .select("id,title,description,category,status")
    .eq("deal_id", dealId);

  if (rqErr) return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });

  let best: { id: string; score: number; hits: string[]; title: string } | null = null;
  for (const r of requests as any as RequestRow[]) {
    const { score, hits } = scoreMatch(upload.original_filename, r);
    if (!best || score > best.score) best = { id: r.id, score, hits, title: r.title };
  }

  if (!best) {
    return NextResponse.json({ ok: true, suggestedRequestId: null, confidence: 0, evidence: { hits: ["no_requests"] } });
  }

  return NextResponse.json({
    ok: true,
    suggestedRequestId: best.id,
    confidence: best.score,
    suggestedTitle: best.title,
    evidence: { hits: best.hits, filename: upload.original_filename },
  });
}
