import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/reextract-all/status
 *
 * Pre-flight summary for bulk re-extraction: shows eligible documents,
 * type breakdown, last extraction time, and whether new prompt versions exist.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : 403;
      return NextResponse.json(
        { ok: false, error: access.error },
        { status },
      );
    }

    const sb = supabaseAdmin();

    // Load classified documents
    const { data: docs, error: docErr } = await sb
      .from("deal_documents" as any)
      .select("id, document_type, canonical_type, ai_doc_type, created_at")
      .eq("deal_id", dealId)
      .not("document_type", "is", null);

    if (docErr) {
      return NextResponse.json(
        { ok: false, error: `doc_load_failed: ${docErr.message}` },
        { status: 500 },
      );
    }

    const classified = (docs ?? []) as any[];

    // Build type breakdown
    const documentsByType: Record<string, number> = {};
    for (const doc of classified) {
      const docType =
        doc.canonical_type ?? doc.ai_doc_type ?? doc.document_type;
      documentsByType[docType] = (documentsByType[docType] ?? 0) + 1;
    }

    // Find most recent fact extraction timestamp for this deal
    const { data: latestFact } = await sb
      .from("deal_financial_facts" as any)
      .select("updated_at")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("updated_at", { ascending: false })
      .limit(1);

    const lastExtractionAt =
      (latestFact as any)?.[0]?.updated_at ?? null;

    // Proxy for "has new prompt version": any classified doc created after
    // the last extraction (or last extraction older than cutoff date).
    // Cutoff: 2026-03-07 — represents latest prompt/extractor revision.
    const PROMPT_VERSION_CUTOFF = "2026-03-07T00:00:00Z";
    const hasNewPromptVersion = lastExtractionAt
      ? new Date(lastExtractionAt) < new Date(PROMPT_VERSION_CUTOFF)
      : classified.length > 0;

    return NextResponse.json({
      ok: true,
      eligibleDocuments: classified.length,
      documentsByType,
      lastExtractionAt,
      hasNewPromptVersion,
    });
  } catch (error: any) {
    console.error("[reextract-all/status] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}
