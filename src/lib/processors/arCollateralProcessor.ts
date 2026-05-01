import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";
import { getArCollateralPolicy, type ArCollateralPolicy } from "@/lib/policy/arCollateralPolicy";
import {
  parseARAgingTable as parseARAgingTablePure,
  sampleHeaders as sampleHeadersPure,
  type ArAgingCustomerRow,
} from "@/lib/processors/arAgingParser";

/**
 * AR Collateral Processor
 *
 * Triggered when a document classified as AR_AGING has finished extraction.
 * Reads document_extracts.tables_json, parses customer rows, applies
 * eligibility rules, computes the borrowing base, and persists:
 *   - ar_aging_reports            (status: extracting → complete | failed)
 *   - ar_aging_customers
 *   - borrowing_base_calculations
 *   - deal_financial_facts        (TOTAL_AR / OVER_90_AR / ELIGIBLE_AR)
 *   - deal_events                 (kind: "ar_borrowing_base_calculated")
 *
 * Call site: invoke from the extract job processor when
 * document_type === 'AR_AGING' and the extract upsert succeeded.
 * NOT from intel/run.
 */

export type ArCollateralResult =
  | { ok: true; reportId: string; netAvailability: number }
  | { ok: false; error: string };

type CustomerRow = ArAgingCustomerRow;

type Totals = {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
  total: number;
};

const EXTRACTOR_VERSION = "arCollateralProcessor@v1";

