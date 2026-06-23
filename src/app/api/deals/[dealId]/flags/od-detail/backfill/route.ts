import "server-only";

/**
 * POST /api/deals/[dealId]/flags/od-detail/backfill
 *
 * Runs the OD detail extractor against existing BUSINESS_TAX_RETURN documents
 * for the deal and writes OD_DETAIL_* facts without full re-extraction.
 *
 * Steps:
 * 1. Find BUSINESS_TAX_RETURN documents with OCR text
 * 2. Run extractOtherDeductionsDetail on each
 * 3. Write OD_DETAIL_* facts via writeFactsBatch
 * 4. Compute reconciliation (detail total vs aggregate OTHER_DEDUCTIONS)
 * 5. Regenerate risk flags
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { extractOtherDeductionsDetail } from "@/lib/financialSpreads/extractors/deterministic/otherDeductionsDetailDeterministic";
import { writeFactsBatch, normalizePeriod } from "@/lib/financialSpreads/extractors/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Completeness floor: a backfill detail total below this fraction of the
// aggregate OTHER_DEDUCTIONS is treated as a partial/incomplete extraction.
// We do not persist OD_DETAIL facts in that case — a non-reconciling total
// would create a spurious other_deductions_detail_sum_mismatch. Mirrors the
// 5x upper-bound noise gate on the other side.
const OD_DETAIL_MIN_COMPLETENESS_RATIO = 0.8;

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();
    const bankId = access.bankId;

    // 1. Find BUSINESS_TAX_RETURN documents with OCR text
    const { data: docs } = await (sb as any)
      .from("deal_documents")
      .select("id, canonical_type, doc_year")
      .eq("deal_id", dealId)
      .eq("canonical_type", "BUSINESS_TAX_RETURN")
      .order("doc_year", { ascending: false });

    if (!docs || docs.length === 0) {
      return NextResponse.json({
        ok: true,
        result: "no_tax_returns",
        message: "No BUSINESS_TAX_RETURN documents found for this deal.",
        documentsScanned: 0,
        detailLinesFound: 0,
      });
    }

    const results: Array<{
      documentId: string;
      year: number | null;
      linesFound: number;
      detailTotal: number | null;
      aggregate: number | null;
      reconciled: boolean | null;
      reason: string | null;
    }> = [];

    let totalFactsWritten = 0;

    for (const doc of docs as Array<{ id: string; doc_year: number | null }>) {
      // Load OCR text
      const { data: ocrRow } = await (sb as any)
        .from("document_ocr_results")
        .select("extracted_text")
        .eq("attachment_id", doc.id)
        .limit(1)
        .maybeSingle();

      const ocrText = ocrRow?.extracted_text ?? "";
      if (!ocrText || ocrText.length < 100) {
        results.push({
          documentId: doc.id,
          year: doc.doc_year,
          linesFound: 0,
          detailTotal: null,
          aggregate: null,
          reconciled: null,
          reason: "OCR text too short or missing",
        });
        continue;
      }

      // 2. Run extractor
      const extractResult = extractOtherDeductionsDetail({
        dealId,
        bankId,
        documentId: doc.id,
        ocrText,
      } as any);

      if (!extractResult.ok || extractResult.items.length === 0) {
        results.push({
          documentId: doc.id,
          year: doc.doc_year,
          linesFound: 0,
          detailTotal: null,
          aggregate: null,
          reconciled: null,
          reason: "No Other Deductions statement found in OCR text",
        });
        continue;
      }

      // 2b. Plausibility check: detail total vs aggregate
      const extractedTotal = extractResult.items.find((i) => i.key === "OD_DETAIL_TOTAL");
      const extractedTotalValue = typeof extractedTotal?.value === "number" ? extractedTotal.value : 0;

      // Load aggregate for comparison
      let preCheckAggregate: number | null = null;
      if (doc.doc_year) {
        const { data: aggCheck } = await (sb as any)
          .from("deal_financial_facts")
          .select("fact_value_num")
          .eq("deal_id", dealId)
          .eq("fact_key", "OTHER_DEDUCTIONS")
          .eq("is_superseded", false)
          .gte("fact_period_end", `${doc.doc_year}-01-01`)
          .lte("fact_period_end", `${doc.doc_year}-12-31`)
          .maybeSingle();
        preCheckAggregate = aggCheck?.fact_value_num ?? null;
      }

      // Plausibility + completeness gate. The extracted detail total must sit in
      // a believable band around the aggregate OTHER_DEDUCTIONS:
      //   • too high (>5x aggregate) → OCR noise / garbage extraction
      //   • too low (<80% of aggregate) → partial/incomplete extraction that
      //     cannot reconcile (e.g. $75k detail vs $2.34M aggregate)
      // In either case we must NOT write OD_DETAIL facts — a non-reconciling
      // total would create a spurious other_deductions_detail_sum_mismatch — and
      // we supersede any stale OD_DETAIL facts so flag regeneration clears prior
      // mismatches. Invalidating facts without clearing dependent flags is the
      // bug this route must not cause.
      let rejectReason: string | null = null;
      if (preCheckAggregate != null && extractedTotalValue > preCheckAggregate * 5) {
        rejectReason = `Extraction invalid: detail total ($${extractedTotalValue.toLocaleString()}) exceeds 5x aggregate ($${preCheckAggregate.toLocaleString()})`;
      } else if (
        preCheckAggregate != null &&
        preCheckAggregate > 0 &&
        extractedTotalValue < preCheckAggregate * OD_DETAIL_MIN_COMPLETENESS_RATIO
      ) {
        const pct = Math.round((extractedTotalValue / preCheckAggregate) * 100);
        rejectReason = `Statement found but incomplete/unreconciled: detail total ($${extractedTotalValue.toLocaleString()}) is only ${pct}% of aggregate ($${preCheckAggregate.toLocaleString()}) — borrower breakdown required`;
      }
      if (rejectReason) {
        if (doc.doc_year) {
          await (sb as any)
            .from("deal_financial_facts")
            .update({ is_superseded: true, resolution_status: "system_invalidated" })
            .eq("deal_id", dealId)
            .eq("bank_id", bankId)
            .like("fact_key", "OD_DETAIL%")
            .eq("is_superseded", false)
            .gte("fact_period_end", `${doc.doc_year}-01-01`)
            .lte("fact_period_end", `${doc.doc_year}-12-31`);
        }
        results.push({
          documentId: doc.id,
          year: doc.doc_year,
          linesFound: 0,
          detailTotal: extractedTotalValue,
          aggregate: preCheckAggregate,
          reconciled: null,
          reason: rejectReason,
        });
        continue;
      }

      // 3. Write facts
      const taxYear = doc.doc_year;
      const period = taxYear ? `FY${taxYear}` : null;
      const { start: periodStart, end: periodEnd } = normalizePeriod(period);

      const asOfDate = periodEnd ?? new Date().toISOString().slice(0, 10);
      const mapped = extractResult.items
        .filter((i) => typeof i.value === "number")
        .map((i) => ({
          factKey: i.key,
          value: i.value as number,
          confidence: 0.50,
          periodStart,
          periodEnd,
          provenance: {
            source_type: "DOC_EXTRACT" as const,
            source_ref: `tax_return:${doc.id}:od_detail_backfill`,
            as_of_date: asOfDate,
            extractor: "otherDeductionsDetail:backfill:v1",
            calc: i.snippet ?? undefined,
          },
        }));

      const writeResult = await writeFactsBatch({
        dealId,
        bankId,
        sourceDocumentId: doc.id,
        factType: "TAX_RETURN_OTHER_DEDUCTIONS_DETAIL",
        items: mapped,
      });
      totalFactsWritten += writeResult.factsWritten;

      // 4. Reconciliation
      const detailTotalItem = extractResult.items.find((i) => i.key === "OD_DETAIL_TOTAL");
      const detailTotal = typeof detailTotalItem?.value === "number" ? detailTotalItem.value : null;

      // Load aggregate OTHER_DEDUCTIONS for this year
      let aggregate: number | null = null;
      if (taxYear) {
        const { data: aggRow } = await (sb as any)
          .from("deal_financial_facts")
          .select("fact_value_num")
          .eq("deal_id", dealId)
          .eq("fact_key", "OTHER_DEDUCTIONS")
          .eq("is_superseded", false)
          .gte("fact_period_end", `${taxYear}-01-01`)
          .lte("fact_period_end", `${taxYear}-12-31`)
          .maybeSingle();
        aggregate = aggRow?.fact_value_num ?? null;
      }

      let reconciled: boolean | null = null;
      if (detailTotal != null && aggregate != null) {
        reconciled = Math.abs(aggregate - detailTotal) <= 1;
        // Write reconciliation fact
        await writeFactsBatch({
          dealId,
          bankId,
          sourceDocumentId: doc.id,
          factType: "TAX_RETURN_OTHER_DEDUCTIONS_DETAIL",
          items: [{
            factKey: "OD_DETAIL_RECONCILED",
            value: reconciled ? 1 : 0,
            confidence: 0.90,
            periodStart,
            periodEnd,
            provenance: {
              source_type: "DOC_EXTRACT",
              source_ref: `tax_return:${doc.id}:od_reconciliation`,
              as_of_date: periodEnd ?? new Date().toISOString().slice(0, 10),
              extractor: "otherDeductionsDetail:reconciliation:v1",
              calc: `|${aggregate} - ${detailTotal}| = ${Math.abs(aggregate - detailTotal)}`,
            },
          }],
        });
      }

      results.push({
        documentId: doc.id,
        year: doc.doc_year,
        linesFound: extractResult.items.filter((i) => !i.key.includes("TOTAL") && !i.key.includes("RECONCILED")).length,
        detailTotal,
        aggregate,
        reconciled,
        reason: null,
      });
    }

    // 5. Regenerate risk flags
    let flagCount = 0;
    try {
      const { generateAndPersistFlags } = await import("@/lib/flagEngine/persistFlagReport");
      const flagResult = await generateAndPersistFlags(dealId, bankId);
      flagCount = flagResult.flagCount;
    } catch {
      // Non-fatal
    }

    return NextResponse.json({
      ok: true,
      result: "backfill_complete",
      documentsScanned: docs.length,
      totalFactsWritten,
      flagsRegenerated: flagCount,
      details: results,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[od-detail/backfill]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected_error" }, { status: 500 });
  }
}
