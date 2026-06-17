/**
 * SPEC-BORROWING-BASE-CERTIFICATE-ENGINE-1 (Phase 1 + Phase 4) — pure Borrowing Base Certificate
 * engine for AR-backed lines of credit.
 *
 * Given an AR aging report, its customer/invoice detail, the bank's AR policy, an optional prior
 * certificate and an optional balance-sheet tie-out, this builds a lender-grade certificate:
 * eligible AR, advance, reserves, net borrowing base, availability, ineligible breakdown, customer
 * concentration, exceptions, and borrower-certification language.
 *
 * Invariants:
 *   - Pure. No IO, no server-only imports. The server loader assembles the input.
 *   - Never "approved" / "certified" without a recorded approval state (we have none yet) — the
 *     status tops out at "ready_for_review".
 *   - Never bridges a date mismatch: when the AR aging date ≠ the balance-sheet date and no bridge is
 *     recorded, the certificate carries an AR_AGING_DATE_MISMATCH exception and an audit note that it
 *     must NOT be used to support the differently-dated balance sheet. The engine emits nothing that
 *     clears a classic-spread source-detail blocker.
 */

import {
  applyEligibilityRules,
  type EligibilityCustomer,
  type EligibilityResult,
  type EligibilityRuleConfig,
  type IneligibleBreakdownRow,
  type ConcentrationRow,
} from "./eligibilityRules";
import { assessArAgingQuality, type QualityGate, type ArAgingQualityInput } from "./arAgingQuality";

export type BorrowingBaseCertificateStatus = "draft" | "ready_for_review" | "blocked" | "approved";

export type CertificateException = {
  code: string;
  severity: "blocker" | "warning";
  message: string;
};

export type BorrowingBasePolicy = EligibilityRuleConfig & {
  advanceRate: number; // 0..1
  concentrationReserve: number; // 0..1 of eligible AR
  dilutionReserve: number; // 0..1 of eligible AR
  source: "bank_policy" | "default" | "mixed";
};

export type BorrowingBaseCertificateInput = {
  dealId: string;
  bankId: string;
  borrowerName: string;
  lenderName: string;
  facilityLimit: number | null;
  outstandingPrincipal: number | null;
  /** AR aging as-of date (ISO). */
  asOfDate: string | null;
  /** Date the certificate is being produced (ISO). */
  certificateDate: string;
  arAging: {
    asOfDate: string | null;
    /** total_ar as reported on the aging header (for the tie-out gate). */
    reportedTotal: number | null;
    /** over-90 (days_90 + days_120) as reported. */
    over90: number | null;
    customers: EligibilityCustomer[];
    hasInvoiceDetail: boolean;
    sourceDocumentId?: string | null;
  };
  policy: BorrowingBasePolicy;
  priorCertificate?: { asOfDate: string; netBorrowingBase: number } | null;
  /** Balance-sheet tie-out target this certificate may be asked to support. */
  balanceSheet?: { asOfDate: string | null; totalAr: number | null } | null;
  /** Whether a date-mismatch reconciliation bridge has been recorded. */
  bridgeRecorded?: boolean;
  requestedAdvanceAmount?: number | null;
  /** Staleness limit (days) for the certificate cadence. */
  maxAgeDays?: number;
};

