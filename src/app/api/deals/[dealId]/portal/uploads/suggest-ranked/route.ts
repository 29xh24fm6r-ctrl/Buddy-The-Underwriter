// src/app/api/deals/[dealId]/portal/uploads/suggest-ranked/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadEvidenceForUpload,
  normalizeDocType,
  tokens,
  uniqStrings,
} from "@/lib/portal/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function norm(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type RequestRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
};

function scoreFilename(
  filename: string,
  req: RequestRow,
): { score: number; hits: string[] } {
  const f = norm(filename);
  const title = norm(req.title);
  const desc = norm(req.description || "");
  const cat = norm(req.category || "");

  const fTokens = new Set(f.split(" ").filter(Boolean));
  const reqTokens = new Set(
    [...title.split(" "), ...desc.split(" "), ...cat.split(" ")].filter(
      Boolean,
    ),
  );

  const hits: string[] = [];
  let score = 0;

  if (title && f.includes(title)) {
    score += 0.65;
    hits.push("filename_contains_title");
  }

  let overlap = 0;
  for (const t of fTokens) if (reqTokens.has(t) && t.length >= 3) overlap++;
  if (overlap >= 2) {
    score += Math.min(0.35, overlap * 0.08);
    hits.push(`filename_token_overlap:${overlap}`);
  }

  if (cat && f.includes(cat)) {
    score += 0.12;
    hits.push("filename_contains_category");
  }

  score = Math.max(0, Math.min(0.99, score));
  return { score, hits };
}

type HintRow = {
  id: string;
  request_id: string;
  doc_type: string | null;
  year: number | null;
  filename_tokens: string[] | null;
  keywords: string[] | null;
  hit_count: number;
};

type BankHintRow = {
  id: string;
  doc_type: string | null;
  year: number | null;
  category: string | null;
  filename_tokens: string[] | null;
  keywords: string[] | null;
  hit_count: number;
};

function scaleFromHits(hitCount: number) {
  const hc = Math.max(1, Math.min(50, Number(hitCount || 1)));
  return 1 + Math.min(0.35, (hc - 1) * 0.02);
}

