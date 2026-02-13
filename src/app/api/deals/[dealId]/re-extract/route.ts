import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromDocument } from "@/lib/financialSpreads/extractFactsFromDocument";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/re-extract
 *
 * Re-runs fact extraction for all classified documents in a deal.
 * Useful when the extraction pipeline has been updated and existing
 * documents need their facts re-extracted without full reprocessing.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : 403;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const sb = supabaseAdmin();

    // Find all completed artifacts with their classification
    const { data: artifacts } = await sb
      .from("document_artifacts" as any)
      .select("id, source_id, doc_type, status")
      .eq("deal_id", dealId)
      .eq("status", "completed");

    if (!artifacts || artifacts.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No completed artifacts to re-extract",
        documents_processed: 0,
        total_facts_written: 0,
      });
    }

    let totalFacts = 0;
    let processed = 0;
    const errors: string[] = [];

    for (const art of artifacts as any[]) {
      try {
        const result = await extractFactsFromDocument({
          dealId,
          bankId: access.bankId,
          documentId: art.source_id,
          docTypeHint: art.doc_type,
        });
        totalFacts += result.factsWritten;
        processed++;
      } catch (err: any) {
        errors.push(`${art.source_id}: ${err?.message ?? "unknown"}`);
      }
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.re_extract",
      uiState: "working",
      uiMessage: `Re-extracted facts from ${processed} documents (${totalFacts} facts)`,
      meta: {
        triggered_by: userId,
        documents_processed: processed,
        total_facts_written: totalFacts,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    return NextResponse.json({
      ok: true,
      documents_processed: processed,
      total_facts_written: totalFacts,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error("[re-extract] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}
