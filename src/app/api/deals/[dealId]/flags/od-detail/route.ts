import "server-only";

/**
 * GET  /api/deals/[dealId]/flags/od-detail?year=2024
 * PATCH /api/deals/[dealId]/flags/od-detail — override category for a line item
 *
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-3
 *
 * Returns extracted OD_DETAIL_* facts for the deal, organized by year.
 * PATCH allows banker to override the normalized category without re-running extraction.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import {
  OD_CATEGORIES,
  OD_HIGH_RISK_CATEGORIES,
  OD_POTENTIAL_ADDBACK_CATEGORIES,
  OD_SUMMARY_KEYS,
} from "@/lib/financialSpreads/extractors/otherDeductionsDetailKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

// ── GET: fetch OD detail for a deal ─────────────────────────────────────────

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const year = req.nextUrl.searchParams.get("year");
    const sb = supabaseAdmin();

    // Fetch all OD_DETAIL_* facts for this deal
    let query = (sb as any)
      .from("deal_financial_facts")
      .select("id, fact_key, fact_value_num, fact_value_text, fact_period_end, confidence, provenance, source_document_id, resolution_status, is_superseded")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .like("fact_key", "OD_DETAIL_%");

    if (year) {
      query = query.gte("fact_period_end", `${year}-01-01`).lte("fact_period_end", `${year}-12-31`);
    }

    const { data: facts, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (facts ?? []) as Array<{
      id: string;
      fact_key: string;
      fact_value_num: number | null;
      fact_value_text: string | null;
      fact_period_end: string | null;
      confidence: number | null;
      provenance: any;
      source_document_id: string | null;
      resolution_status: string | null;
      is_superseded: boolean;
    }>;

    // Also fetch the aggregate OTHER_DEDUCTIONS for comparison
    const { data: aggregateRows } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, fact_period_end")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .eq("fact_key", "OTHER_DEDUCTIONS");

    // Organize by year
    const byYear: Record<number, {
      aggregate: number | null;
      detailTotal: number | null;
      reconciled: boolean | null;
      variance: number | null;
      lines: Array<{
        id: string;
        factKey: string;
        category: string;
        amount: number | null;
        confidence: number | null;
        sourceDocumentId: string | null;
        isHighRisk: boolean;
        isPotentialAddback: boolean;
        provenance: any;
      }>;
    }> = {};

    for (const row of rows) {
      const yearNum = row.fact_period_end ? new Date(row.fact_period_end).getFullYear() : 0;
      if (!byYear[yearNum]) {
        byYear[yearNum] = { aggregate: null, detailTotal: null, reconciled: null, variance: null, lines: [] };
      }
      const entry = byYear[yearNum];
      const key = row.fact_key;

      if (key === OD_SUMMARY_KEYS.DETAIL_TOTAL) {
        entry.detailTotal = row.fact_value_num;
      } else if (key === OD_SUMMARY_KEYS.RECONCILED) {
        entry.reconciled = row.fact_value_num === 1;
      } else if (
        key !== OD_SUMMARY_KEYS.UNCATEGORIZED_TOTAL &&
        key !== OD_SUMMARY_KEYS.RELATED_PARTY_TOTAL &&
        key !== OD_SUMMARY_KEYS.POTENTIAL_ADDBACK_TOTAL &&
        key !== OD_SUMMARY_KEYS.NON_RECURRING_TOTAL
      ) {
        // Individual category line
        const category = key.replace("OD_DETAIL_", "");
        entry.lines.push({
          id: row.id,
          factKey: key,
          category,
          amount: row.fact_value_num,
          confidence: row.confidence,
          sourceDocumentId: row.source_document_id,
          isHighRisk: OD_HIGH_RISK_CATEGORIES.has(category as any),
          isPotentialAddback: OD_POTENTIAL_ADDBACK_CATEGORIES.has(category as any),
          provenance: row.provenance,
        });
      }
    }

    // Fill aggregate from OTHER_DEDUCTIONS facts
    for (const agg of (aggregateRows ?? []) as any[]) {
      const yearNum = agg.fact_period_end ? new Date(agg.fact_period_end).getFullYear() : 0;
      if (byYear[yearNum]) {
        byYear[yearNum].aggregate = agg.fact_value_num;
      }
    }

    // Compute variance
    for (const entry of Object.values(byYear)) {
      if (entry.aggregate != null && entry.detailTotal != null) {
        entry.variance = Math.abs(entry.aggregate - entry.detailTotal);
      }
    }

    return NextResponse.json({
      ok: true,
      years: byYear,
      categories: OD_CATEGORIES,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

// ── PATCH: override category for a line item ────────────────────────────────

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const body = await req.json();
    const { fact_id, action, new_category, note } = body as {
      fact_id: string;
      action: "recategorize" | "mark_addback" | "mark_reviewed" | "mark_non_recurring";
      new_category?: string;
      note?: string;
    };

    if (!fact_id || !action) {
      return NextResponse.json({ ok: false, error: "fact_id and action required" }, { status: 422 });
    }

    const sb = supabaseAdmin();

    // Verify fact belongs to this deal
    const { data: fact } = await (sb as any)
      .from("deal_financial_facts")
      .select("id, fact_key, deal_id")
      .eq("id", fact_id)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!fact) {
      return NextResponse.json({ ok: false, error: "fact_not_found" }, { status: 404 });
    }

    if (action === "recategorize") {
      if (!new_category || !OD_CATEGORIES.includes(new_category as any)) {
        return NextResponse.json({ ok: false, error: "Invalid category" }, { status: 422 });
      }
      // Supersede old fact, create new one with corrected key
      await (sb as any)
        .from("deal_financial_facts")
        .update({
          is_superseded: true,
          resolution_status: "banker_overridden",
        })
        .eq("id", fact_id);

      // The new fact with corrected category will be written by the next
      // flag regeneration or can be done here as a direct insert.
      // For now, mark superseded + store override metadata.
    }

    if (action === "mark_reviewed") {
      await (sb as any)
        .from("deal_financial_facts")
        .update({ resolution_status: "banker_reviewed" })
        .eq("id", fact_id);
    }

    if (action === "mark_addback" || action === "mark_non_recurring") {
      await (sb as any)
        .from("deal_financial_facts")
        .update({
          resolution_status: action === "mark_addback" ? "banker_addback" : "banker_non_recurring",
        })
        .eq("id", fact_id);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