function overlapCount(a: string[], b: string[]) {
  const setB = new Set(b.map((x) => (x || "").toLowerCase()));
  let n = 0;
  for (const x of a) if (setB.has((x || "").toLowerCase())) n++;
  return n;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const uploadId = body?.uploadId;
  const limit = Math.max(1, Math.min(10, Number(body?.limit ?? 3)));

  if (!uploadId || typeof uploadId !== "string") {
    return NextResponse.json({ error: "Missing uploadId" }, { status: 400 });
  }

  const { data: upload, error: upErr } = await sb
    .from("borrower_uploads")
    .select(
      "id,deal_id,bank_id,original_filename,request_id,storage_path,storage_bucket,mime_type",
    )
    .eq("id", uploadId)
    .single();

  if (upErr || !upload)
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  if (upload.deal_id !== dealId)
    return NextResponse.json({ error: "Upload not in deal" }, { status: 400 });

  const { data: requests = [], error: rqErr } = await sb
    .from("borrower_document_requests")
    .select("id,title,description,category,status")
    .eq("deal_id", dealId);

  if (rqErr)
    return NextResponse.json(
      { error: "Failed to load requests" },
      { status: 500 },
    );

  const ev = await loadEvidenceForUpload(sb, upload);
  const evDocType = normalizeDocType(ev?.docType ?? null);
  const evYear = ev?.year ?? null;

  const uploadNameTokens = tokens(upload.original_filename);
  const evKeywords = Array.isArray(ev?.keywords)
    ? ev!.keywords!.map((k) => String(k))
    : [];
  const uploadSignalTokens = uniqStrings([
    ...uploadNameTokens,
    ...evKeywords,
  ]).slice(0, 100);

  // Deal-level hints
  const { data: hints, error: hintErr } = await sb
    .from("borrower_match_hints")
    .select("id,request_id,doc_type,year,filename_tokens,keywords,hit_count")
    .eq("deal_id", dealId)
    .limit(500);

  const hintsByRequest = new Map<string, HintRow[]>();
  if (!hintErr && Array.isArray(hints)) {
    for (const h of hints as any as HintRow[]) {
      const arr = hintsByRequest.get(h.request_id) || [];
      arr.push(h);
      hintsByRequest.set(h.request_id, arr);
    }
  }

  // Bank-level hints (global priors)
  const { data: bankHints, error: bankHintErr } = await sb
    .from("bank_match_hints")
    .select("id,doc_type,year,category,filename_tokens,keywords,hit_count")
    .eq("bank_id", upload.bank_id)
    .limit(200);

  const bankHintsByCategory = new Map<string, BankHintRow[]>();
  if (!bankHintErr && Array.isArray(bankHints)) {
    for (const h of bankHints as any as BankHintRow[]) {
      const cat = (h.category || "").toLowerCase() || "_none_";
      const arr = bankHintsByCategory.get(cat) || [];
      arr.push(h);
      bankHintsByCategory.set(cat, arr);
    }
  }

  function scoreLearning(req: RequestRow): {
    dealBump: number;
    bankBump: number;
    hits: string[];
  } {
    const dealRows = hintsByRequest.get(req.id) || [];
    const reqCat = (req.category || "").toLowerCase() || "_none_";
    const bankRows = bankHintsByCategory.get(reqCat) || [];

    let dealBump = 0;
    let bankBump = 0;
    const hits: string[] = [];

    // Deal-specific learning (strongest signal)
    for (const h of dealRows) {
      const s = scaleFromHits(h.hit_count || 1);
      const hDocType = h.doc_type ? normalizeDocType(h.doc_type) : null;
      const hYear = h.year ?? null;

      if (evDocType && hDocType && evDocType === hDocType) {
        dealBump += 0.2 * s;
        hits.push(`deal_doc_type:${evDocType}(x${h.hit_count || 1})`);
      }

      if (evYear && hYear && evYear === hYear) {
        dealBump += 0.16 * s;
        hits.push(`deal_year:${evYear}(x${h.hit_count || 1})`);
      }

      const hk = Array.isArray(h.keywords) ? h.keywords : [];
      const overlapKw = overlapCount(uploadSignalTokens, hk);
      if (overlapKw >= 2) {
        dealBump += Math.min(0.14, overlapKw * 0.03) * s;
        hits.push(`deal_keywords:${overlapKw}(x${h.hit_count || 1})`);
      }

      const ht = Array.isArray(h.filename_tokens) ? h.filename_tokens : [];
      const overlapFn = overlapCount(uploadNameTokens, ht);
      if (overlapFn >= 2) {
        dealBump += Math.min(0.1, overlapFn * 0.02) * s;
        hits.push(`deal_filename:${overlapFn}(x${h.hit_count || 1})`);
      }
    }

    // Bank-wide learning (global priors, weaker signal)
    for (const h of bankRows) {
      const s = scaleFromHits(h.hit_count || 1) * 0.6; // 60% weight vs deal-level
      const hDocType = h.doc_type ? normalizeDocType(h.doc_type) : null;
      const hYear = h.year ?? null;

      if (evDocType && hDocType && evDocType === hDocType) {
        bankBump += 0.12 * s;
        hits.push(`bank_doc_type:${evDocType}(x${h.hit_count || 1})`);
      }

      if (evYear && hYear && evYear === hYear) {
        bankBump += 0.1 * s;
        hits.push(`bank_year:${evYear}(x${h.hit_count || 1})`);
      }

      const hk = Array.isArray(h.keywords) ? h.keywords : [];
      const overlapKw = overlapCount(uploadSignalTokens, hk);
      if (overlapKw >= 3) {
        bankBump += Math.min(0.08, overlapKw * 0.02) * s;
        hits.push(`bank_keywords:${overlapKw}(x${h.hit_count || 1})`);
      }

      const ht = Array.isArray(h.filename_tokens) ? h.filename_tokens : [];
      const overlapFn = overlapCount(uploadNameTokens, ht);
      if (overlapFn >= 3) {
        bankBump += Math.min(0.06, overlapFn * 0.015) * s;
        hits.push(`bank_filename:${overlapFn}(x${h.hit_count || 1})`);
      }
    }

    dealBump = Math.max(0, Math.min(0.55, dealBump));
    bankBump = Math.max(0, Math.min(0.3, bankBump));

    return { dealBump, bankBump, hits: hits.slice(0, 12) };
  }

  const scored = (requests as any as RequestRow[])
    .map((r) => {
      const f = scoreFilename(upload.original_filename, r);
      const l = scoreLearning(r);

      const total = Math.max(
        0,
        Math.min(0.99, f.score + l.dealBump + l.bankBump),
      );

      return {
        requestId: r.id,
        title: r.title,
        status: r.status,
        category: r.category,
        confidence: total,
        evidence: {
          hits: [...f.hits, ...l.hits],
          detected: {
            docType: evDocType ?? null,
            year: evYear ?? null,
          },
        },
      };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);

  return NextResponse.json({
    ok: true,
    uploadId: upload.id,
    filename: upload.original_filename,
    alreadyAssignedRequestId: upload.request_id,
    suggestions: scored,
  });
}
