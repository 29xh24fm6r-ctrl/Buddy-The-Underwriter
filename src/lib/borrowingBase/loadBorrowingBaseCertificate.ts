import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getArCollateralPolicy } from "@/lib/policy/arCollateralPolicy";
import {
  buildBorrowingBaseCertificate,
  isBorrowingBaseActive,
  type BorrowingBaseCertificate,
} from "./borrowingBaseCertificate";
import { DEFAULT_ENABLED_CATEGORIES, type EligibilityCustomer } from "./eligibilityRules";

/**
 * SPEC-BORROWING-BASE-CERTIFICATE-ENGINE-1 (Phase 5) — server-side assembly of a Borrowing Base
 * Certificate from the AR-collateral tables already populated by arCollateralProcessor.
 *
 * Activation is data-driven (isBorrowingBaseActive): if no AR aging report exists for the deal the
 * facility is not borrowing-base monitored and this returns null — the caller renders "AR collateral
 * analysis only" / nothing. Reuses ar_aging_reports / ar_aging_customers / borrowing_base_calculations
 * and getArCollateralPolicy; adds no tables and no routes.
 *
 * Read-only: it never writes facts, never touches classic_spread_review_actions, and never clears a
 * source-detail blocker. A date mismatch surfaces as a certificate exception only.
 */
export async function loadBorrowingBaseCertificate(args: {
  dealId: string;
  bankId: string;
  borrowerName: string;
  lenderName: string;
  /** ISO date the certificate is produced (e.g. today). */
  certificateDateIso: string;
  /** Most-recent balance-sheet period end the spread renders (ISO), for the date-mismatch check. */
  balanceSheetAsOfIso?: string | null;
  facilityLimit?: number | null;
  outstandingPrincipal?: number | null;
}): Promise<BorrowingBaseCertificate | null> {
  const { dealId, bankId } = args;
  const sb = supabaseAdmin();

  // Latest COMPLETE AR aging report for this deal/bank — the activation signal.
  const { data: reports } = await (sb as any)
    .from("ar_aging_reports")
    .select("id, as_of_date, total_ar, days_90, days_120, source_document_id, extraction_status, created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("extraction_status", "complete")
    .order("as_of_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const reportList = (reports ?? []) as Array<{
    id: string;
    as_of_date: string | null;
    total_ar: number | null;
    days_90: number | null;
    days_120: number | null;
    source_document_id: string | null;
  }>;

  if (!isBorrowingBaseActive({ hasArAgingReport: reportList.length > 0 })) return null;

  const report = reportList[0];

  const { data: customerRows } = await (sb as any)
    .from("ar_aging_customers")
    .select("customer_name, total_amount, current_amount, days_30, days_60, days_90, days_120")
    .eq("report_id", report.id);

  const customers: EligibilityCustomer[] = ((customerRows ?? []) as any[]).map((c) => ({
    customerName: String(c.customer_name ?? "Unknown"),
    total: Number(c.total_amount ?? 0),
    current: Number(c.current_amount ?? 0),
    d30: Number(c.days_30 ?? 0),
    d60: Number(c.days_60 ?? 0),
    d90: Number(c.days_90 ?? 0),
    d120: Number(c.days_120 ?? 0),
  }));

  // Invoice-level detail (optional). Drives the "invoice detail available" flag and required-support.
  const { count: invoiceCount } = await (sb as any)
    .from("ar_aging_invoices")
    .select("id", { count: "exact", head: true })
    .eq("report_id", report.id);

  // Prior certificate: the previous report's persisted net availability (for the delta note).
  let priorCertificate: { asOfDate: string; netBorrowingBase: number } | null = null;
  if (reportList.length > 1) {
    const prior = reportList[1];
    const { data: priorCalc } = await (sb as any)
      .from("borrowing_base_calculations")
      .select("net_availability")
      .eq("report_id", prior.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorCalc && prior.as_of_date) {
      priorCertificate = { asOfDate: prior.as_of_date, netBorrowingBase: Number(priorCalc.net_availability ?? 0) };
    }
  }

  const policy = await getArCollateralPolicy(sb as any, bankId);

  const over90 =
    report.days_90 != null || report.days_120 != null
      ? Number(report.days_90 ?? 0) + Number(report.days_120 ?? 0)
      : null;

  return buildBorrowingBaseCertificate({
    dealId,
    bankId,
    borrowerName: args.borrowerName,
    lenderName: args.lenderName,
    facilityLimit: args.facilityLimit ?? null,
    outstandingPrincipal: args.outstandingPrincipal ?? null,
    asOfDate: report.as_of_date,
    certificateDate: args.certificateDateIso,
    arAging: {
      asOfDate: report.as_of_date,
      reportedTotal: report.total_ar != null ? Number(report.total_ar) : null,
      over90,
      customers,
      hasInvoiceDetail: (invoiceCount ?? 0) > 0,
      sourceDocumentId: report.source_document_id,
    },
    policy: {
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
      concentrationLimit: policy.concentrationLimit,
      advanceRate: policy.advanceRate,
      concentrationReserve: policy.concentrationReserve,
      dilutionReserve: policy.dilutionReserve,
      source: policy.source,
    },
    priorCertificate,
    balanceSheet: args.balanceSheetAsOfIso ? { asOfDate: args.balanceSheetAsOfIso, totalAr: null } : null,
  });
}
