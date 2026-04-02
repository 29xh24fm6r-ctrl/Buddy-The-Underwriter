import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromDocument } from "@/lib/financialSpreads/extractFactsFromDocument";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import type { SpreadType } from "@/lib/financialSpreads/types";
import { spreadsForDocType } from "@/lib/financialSpreads/docTypeToSpreadTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/reprocess-documents
 *
 * Admin-only endpoint to re-extract facts from all classified documents.
 * Triggers spread orchestration after extraction so new canonical keys
 * (SL_*, M1_*, F4562_*, etc.) populate the spread output.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    const access = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.status }
      );
    }
    const { userId } = access;

    const sb = supabaseAdmin();

    // Load all classified documents for this deal
    const { data: docs } = await sb
      .from("deal_documents" as any)
      .select("id, document_type, ai_doc_type, canonical_type, original_filename")
      .eq("deal_id", dealId)
      .not("document_type", "is", null);

    if (!docs || docs.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No classified documents to reprocess",
        reprocessed: 0,
        total_facts_written: 0,
      });
    }

    let totalFacts = 0;
    let reprocessed = 0;
    const spreadTypesNeeded = new Set<SpreadType>();
    const errors: string[] = [];

    for (const doc of docs as any[]) {
      try {
        const docType = doc.canonical_type ?? doc.ai_doc_type ?? doc.document_type;
        const result = await extractFactsFromDocument({
          dealId,
          bankId: access.bankId,
          documentId: doc.id,
          docTypeHint: docType,
        });
        totalFacts += result.factsWritten;
        reprocessed++;

        for (const st of spreadsForDocType(docType)) {
          spreadTypesNeeded.add(st);
        }
      } catch (err: any) {
        errors.push(`${doc.id}: ${err?.message ?? "unknown"}`);
      }
    }

    // Trigger spread orchestration after re-extraction
    if (reprocessed > 0) {
      spreadTypesNeeded.add("STANDARD");
      try {
        const { orchestrateSpreads } = await import(
          "@/lib/spreads/orchestrateSpreads"
        );
        await orchestrateSpreads(dealId, access.bankId, "recompute", userId);
      } catch (orchErr: any) {
        errors.push(`orchestrate: ${orchErr?.message ?? "unknown"}`);
      }
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.reprocess_documents",
      uiState: "working",
      uiMessage: `Reprocessed ${reprocessed} documents (${totalFacts} facts)`,
      meta: {
        triggered_by: userId,
        reprocessed,
        total_facts_written: totalFacts,
        spread_types: Array.from(spreadTypesNeeded),
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    return NextResponse.json({
      ok: true,
      reprocessed,
      total_facts_written: totalFacts,
      spread_types_enqueued: Array.from(spreadTypesNeeded),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    rethrowNextErrors(error);
    console.error("[reprocess-documents] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}
