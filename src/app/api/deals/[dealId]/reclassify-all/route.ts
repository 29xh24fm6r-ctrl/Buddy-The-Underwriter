import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runGatekeeperForDocument } from "@/lib/gatekeeper/runGatekeeper";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { classifyAllDocs, type ClassifyLoopDoc } from "@/lib/gatekeeper/classifyAllDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Spec D5: serial gatekeeper over N docs; 300s ceiling covers a typical
// 9-doc test deal (each Gemini call ~2-8s) with headroom for retries.
// For deals with 50+ docs, a future spec should batch via the artifact
// worker queue.
export const maxDuration = 300;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/reclassify-all
 *
 * Force-reruns the Gemini gatekeeper classifier on every document of a deal.
 * Used when the classifier prompt changes (Spec D1: entity-name extraction
 * added in v2) or when a banker needs to bulk-correct misclassifications.
 *
 * This is DIFFERENT from /reextract-all and /reprocess-documents:
 * - /reextract-all, /reprocess-documents → re-run FACT extraction.
 * - /reclassify-all → re-run DOCUMENT-TYPE classification via gatekeeper.
 *
 * runGatekeeperForDocument's idempotency check is bypassed via
 * forceReclassify: true. The gatekeeper cache (bank_id, sha256, prompt_hash)
 * still applies, but a prompt-hash change (as with D1's v2 bump) forces
 * re-hits on Gemini and re-stamps ai_business_name / ai_borrower_name.
 *
 * After the serial loop completes the route fires maybeTriggerDealNaming
 * so newly-extracted entity names flow through to deals.display_name.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : 403;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const sb = supabaseAdmin();

    // Load every document on the deal that has been uploaded and (at least)
    // has a storage_path. sha256 may be null on docs that are still mid-OCR;
    // in that case the gatekeeper will fall through to its vision path or
    // fail-closed to NEEDS_REVIEW, both of which are acceptable here.
    const { data: docs, error: docErr } = await (sb as any)
      .from("deal_documents")
      .select(
        "id, deal_id, bank_id, sha256, ocr_text, storage_bucket, storage_path, mime_type, original_filename",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .not("storage_path", "is", null);

    if (docErr) {
      return NextResponse.json(
        { ok: false, error: `doc_load_failed: ${docErr.message}` },
        { status: 500 },
      );
    }

    if (!docs || docs.length === 0) {
      return NextResponse.json({
        ok: true,
        total: 0,
        reclassified: 0,
        failed: 0,
        message: "No documents to reclassify",
      });
    }

    const loopSummary = await classifyAllDocs(
      docs as ClassifyLoopDoc[],
      (doc) =>
        runGatekeeperForDocument({
          documentId: doc.id,
          dealId: doc.deal_id,
          bankId: doc.bank_id,
          sha256: doc.sha256 ?? null,
          ocrText: doc.ocr_text ?? null,
          storageBucket: doc.storage_bucket,
          storagePath: doc.storage_path,
          mimeType: doc.mime_type,
          forceReclassify: true,
        }),
    );
    const { reclassified, failed, results, errors } = loopSummary;

    // Fire naming derivation so new entity names reach deals.display_name.
    // maybeTriggerDealNaming is fire-and-forget safe and never throws, but
    // we still wrap in try/catch to be explicit about non-fatality.
    try {
      const { maybeTriggerDealNaming } = await import(
        "@/lib/naming/maybeTriggerDealNaming"
      );
      await maybeTriggerDealNaming(dealId, {
        bankId: access.bankId,
        reason: "reclassify_all_completed",
      });
    } catch (namingErr) {
      console.warn("[reclassify-all] naming trigger failed (non-fatal)", {
        dealId,
        error: namingErr instanceof Error ? namingErr.message : "unknown",
      });
    }

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "deal.reclassify_all",
      uiState: failed > 0 ? "error" : "done",
      uiMessage: `Reclassified ${reclassified}/${docs.length} documents${failed > 0 ? ` (${failed} failed)` : ""}`,
      meta: {
        triggered_by: access.userId,
        total: docs.length,
        reclassified,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      },
    });

    return NextResponse.json({
      ok: true,
      total: docs.length,
      reclassified,
      failed,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[reclassify-all] error", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