export type BorrowingBaseCertificate = {
  certificateStatus: BorrowingBaseCertificateStatus;
  borrowerName: string;
  lenderName: string;
  facilityLimit: number | null;
  outstandingBalance: number | null;
  certificateDate: string;
  asOfDate: string | null;
  sourceDocumentId: string | null;

  grossAR: number;
  ineligibleAR: number;
  eligibleAR: number;
  advanceRate: number;

  grossBorrowingBase: number;
  reserves: { concentration: number; dilution: number; total: number };
  netBorrowingBase: number;
  /** Net borrowing base capped by the facility limit (the legal ceiling on availability). */
  availability: number;
  excessAvailability: number;
  requestedAdvanceAmount: number | null;

  requiredSupport: string[];
  ineligibleBreakdown: IneligibleBreakdownRow[];
  customerConcentration: ConcentrationRow[];
  exceptions: CertificateException[];
  certifications: string[];
  auditNotes: string[];
  qualityGates: QualityGate[];

  /** Present when the AR aging date differs from the balance-sheet date. */
  dateMismatchVsBalanceSheet: { arAsOf: string | null; balanceSheetAsOf: string | null; bridged: boolean } | null;
  policySource: BorrowingBasePolicy["source"];
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp0 = (n: number): number => (n > 0 ? n : 0);

/** Standard borrower certification language. Generic — never bank/borrower-specific. */
const BORROWER_CERTIFICATIONS: string[] = [
  "The undersigned certifies that the accounts receivable reported herein are bona fide and arose from the sale of goods or the rendering of services in the ordinary course of business.",
  "The undersigned certifies that all ineligible accounts have been excluded from the borrowing base in accordance with the loan and security agreement.",
  "The undersigned certifies that, except as disclosed in the exceptions below, the receivables are not subject to any setoff, counterclaim, dispute, or contra account.",
  "The undersigned certifies that the information in this certificate is true and correct as of the as-of date stated above.",
];

/**
 * Activation: the BBC is only relevant for AR-backed / borrowing-base-monitored facilities. Data-
 * driven so it never fires for an ordinary line of credit — it activates when AR-collateral data
 * exists for the deal. No hard-coded borrowers.
 */
export function isBorrowingBaseActive(signals: {
  hasArAgingReport?: boolean;
  hasBorrowingBaseCalc?: boolean;
  hasArBorrowingBaseFacts?: boolean;
}): boolean {
  return !!(signals.hasArAgingReport || signals.hasBorrowingBaseCalc || signals.hasArBorrowingBaseFacts);
}

export function buildBorrowingBaseCertificate(input: BorrowingBaseCertificateInput): BorrowingBaseCertificate {
  const { policy } = input;
  const customers = input.arAging.customers;

  const elig: EligibilityResult = applyEligibilityRules(customers, {
    enabledCategories: policy.enabledCategories,
    concentrationLimit: policy.concentrationLimit,
    tolerance: policy.tolerance,
  });

  const customerRowSum = elig.grossAr;
  const bucketSum = customers.reduce(
    (s, c) => s + num(c.current) + num(c.d30) + num(c.d60) + num(c.d90) + num(c.d120),
    0,
  );

  const qualityInput: ArAgingQualityInput = {
    asOfDate: input.asOfDate,
    certificateDate: input.certificateDate,
    customerRowCount: customers.length,
    reportedTotal: input.arAging.reportedTotal,
    customerRowSum,
    bucketSum,
    over90: input.arAging.over90,
    maxAgeDays: input.maxAgeDays,
    balanceSheetAsOfDate: input.balanceSheet?.asOfDate ?? null,
    balanceSheetAr: input.balanceSheet?.totalAr ?? null,
    bridgeRecorded: input.bridgeRecorded,
    tolerance: policy.tolerance,
  };
  const quality = assessArAgingQuality(qualityInput);

  // ── Borrowing base math (mirrors arCollateralProcessor: reserves are a % of eligible AR) ──
  const grossAR = round2(elig.grossAr);
  const eligibleAR = round2(elig.eligibleAr);
  const ineligibleAR = round2(elig.ineligibleAr);
  const advanceRate = policy.advanceRate;

  const grossBorrowingBase = round2(eligibleAR * advanceRate);
  const concentrationReserve = round2(eligibleAR * policy.concentrationReserve);
  const dilutionReserve = round2(eligibleAR * policy.dilutionReserve);
  const reservesTotal = round2(concentrationReserve + dilutionReserve);
  const netBorrowingBase = round2(clamp0(grossBorrowingBase - reservesTotal));

  const availability =
    input.facilityLimit != null ? round2(Math.min(netBorrowingBase, input.facilityLimit)) : netBorrowingBase;
  const outstanding = input.outstandingPrincipal;
  const excessAvailability = round2(availability - (outstanding ?? 0));
  const requestedAdvanceAmount = input.requestedAdvanceAmount ?? null;

  // ── Exceptions ──
  const exceptions: CertificateException[] = [];

  const overLimitCustomers = elig.concentration.filter((c) => c.overLimit);
  for (const c of overLimitCustomers) {
    exceptions.push({
      code: "CONCENTRATION_OVER_LIMIT",
      severity: "warning",
      message: `${c.customerName} is ${pct(c.pct)} of gross AR (limit ${pct(policy.concentrationLimit)}).`,
    });
  }

  if (outstanding != null && outstanding > netBorrowingBase + 0.01) {
    exceptions.push({
      code: "OVER_ADVANCE",
      severity: "blocker",
      message: `Outstanding ${money(outstanding)} exceeds the net borrowing base ${money(netBorrowingBase)} — collateral shortfall of ${money(outstanding - netBorrowingBase)}.`,
    });
  }

  if (requestedAdvanceAmount != null && requestedAdvanceAmount > excessAvailability + 0.01) {
    exceptions.push({
      code: "ADVANCE_EXCEEDS_AVAILABILITY",
      severity: "blocker",
      message: `Requested advance ${money(requestedAdvanceAmount)} exceeds excess availability ${money(excessAvailability)}.`,
    });
  }

  const staleGate = quality.gates.find((g) => g.id === "not_stale");
  if (staleGate?.status === "fail") {
    exceptions.push({ code: "STALE_AR_AGING", severity: "warning", message: `AR aging is stale: ${staleGate.detail}.` });
  }

  const totalTieGate = quality.gates.find((g) => g.id === "total_ties_to_customers");
  if (totalTieGate?.status === "fail") {
    exceptions.push({ code: "AR_TOTAL_MISMATCH", severity: "blocker", message: `AR total does not tie to customer rows: ${totalTieGate.detail}.` });
  }

  const sameDateTieGate = quality.gates.find((g) => g.id === "tied_to_balance_sheet");
  if (sameDateTieGate?.status === "fail" && sameDateTieGate.blocking) {
    exceptions.push({ code: "GL_TIE_OUT_FAILED", severity: "blocker", message: `AR aging does not tie to the balance sheet / GL: ${sameDateTieGate.detail}.` });
  }

  // Date mismatch — never bridged automatically.
  const arAsOf = input.asOfDate ?? input.arAging.asOfDate ?? null;
  const bsAsOf = input.balanceSheet?.asOfDate ?? null;
  let dateMismatchVsBalanceSheet: BorrowingBaseCertificate["dateMismatchVsBalanceSheet"] = null;
  if (bsAsOf && arAsOf && bsAsOf !== arAsOf) {
    const bridged = input.bridgeRecorded === true;
    dateMismatchVsBalanceSheet = { arAsOf, balanceSheetAsOf: bsAsOf, bridged };
    if (!bridged) {
      exceptions.push({
        code: "AR_AGING_DATE_MISMATCH",
        severity: "warning",
        message: `This certificate is as of ${arAsOf}; the balance sheet is as of ${bsAsOf}. Without a reconciliation bridge it may NOT be used to support the ${bsAsOf} balance sheet.`,
      });
    }
  }

  // ── Required support (what the banker/borrower still needs) ──
  const requiredSupport: string[] = [];
  if (!input.arAging.hasInvoiceDetail) requiredSupport.push("Invoice-level AR detail for over-90 / disputed verification");
  if (dateMismatchVsBalanceSheet && !dateMismatchVsBalanceSheet.bridged) {
    requiredSupport.push(`Reconciliation bridge from ${arAsOf} AR aging to the ${bsAsOf} balance sheet`);
  }
  if (totalTieGate?.status === "warn") requiredSupport.push("AR aging document header total to confirm the customer-row tie-out");
  if (exceptions.some((e) => e.code === "OVER_ADVANCE")) requiredSupport.push("Curtailment plan or additional eligible collateral to cure the over-advance");

  // ── Audit notes ──
  const auditNotes: string[] = [];
  auditNotes.push(`Advance rate ${pct(advanceRate)}; reserves ${pct(policy.concentrationReserve)} concentration + ${pct(policy.dilutionReserve)} dilution of eligible AR (policy source: ${policy.source}).`);
  auditNotes.push(`Eligibility rules applied: ${policy.enabledCategories.join(", ")}. Ineligible accounts are disallowed in full (whole-customer convention).`);
  if (dateMismatchVsBalanceSheet && !dateMismatchVsBalanceSheet.bridged) {
    auditNotes.push(`DATE MISMATCH: AR aging as of ${arAsOf} ≠ balance sheet as of ${bsAsOf}. This certificate does NOT clear any balance-sheet source-detail item for ${bsAsOf}; a period-matched aging or a recorded reconciliation bridge is required.`);
  }
  if (input.priorCertificate) {
    const delta = round2(netBorrowingBase - input.priorCertificate.netBorrowingBase);
    auditNotes.push(`Net borrowing base ${delta >= 0 ? "+" : ""}${money(delta)} vs prior certificate (${input.priorCertificate.asOfDate}: ${money(input.priorCertificate.netBorrowingBase)}).`);
  }

  // ── Status ──
  const hasBlockerException = exceptions.some((e) => e.severity === "blocker");
  let certificateStatus: BorrowingBaseCertificateStatus;
  if (quality.blocked || hasBlockerException) certificateStatus = "blocked";
  else if (customers.length === 0) certificateStatus = "draft";
  else certificateStatus = "ready_for_review"; // never "approved" without a recorded approval state.

  return {
    certificateStatus,
    borrowerName: input.borrowerName,
    lenderName: input.lenderName,
    facilityLimit: input.facilityLimit,
    outstandingBalance: outstanding,
    certificateDate: input.certificateDate,
    asOfDate: arAsOf,
    sourceDocumentId: input.arAging.sourceDocumentId ?? null,
    grossAR,
    ineligibleAR,
    eligibleAR,
    advanceRate,
    grossBorrowingBase,
    reserves: { concentration: concentrationReserve, dilution: dilutionReserve, total: reservesTotal },
    netBorrowingBase,
    availability,
    excessAvailability,
    requestedAdvanceAmount,
    requiredSupport,
    ineligibleBreakdown: elig.ineligibleBreakdown.map((r) => ({ ...r, amount: round2(r.amount) })),
    customerConcentration: elig.concentration.slice(0, 10).map((c) => ({ ...c, amount: round2(c.amount) })),
    exceptions,
    certifications: BORROWER_CERTIFICATIONS,
    auditNotes,
    qualityGates: quality.gates,
    dateMismatchVsBalanceSheet,
    policySource: policy.source,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure render lines — the plain-ASCII text block the PDF page draws. Unit-testable
// without producing a PDF buffer (mirrors certificationStatusLines).
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<BorrowingBaseCertificateStatus, string> = {
  draft: "DRAFT",
  ready_for_review: "READY FOR REVIEW - pending banker/borrower approval",
  blocked: "BLOCKED - exceptions must be cleared",
  approved: "APPROVED",
};

export function borrowingBaseCertificateLines(cert: BorrowingBaseCertificate): string[] {
  const lines: string[] = [];
  lines.push(`Borrowing Base Certificate: ${STATUS_LABEL[cert.certificateStatus]}`);
  lines.push(`Borrower: ${cert.borrowerName}    Lender: ${cert.lenderName}`);
  lines.push(`Certificate date: ${cert.certificateDate}    AR aging as of: ${cert.asOfDate ?? "n/a"}`);
  if (cert.facilityLimit != null) lines.push(`Facility limit: ${money(cert.facilityLimit)}`);

  lines.push("— Calculation —");
  lines.push(`Gross AR: ${money(cert.grossAR)}`);
  lines.push(`Less ineligible AR: (${money(cert.ineligibleAR)})`);
  lines.push(`Eligible AR: ${money(cert.eligibleAR)}`);
  lines.push(`Advance rate: ${pct(cert.advanceRate)}  =>  Gross borrowing base: ${money(cert.grossBorrowingBase)}`);
  lines.push(`Less reserves (concentration ${money(cert.reserves.concentration)} + dilution ${money(cert.reserves.dilution)}): (${money(cert.reserves.total)})`);
  lines.push(`Net borrowing base: ${money(cert.netBorrowingBase)}`);
  if (cert.facilityLimit != null) lines.push(`Availability (capped at facility limit): ${money(cert.availability)}`);
  if (cert.outstandingBalance != null) lines.push(`Outstanding balance: ${money(cert.outstandingBalance)}`);
  lines.push(`Excess availability: ${money(cert.excessAvailability)}`);
  if (cert.requestedAdvanceAmount != null) lines.push(`Requested advance: ${money(cert.requestedAdvanceAmount)}`);

  if (cert.ineligibleBreakdown.length > 0) {
    lines.push("— Ineligible AR detail —");
    for (const b of cert.ineligibleBreakdown) {
      lines.push(`${b.label}: ${money(b.amount)} (${b.customerCount} account${b.customerCount === 1 ? "" : "s"})`);
    }
  }

  if (cert.customerConcentration.length > 0) {
    lines.push("— Customer concentration —");
    for (const c of cert.customerConcentration) {
      lines.push(`${c.customerName}: ${money(c.amount)} (${pct(c.pct)})${c.overLimit ? " OVER LIMIT" : ""}`);
    }
  }

  if (cert.exceptions.length > 0) {
    lines.push("— Exceptions —");
    for (const e of cert.exceptions) lines.push(`[${e.severity.toUpperCase()}] ${e.code}: ${e.message}`);
  }

  if (cert.requiredSupport.length > 0) {
    lines.push("— Required support —");
    for (const r of cert.requiredSupport) lines.push(`- ${r}`);
  }

  if (cert.auditNotes.length > 0) {
    lines.push("— Audit notes —");
    for (const n of cert.auditNotes) lines.push(n);
  }

  lines.push("— Borrower certification —");
  for (const c of cert.certifications) lines.push(c);
  lines.push("Authorized signer: ____________________________    Title: ______________    Date: ____________");
  lines.push("— Banker review —");
  lines.push("Reviewed by: ____________________________    Policy/reserve adjustments: ____________    Date: ____________");

  return lines;
}

// ── formatting helpers ──
const num = (v: number | null | undefined): number => (Number.isFinite(v as number) ? Number(v) : 0);
function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${(v * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
