/**
 * SPEC-CLASSIC-SPREAD-BORROWER-SOURCE-DETAIL-REQUEST-1 — pure borrower source-detail request builder.
 *
 * Turns a REQUEST_SOURCE_DETAIL classic-spread review action (a missing/unmapped/contradictory
 * source line the audit flagged as a blocker) into a precise, borrower-facing document request: what
 * to upload, for which period, and exactly what reported figure it must tie to. Generic across deals,
 * periods, statements, and line items — it reads ONLY the finding's own metadata (period, statement,
 * line item, reported/present/missing amounts) and never hard-codes a deal, year, line, or amount.
 *
 * Pure: no IO, no DB, no canonical VM, no source-line inference. All copy is plain ASCII so it renders
 * cleanly in the borrower portal and any PDF.
 */

export type SourceDetailRequestInput = {
  /** the classic_spread_review_actions row id (link-back), when known */
  reviewActionId?: string | null;
  /** deterministic finding_key (link-back + idempotency), when known */
  findingKey?: string | null;
  /** SpreadFindingAction — only REQUEST_SOURCE_DETAIL is expected; others fall through to generic */
  actionType: string;
  /** SpreadAuditIssueType (missing_implied_component / missing_required_value / contradictory_components / ...) */
  issueType: string;
  /** "balance_sheet" | "income_statement" | "cash_flow" | other */
  statement: string;
  /** period label (e.g. "YTD 2026", "2025") */
  periodLabel: string;
  /** statement end date display string (e.g. "3/31/2026"); falls back to the label when absent */
  periodEndDate?: string | null;
  /** whether the period is an interim/YTD statement (affects copy: "interim balance sheet") */
  periodIsInterim?: boolean;
  /** the spread row label (e.g. "TOTAL CURRENT ASSETS") */
  lineItem: string;
  /** finding.actualValue — present/reported components sum (for missing_implied_component) */
  sourceValue?: number | null;
  /** finding.expectedValue — resolver's recommended / implied amount */
  recommendedValue?: number | null;
  /** finding.difference — the implied missing / unexplained gap */
  diffValue?: number | null;
  /** finding.detail — diagnostic narrative, copied into the banker internal note */
  reason?: string | null;
};

// SPEC-BORROWER-EVIDENCE-REQUEST-PACKAGE-POLISH-1: a stable evidence-kind token, evidence-kind-aware
// so the borrower knows precisely what class of document satisfies the request, and the linker/metadata
// round-trip is unambiguous.
export type RequestedEvidenceKind =
  | "current_asset_detail"
  | "schedule_l_detail"
  | "balance_sheet_detail"
  | "income_statement_detail"
  | "source_documentation";

/**
 * The structured linkage an upload form must carry so the uploaded document becomes LINKED evidence
 * for the exact review action (round-trips through deal_documents.metadata → evidenceUploadLinker).
 * `draftBorrowerRequestId` is filled in by the persistence layer after the draft row is created.
 */
export type EvidenceUploadContext = {
  spreadReviewActionId: string | null;
  spreadFindingKey: string | null;
  draftBorrowerRequestId?: string | null;
  requestedEvidenceKind: RequestedEvidenceKind;
  requestedPeriod: string;
  clearingTarget: string;
};

export type BorrowerSourceDetailRequest = {
  title: string;
  shortDescription: string;
  requestedDocuments: string[];
  /** best period reference for the request (end date if known, else the label) */
  requestedPeriodEnd: string;
  statementType: string;
  lineItem: string;
  /** the reported figure the uploaded detail must tie out to, when derivable */
  tieOutTargetAmount: number | null;
  /** the implied missing / unsupported amount, when known */
  missingAmount: number | null;
  acceptableDocuments: string[];
  unacceptableDocuments: string[];
  bankerInternalNote: string;
  borrowerMessage: string;
  priority: "high" | "normal" | "low";
  sourceReviewActionId: string | null;
  findingKey: string | null;
  /** a stable doc-type token for the borrower request surface */
  missingDocumentType: string;
  /** stable evidence-kind token (what class of document satisfies this request) */
  requestedEvidenceKind: RequestedEvidenceKind;
  /** plain-English statement of exactly what the upload must let Buddy reconcile/clear */
  clearingTarget: string;
  /** structured linkage the upload form must send so the upload becomes LINKED evidence */
  uploadContext: EvidenceUploadContext;
  tags: string[];
};

const fmtUsd = (n: number | null | undefined): string | null =>
  n == null || !Number.isFinite(n) ? null : `$${Math.round(n).toLocaleString("en-US")}`;

