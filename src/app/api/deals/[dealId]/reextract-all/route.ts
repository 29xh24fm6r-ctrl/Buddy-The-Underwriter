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
 * POST /api/deals/[dealId]/reextract-all
 *
 * Bulk re-extraction: re-runs fact extraction for every classified document
 * in the deal, orchestrates spreads, and triggers Global Cash Flow computation.
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
        skipped: 0,
        factsWritten: 0,
        message: "No classified documents to re-extract",
      });
    }

    let queued = 0;
    let skipped = 0;
    let factsWritten = 0;
    const spreadTypesNeeded = new Set<SpreadType>();
    const errors: string[] = [];

    // Sequential extraction — one document at a time
    for (const doc of allDocs) {
      try {
        const docType =
          doc.canonical_type ?? doc.ai_doc_type ?? doc.document_type;

        const result = await extractFactsFromDocument({
          dealId,
          bankId: access.bankId,
          documentId: doc.id,
          docTypeHint: docType,
        });

        factsWritten += result.factsWritten;
        queued++;

        for (const st of spreadsForDocType(docType)) {
          spreadTypesNeeded.add(st);
        }
      } catch (err: any) {
        skipped++;
        errors.push(`${doc.id}: ${err?.message ?? "unknown"}`);
      }
    }

    // STANDARD spread is always needed when any docs processed
    if (queued > 0) spreadTypesNeeded.add("STANDARD");

    // Orchestrate spreads
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

    // Trigger Global Cash Flow computation
    let gcfResult: any = null;
    try {
      const { persistGlobalCashFlow } = await import(
        "@/lib/financialIntelligence/persistGlobalCashFlow"
      );
      gcfResult = await persistGlobalCashFlow({
        dealId,
        bankId: access.bankId,
      });
    } catch (gcfErr: any) {
      errors.push(`gcf: ${gcfErr?.message ?? "unknown"}`);
    }

    // Emit ledger event
    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "reextraction.batch.completed",
      uiState: "working",
      uiMessage: `Bulk re-extracted ${queued} documents (${factsWritten} facts), ${skipped} skipped`,
      meta: {
        triggered_by: userId,
        queued,
        skipped,
        facts_written: factsWritten,
        spread_types: Array.from(spreadTypesNeeded),
        orchestrate: orchestrateResult,
        gcf: gcfResult?.ok
          ? {
              factsWritten: gcfResult.factsWritten,
              globalCashFlowAvailable: gcfResult.result?.globalCashFlowAvailable,
              globalDscr: gcfResult.result?.globalDscr,
            }
          : null,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    return NextResponse.json({
      ok: true,
      queued,
      skipped,
      factsWritten,
      spreadTypes: Array.from(spreadTypesNeeded),
      gcf: gcfResult?.ok ?? false,
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
