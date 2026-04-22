import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { queueDocExtractionOutbox } from "@/lib/intake/processing/queueDocExtractionOutbox";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/reextract-all
 *
 * Bulk re-extraction: queues every classified document in the deal for
 * async re-extraction via the doc.extract outbox with forceRefresh=true.
 *
 * forceRefresh bypasses SHA-256 dedup so Gemini re-runs on the raw PDFs
 * even when an identical file was previously extracted under v1 prompts.
 *
 * The outbox worker handles: extractByDocType (fresh OCR + structured assist)
 * → triggerPostExtractionOps (spreads, facts, readiness).
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

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

    // Load all classified documents
    const { data: docs, error: docErr } = await sb
      .from("deal_documents" as any)
      .select(
        "id, document_type, ai_doc_type, canonical_type, original_filename",
      )
      .eq("deal_id", dealId)
      .not("document_type", "is", null);

    if (docErr) {
      return NextResponse.json(
        { ok: false, error: `doc_load_failed: ${docErr.message}` },
        { status: 500 },
      );
    }

    const allDocs = (docs ?? []) as any[];
    if (allDocs.length === 0) {
      return NextResponse.json({
        ok: true,
        queued: 0,
        message: "No classified documents to re-extract",
      });
    }

    let queued = 0;
    const errors: string[] = [];

    // Queue each document for async re-extraction with dedup bypass
    for (const doc of allDocs) {
      try {
        const docType =
          doc.canonical_type ?? doc.ai_doc_type ?? doc.document_type;

        await queueDocExtractionOutbox({
          dealId,
          bankId: access.bankId,
          docId: doc.id,
          docType,
          forceRefresh: true,
        });

        queued++;
      } catch (err: any) {
        errors.push(`${doc.id}: ${err?.message ?? "unknown"}`);
      }
    }

    // Emit ledger event
    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "reextraction.batch.queued",
      uiState: "working",
      uiMessage: `Queued ${queued} documents for re-extraction (dedup bypass enabled)`,
      meta: {
        triggered_by: userId,
        queued,
        total_docs: allDocs.length,
        force_refresh: true,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    return NextResponse.json({
      ok: true,
      queued,
      message: `${queued} documents queued for re-extraction. Results will appear as each document completes.`,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error("[reextract-all] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/deals/[dealId]/reextract-all
 *
 * Pre-flight summary for bulk re-extraction: shows eligible documents,
 * type breakdown, last extraction time, and whether new prompt versions
 * exist. Merged from the former /reextract-all/status sibling to stay
 * under Vercel's 2048-route platform cap.
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
    console.error("[reextract-all GET] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}