/** "TOTAL CURRENT ASSETS" -> "Total Current Assets" (display name for borrower-facing copy). */
function displayLineName(lineItem: string): string {
  const t = (lineItem ?? "").trim();
  if (!t) return "this line item";
  return t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function statementTypeLabel(statement: string): string {
  switch (statement) {
    case "balance_sheet": return "balance sheet";
    case "income_statement": return "income statement";
    case "cash_flow": return "cash flow statement";
    default: return "financial statement";
  }
}

/** True when the line item involves accounts receivable / current assets (drives the AR/borrowing-base warning). */
function impliesReceivableOrCurrentAssets(lineItem: string): boolean {
  return /(current asset|receivable|\bA\/?R\b)/i.test(lineItem ?? "");
}

export function buildSourceDetailRequest(input: SourceDetailRequestInput): BorrowerSourceDetailRequest {
  const statementType = statementTypeLabel(input.statement);
  const lineName = displayLineName(input.lineItem);
  const periodRef = (input.periodEndDate && input.periodEndDate.trim()) || input.periodLabel;
  const interim = input.periodIsInterim === true;
  const interimPrefix = interim ? "interim " : "";

  const present = input.sourceValue ?? null;
  const missing = input.diffValue ?? input.recommendedValue ?? null;
  // For missing_implied_component the reported total = present components + the implied gap.
  const tieOut =
    input.issueType === "missing_implied_component" && present != null && missing != null
      ? present + missing
      : input.recommendedValue ?? null;

  const presentFmt = fmtUsd(present);
  const missingFmt = fmtUsd(missing);
  const tieOutFmt = fmtUsd(tieOut);

  const arContext = impliesReceivableOrCurrentAssets(input.lineItem);
  const isBalanceSheet = input.statement === "balance_sheet";
  const isIncomeStatement = input.statement === "income_statement";
  const isCurrentAssetContext = isBalanceSheet && arContext;
  const isRequestSourceDetail = input.actionType === "REQUEST_SOURCE_DETAIL";

  const isVerify = input.actionType === "VERIFY_SOURCE_LINE";
  const isUnreconciledBalance = isBalanceSheet && (input.issueType === "unreconciled_total" || /liabilit|net worth|equity/i.test(input.lineItem));

  const baseTags = ["classic_spread", "source_detail", input.statement, input.issueType];
  if (arContext) baseTags.push("accounts_receivable");

  // ── evidence-kind + clearing target (the precise "what to upload and why") ──
  const requestedEvidenceKind: RequestedEvidenceKind =
    isVerify && isUnreconciledBalance ? "schedule_l_detail"
      : isCurrentAssetContext ? "current_asset_detail"
        : isBalanceSheet ? "balance_sheet_detail"
          : isIncomeStatement ? "income_statement_detail"
            : "source_documentation";
  const taFmt = fmtUsd(input.recommendedValue);
  const clearingTarget =
    requestedEvidenceKind === "current_asset_detail"
      ? `${lineName}${tieOutFmt ? ` of ${tieOutFmt}` : ""} as of ${periodRef}`
      : requestedEvidenceKind === "schedule_l_detail"
        ? `Total Liabilities + Net Worth reconciling to Total Assets${taFmt ? ` of ${taFmt}` : ""} as of ${periodRef}`
        : `${lineName} for ${periodRef}`;
  const uploadContext: EvidenceUploadContext = {
    spreadReviewActionId: input.reviewActionId ?? null,
    spreadFindingKey: input.findingKey ?? null,
    requestedEvidenceKind,
    requestedPeriod: periodRef,
    clearingTarget,
  };

  const bankerInternalNote =
    `${input.actionType} on ${input.periodLabel} ${input.statement} / ${input.lineItem}: ` +
    `reported ${tieOutFmt ?? "n/a"}, identified ${presentFmt ?? "n/a"}, missing ${missingFmt ?? "n/a"}.` +
    (input.reason ? ` ${input.reason}` : "");

  const common = {
    statementType,
    lineItem: input.lineItem,
    tieOutTargetAmount: tieOut,
    missingAmount: missing,
    bankerInternalNote,
    priority: "high" as const,
    sourceReviewActionId: input.reviewActionId ?? null,
    findingKey: input.findingKey ?? null,
    requestedPeriodEnd: periodRef,
    requestedEvidenceKind,
    clearingTarget,
    uploadContext,
  };

  // ── Current-asset / receivable balance-sheet detail (the primary OmniCare case) ────────────────
  if (isRequestSourceDetail && isCurrentAssetContext) {
    const tieClause = tieOutFmt ? `${lineName} of ${tieOutFmt}` : `the reported ${lineName}`;
    const messageParts = [
      `Buddy needs source detail for the ${input.periodEndDate ? input.periodEndDate + " " : ""}${interimPrefix}${statementType}.`,
    ];
    if (tieOutFmt && presentFmt && missingFmt) {
      messageParts.push(
        `The statement reports ${lineName} of ${tieOutFmt}, but the identified current-asset components only total ${presentFmt}, leaving ${missingFmt} unsupported.`,
      );
    }
    messageParts.push(
      `Please upload a detailed current-asset schedule, AR aging, AR detail, or detailed ${interimPrefix}balance sheet as of ${periodRef} that ties to ${tieClause}.`,
    );

    return {
      ...common,
      title: `Upload ${periodRef} current asset detail supporting ${lineName}`,
      shortDescription: `Current-asset detail tying to ${lineName}${tieOutFmt ? ` of ${tieOutFmt}` : ""} as of ${periodRef}.`,
      requestedDocuments: [
        "Detailed current-asset schedule",
        "AR aging",
        "AR detail",
        `Detailed ${interimPrefix}balance sheet`,
      ],
      acceptableDocuments: [
        `${periodRef} AR aging or AR detail`,
        `${periodRef} detailed current asset schedule`,
        `${periodRef} detailed ${interimPrefix}balance sheet showing Cash, AR, inventory, other current assets, and Total Current Assets`,
        `Reconciliation from any nearby AR aging date back to ${periodRef}`,
      ],
      unacceptableDocuments: [
        "AR aging from a different date with no reconciliation",
        `Borrowing-base AR as of a different date without a bridge to ${periodRef}`,
        `Summary ${statementType} that only repeats ${lineName} without the underlying components`,
      ],
      borrowerMessage: messageParts.join(" "),
      missingDocumentType: "current_asset_detail",
      tags: [...baseTags, "current_assets"],
    };
  }

  // ── Other balance-sheet lines ──────────────────────────────────────────────────────────────────
  if (isRequestSourceDetail && isBalanceSheet) {
    const reportedClause =
      tieOutFmt && missingFmt
        ? ` The statement reports ${lineName} of ${tieOutFmt}, with ${missingFmt} not yet supported by detail.`
        : tieOutFmt
          ? ` The statement reports ${lineName} of ${tieOutFmt}.`
          : "";
    const unacceptable = [`Summary ${statementType} that only repeats ${lineName} without supporting detail`];
    if (arContext) {
      unacceptable.push("AR aging from a different date with no reconciliation");
      unacceptable.push(`Borrowing-base AR as of a different date without a bridge to ${periodRef}`);
    }
    return {
      ...common,
      title: `Upload ${periodRef} detail supporting ${lineName}`,
      shortDescription: `Underlying schedule/detail for ${lineName} as of ${periodRef}.`,
      requestedDocuments: [`Schedule or detail supporting ${lineName}`, `Detailed ${interimPrefix}balance sheet`],
      acceptableDocuments: [
        `${periodRef} schedule or detail for ${lineName}`,
        `Detailed ${interimPrefix}balance sheet as of ${periodRef} showing ${lineName} and its components`,
      ],
      unacceptableDocuments: unacceptable,
      borrowerMessage:
        `Buddy needs source detail for ${lineName} on the ${input.periodEndDate ? input.periodEndDate + " " : ""}${interimPrefix}balance sheet.` +
        reportedClause +
        ` Please upload the underlying schedule or detail for ${lineName} as of ${periodRef}.`,
      missingDocumentType: "balance_sheet_detail",
      tags: baseTags,
    };
  }

  // ── Income-statement lines ──────────────────────────────────────────────────────────────────────
  if (isRequestSourceDetail && isIncomeStatement) {
    const reportedClause =
      tieOutFmt && missingFmt
        ? ` The statement reports ${lineName} of ${tieOutFmt}, with ${missingFmt} unsupported.`
        : tieOutFmt
          ? ` The statement reports ${lineName} of ${tieOutFmt}.`
          : "";
    return {
      ...common,
      title: `Upload ${input.periodLabel} detail supporting ${lineName}`,
      shortDescription: `Source schedule / statement-line detail for ${lineName} for ${input.periodLabel}.`,
      requestedDocuments: [`Schedule or statement-line detail for ${lineName}`, `Detailed income statement for ${input.periodLabel}`],
      acceptableDocuments: [
        `${input.periodLabel} detail or schedule supporting ${lineName}`,
        `Detailed income statement for ${input.periodLabel} showing ${lineName}`,
      ],
      unacceptableDocuments: [`Summary income statement that omits ${lineName} detail`],
      borrowerMessage:
        `Buddy needs source detail for ${lineName} on the ${input.periodLabel} income statement.` +
        reportedClause +
        ` Please upload the source schedule or statement-line detail for ${lineName} for ${input.periodLabel}.`,
      missingDocumentType: "income_statement_detail",
      tags: baseTags,
    };
  }

  // ── VERIFY_SOURCE_LINE — two sources disagree / a total does not reconcile (e.g. 2022 TOTAL
  //    LIABILITIES & NET WORTH unreconciled_total). Ask for the source detail that proves the line
  //    and lets the statement reconcile; never auto-resolve. ───────────────────────────────────────
  if (input.actionType === "VERIFY_SOURCE_LINE") {
    if (isBalanceSheet && (input.issueType === "unreconciled_total" || /liabilit|net worth|equity/i.test(input.lineItem))) {
      // For an unreconciled balance: recommendedValue = Total Assets (the target), sourceValue =
      // Liabilities + Net Worth as currently extracted, diffValue = the unexplained gap.
      const totalAssetsFmt = fmtUsd(input.recommendedValue);
      const reconciledFmt = fmtUsd(input.sourceValue);
      const gapFmt = fmtUsd(input.diffValue);
      const detailClause =
        totalAssetsFmt && reconciledFmt && gapFmt
          ? ` The extracted liability/equity detail currently totals ${reconciledFmt}, leaving ${gapFmt} of Total Assets (${totalAssetsFmt}) unexplained.`
          : "";
      return {
        ...common,
        title: `Upload source detail for ${periodRef} balance sheet liabilities and net worth`,
        shortDescription: `${periodRef} Schedule L / liability + equity detail reconciling to ${totalAssetsFmt ?? "Total Assets"}.`,
        requestedDocuments: [
          interim ? "Detailed interim balance sheet" : "Schedule L (Form 1120 / 1065)",
          "Detailed balance sheet showing every liability and equity line",
        ],
        acceptableDocuments: [
          `${periodRef} Schedule L showing mortgages/notes, other liabilities, capital stock, paid-in capital, and retained earnings`,
          `${periodRef} detailed balance sheet itemizing every liability and equity line`,
        ],
        unacceptableDocuments: [`Summary ${statementType} that only repeats totals without the underlying liability/equity lines`],
        borrowerMessage:
          `Buddy needs source detail for the ${periodRef} balance sheet liability and equity lines.` +
          detailClause +
          ` Please upload the ${periodRef} Schedule L (or a detailed balance sheet) showing every liability and equity line so Total Assets reconciles to Total Liabilities + Net Worth.`,
        missingDocumentType: "balance_sheet_detail",
        tags: [...baseTags, "reconciliation"],
      };
    }
    // Generic verify — ask for source documentation + reconciliation for the exact period/line.
    return {
      ...common,
      title: `Upload source documentation supporting ${lineName} for ${periodRef}`,
      shortDescription: `Source documentation + reconciliation for ${lineName} (${periodRef}).`,
      requestedDocuments: [`Source documentation supporting ${lineName}`, `Reconciliation for ${lineName}`],
      acceptableDocuments: [
        `${periodRef} source schedule or statement detail supporting ${lineName}`,
        `Reconciliation showing how ${lineName} ties to the source documents`,
      ],
      unacceptableDocuments: [],
      borrowerMessage:
        `Buddy needs to verify ${lineName} on the ${periodRef} ${statementType}. Please upload the source documentation and any reconciliation that supports ${lineName} for ${periodRef}.`,
      missingDocumentType: "financial_statement_detail",
      tags: [...baseTags, "verify"],
    };
  }

  // ── Conservative fail-safe (unknown statement / line, or non-source-detail action) ───────────────
  return {
    ...common,
    title: `Upload source documentation supporting ${lineName} for ${periodRef}`,
    shortDescription: `Source documentation supporting ${lineName} for ${periodRef}.`,
    requestedDocuments: [`Source documentation supporting ${lineName}`],
    acceptableDocuments: [`Any source documentation supporting ${lineName} as of ${periodRef}`],
    unacceptableDocuments: [],
    borrowerMessage: `Please provide source documentation supporting ${lineName} for ${periodRef}.`,
    missingDocumentType: "financial_statement_detail",
    tags: baseTags,
  };
}
