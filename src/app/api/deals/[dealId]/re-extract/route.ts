import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromDocument } from "@/lib/financialSpreads/extractFactsFromDocument";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { clerkAuth } from "@/lib/auth/clerkServer";
import type { SpreadType } from "@/lib/financialSpreads/types";
import { spreadsForDocType } from "@/lib/financialSpreads/docTypeToSpreadTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/re-extract
 *
 * Re-runs fact extraction + spread rendering for all classified documents
 * in a deal. Reads document types from deal_documents (the authoritative
 * source stamped by processArtifact or manual UI classification).
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

    // Read from deal_documents — the authoritative source for doc types.
    // processArtifact stamps document_type here; manual classification sets it too.
    const { data: docs } = await sb
      .from("deal_documents" as any)
      .select("id, document_type, ai_doc_type, original_filename")
      .eq("deal_id", dealId)
      .not("document_type", "is", null);

    if (!docs || docs.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No classified documents to re-extract",
        documents_processed: 0,
        total_facts_written: 0,
      });
    }

    let totalFacts = 0;
    let processed = 0;
    const spreadTypesNeeded = new Set<SpreadType>();
    const errors: string[] = [];

    for (const doc of docs as any[]) {
      try {
        const docType = doc.ai_doc_type ?? doc.document_type;
        const result = await extractFactsFromDocument({
          dealId,
          bankId: access.bankId,
          documentId: doc.id,
          docTypeHint: docType,
        });
        totalFacts += result.factsWritten;
        processed++;

        // Collect spread types needed
        for (const st of spreadsForDocType(docType)) {
          spreadTypesNeeded.add(st);
        }
      } catch (err: any) {
        errors.push(`${doc.id}: ${err?.message ?? "unknown"}`);
      }
    }

    // E2: Trigger spread orchestration after re-extraction
    let orchestrateResult: any = null;
    try {
      const { orchestrateSpreads } = await import(
        "@/lib/spreads/orchestrateSpreads"
      );
      orchestrateResult = await orchestrateSpreads(
        dealId,
        access.bankId,
        "recompute",
        userId,
      );
    } catch (orchErr: any) {
      errors.push(`orchestrate: ${orchErr?.message ?? "unknown"}`);
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.re_extract",
      uiState: "working",
      uiMessage: `Re-extracted facts from ${processed} documents (${totalFacts} facts), orchestrated spreads`,
      meta: {
        triggered_by: userId,
        documents_processed: processed,
        total_facts_written: totalFacts,
        spread_types: Array.from(spreadTypesNeeded),
        orchestrate: orchestrateResult,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    return NextResponse.json({
      ok: true,
      documents_processed: processed,
      total_facts_written: totalFacts,
      spread_types_enqueued: Array.from(spreadTypesNeeded),
      orchestrate: orchestrateResult,
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