export async function processArCollateral(args: {
  dealId: string;
  bankId: string;
  documentId: string;
}): Promise<ArCollateralResult> {
  const { dealId, bankId, documentId } = args;
  const sb = supabaseAdmin();

  console.log("[AR] start", { dealId, documentId }); // TEMP — remove after validation

  const { data: extract, error: extractErr } = await (sb as any)
    .from("document_extracts")
    .select("tables_json, fields_json")
    .eq("attachment_id", documentId)
    .maybeSingle();

  if (extractErr || !extract) {
    return { ok: false, error: extractErr?.message ?? "document_extracts row not found" };
  }

  // Coarse concurrency guard. Not a strict mutex — two runs that both pass this
  // check between SELECT and INSERT will still race. Catches the common case
  // (job retry / duplicate dispatch). A UNIQUE index on source_document_id
  // would be the strict fix.
  const { data: existing } = await (sb as any)
    .from("ar_aging_reports")
    .select("id, extraction_status")
    .eq("source_document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.extraction_status === "extracting") {
    return { ok: false, error: "concurrent run already in-flight" };
  }

  // Idempotency: clear any prior (terminal) report for this document so children cascade out.
  await (sb as any)
    .from("ar_aging_reports")
    .delete()
    .eq("source_document_id", documentId);

  const asOfDate = detectAsOfDate(extract.fields_json);

  const { data: reportInsert, error: reportErr } = await (sb as any)
    .from("ar_aging_reports")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      source_document_id: documentId,
      as_of_date: asOfDate,
      extraction_status: "extracting",
      raw_json: extract.tables_json,
    })
    .select("id")
    .single();

  if (reportErr || !reportInsert) {
    return { ok: false, error: reportErr?.message ?? "ar_aging_reports insert failed" };
  }

  const reportId = reportInsert.id as string;

  try {
    const rows = parseARAgingTable(extract.tables_json);
    if (rows.length === 0) {
      await writeEvent({
        dealId,
        kind: "ar_aging_parse_failed",
        scope: "collateral",
        action: "parse_failed",
        requiresHumanReview: true,
        meta: {
          documentId,
          dealId,
          headers: sampleHeaders(extract.tables_json),
          reason: "no recognizable AR aging structure",
          extractor: EXTRACTOR_VERSION,
        },
      });
      throw new Error("no AR aging rows could be parsed from tables_json");
    }

    console.log("[AR] parsed_rows", { count: rows.length }); // TEMP — remove after validation

    const totals = computeTotals(rows);

    console.log("[AR] totals", totals); // TEMP — remove after validation

    // Sanity bounds — protect against OCR hallucinations, parsing bugs, garbage uploads.
    // Upper bound is intentionally generous; anything beyond $1B AR for a single
    // borrower should be reviewed by a human before it touches the borrowing base.
    if (totals.total <= 0 || totals.total > 1_000_000_000) {
      await writeEvent({
        dealId,
        kind: "ar_aging_sanity_check_failed",
        scope: "collateral",
        action: "sanity_check_failed",
        requiresHumanReview: true,
        meta: {
          dealId,
          documentId,
          totalAr: totals.total,
          reason: "invalid_ar_total",
          bounds: { minExclusive: 0, maxInclusive: 1_000_000_000 },
          extractor: EXTRACTOR_VERSION,
        },
      });
      throw new Error(`Invalid AR total: ${totals.total}`);
    }

    await (sb as any)
      .from("ar_aging_reports")
      .update({
        total_ar: totals.total,
        current_amount: totals.current,
        days_30: totals.d30,
        days_60: totals.d60,
        days_90: totals.d90,
        days_120: totals.d120,
        extraction_status: "complete",
      })
      .eq("id", reportId);

    await (sb as any).from("ar_aging_customers").insert(
      rows.map((r) => ({
        report_id: reportId,
        deal_id: dealId,
        bank_id: bankId,
        customer_name: r.customer,
        total_amount: r.total,
        current_amount: r.current,
        days_30: r.d30,
        days_60: r.d60,
        days_90: r.d90,
        days_120: r.d120,
      })),
    );

    const policy = await getArCollateralPolicy(sb as any, bankId);

    await applyEligibility({
      sb,
      reportId,
      totalAr: totals.total,
      concentrationLimit: policy.concentrationLimit,
    });

    const bb = await calculateBorrowingBase({
      sb,
      reportId,
      dealId,
      bankId,
      policy,
    });

    console.log("[AR] borrowing_base", { // TEMP — remove after validation
      gross: bb.grossAr,
      eligible: bb.eligibleAr,
      net: bb.netAvailability,
    });

    await writeSummaryFacts({
      dealId,
      bankId,
      sourceDocumentId: documentId,
      asOfDate,
      totalAr: totals.total,
      over90Ar: totals.d90 + totals.d120,
      eligibleAr: bb.eligibleAr,
    });

    await writeEvent({
      dealId,
      kind: "ar_borrowing_base_calculated",
      scope: "collateral",
      action: "borrowing_base_calculated",
      meta: {
        report_id: reportId,
        document_id: documentId,
        as_of_date: asOfDate,
        total_ar: totals.total,
        eligible_ar: bb.eligibleAr,
        ineligible_ar: bb.ineligibleAr,
        advance_rate: policy.advanceRate,
        concentration_limit: policy.concentrationLimit,
        concentration_reserve_pct: policy.concentrationReserve,
        dilution_reserve_pct: policy.dilutionReserve,
        net_availability: bb.netAvailability,
        policy_source: policy.source,
        extractor: EXTRACTOR_VERSION,
      },
    });

    return { ok: true, reportId, netAvailability: bb.netAvailability };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await (sb as any)
      .from("ar_aging_reports")
      .update({ extraction_status: "failed" })
      .eq("id", reportId);
    return { ok: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility
// ─────────────────────────────────────────────────────────────────────────────

async function applyEligibility(args: {
  sb: any;
  reportId: string;
  totalAr: number;
  concentrationLimit: number;
}) {
  const { sb, reportId, totalAr, concentrationLimit } = args;

  const { data: customers } = await sb
    .from("ar_aging_customers")
    .select("id, total_amount, days_90, days_120")
    .eq("report_id", reportId);

  const list = (customers ?? []) as Array<{
    id: string;
    total_amount: number | null;
    days_90: number | null;
    days_120: number | null;
  }>;

  for (const c of list) {
    const over90 = (Number(c.days_90) || 0) + (Number(c.days_120) || 0);
    const concentration = totalAr > 0 ? Number(c.total_amount ?? 0) / totalAr : 0;

    let isIneligible = false;
    let reason: string | null = null;

    if (over90 > 0) {
      isIneligible = true;
      reason = "over_90_days";
    } else if (concentration > concentrationLimit) {
      isIneligible = true;
      reason = "concentration_limit";
    }

    await sb
      .from("ar_aging_customers")
      .update({
        concentration_pct: concentration,
        is_ineligible: isIneligible,
        ineligibility_reason: reason,
      })
      .eq("id", c.id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Borrowing base
// ─────────────────────────────────────────────────────────────────────────────

async function calculateBorrowingBase(args: {
  sb: any;
  reportId: string;
  dealId: string;
  bankId: string;
  policy: ArCollateralPolicy;
}) {
  const { sb, reportId, dealId, bankId, policy } = args;

  const { data: customers } = await sb
    .from("ar_aging_customers")
    .select("total_amount, is_ineligible")
    .eq("report_id", reportId);

  const list = (customers ?? []) as Array<{
    total_amount: number | null;
    is_ineligible: boolean | null;
  }>;

  const grossAr = list.reduce((s, c) => s + Number(c.total_amount ?? 0), 0);
  const ineligibleAr = list
    .filter((c) => c.is_ineligible === true)
    .reduce((s, c) => s + Number(c.total_amount ?? 0), 0);
  const eligibleAr = grossAr - ineligibleAr;

  const concentrationReserve = eligibleAr * policy.concentrationReserve;
  const dilutionReserve = eligibleAr * policy.dilutionReserve;
  const netAvailability =
    eligibleAr * policy.advanceRate - concentrationReserve - dilutionReserve;

  await sb.from("borrowing_base_calculations").insert({
    deal_id: dealId,
    bank_id: bankId,
    report_id: reportId,
    gross_ar: grossAr,
    ineligible_ar: ineligibleAr,
    eligible_ar: eligibleAr,
    advance_rate: policy.advanceRate,
    concentration_reserve: concentrationReserve,
    dilution_reserve: dilutionReserve,
    net_availability: netAvailability,
  });

  return {
    grossAr,
    ineligibleAr,
    eligibleAr,
    concentrationReserve,
    dilutionReserve,
    netAvailability,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary facts
// ─────────────────────────────────────────────────────────────────────────────

async function writeSummaryFacts(args: {
  dealId: string;
  bankId: string;
  sourceDocumentId: string;
  asOfDate: string | null;
  totalAr: number;
  over90Ar: number;
  eligibleAr: number;
}) {
  const provenance = {
    source_type: "DOC_EXTRACT" as const,
    source_ref: `deal_documents:${args.sourceDocumentId}`,
    as_of_date: args.asOfDate,
    extractor: EXTRACTOR_VERSION,
    section_type: "AR_AGING" as const,
  };
  const period = args.asOfDate;

  await Promise.all([
    upsertDealFinancialFact({
      dealId: args.dealId,
      bankId: args.bankId,
      sourceDocumentId: args.sourceDocumentId,
      factType: "AR_AGING",
      factKey: "TOTAL_AR",
      factValueNum: args.totalAr,
      confidence: null,
      factPeriodStart: period,
      factPeriodEnd: period,
      provenance,
    }),
    upsertDealFinancialFact({
      dealId: args.dealId,
      bankId: args.bankId,
      sourceDocumentId: args.sourceDocumentId,
      factType: "AR_AGING",
      factKey: "OVER_90_AR",
      factValueNum: args.over90Ar,
      confidence: null,
      factPeriodStart: period,
      factPeriodEnd: period,
      provenance,
    }),
    upsertDealFinancialFact({
      dealId: args.dealId,
      bankId: args.bankId,
      sourceDocumentId: args.sourceDocumentId,
      factType: "AR_AGING",
      factKey: "ELIGIBLE_AR",
      factValueNum: args.eligibleAr,
      confidence: null,
      factPeriodStart: period,
      factPeriodEnd: period,
      provenance,
    }),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing helpers — re-exported from the pure parser module so existing
// callers and the live downstream pipeline remain unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export const parseARAgingTable = parseARAgingTablePure;
export const sampleHeaders = sampleHeadersPure;

function computeTotals(rows: CustomerRow[]): Totals {
  const t: Totals = { current: 0, d30: 0, d60: 0, d90: 0, d120: 0, total: 0 };
  for (const r of rows) {
    t.current += r.current;
    t.d30 += r.d30;
    t.d60 += r.d60;
    t.d90 += r.d90;
    t.d120 += r.d120;
    t.total += r.total;
  }
  return t;
}

function detectAsOfDate(fieldsJson: unknown): string | null {
  if (!fieldsJson || typeof fieldsJson !== "object") return null;
  const f = fieldsJson as Record<string, unknown>;
  const candidates: unknown[] = [
    f.as_of_date,
    f.report_date,
    f.statement_date,
    (f.metadata as any)?.as_of_date,
  ];
  for (const v of candidates) {
    if (typeof v !== "string") continue;
    const m = /^\d{4}-\d{2}-\d{2}/.exec(v);
    if (m) return m[0];
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}
