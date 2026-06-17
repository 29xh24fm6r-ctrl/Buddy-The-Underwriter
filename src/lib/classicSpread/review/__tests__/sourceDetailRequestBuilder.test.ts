/**
 * SPEC-CLASSIC-SPREAD-BORROWER-SOURCE-DETAIL-REQUEST-1 — pure source-detail request builder.
 *
 * Proves the OmniCare YTD-2026 TCA request is exact + useful, that the builder hard-codes NO deal /
 * year / line / amount (it reads only the finding's own metadata), and that generic future cases
 * (other deals/periods/lines, missing amounts, unknown statements) produce correct period/line copy.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSourceDetailRequest, type SourceDetailRequestInput } from "../sourceDetailRequestBuilder";

const NON_ASCII = /[^\x00-\x7F]/;

// OmniCare-shaped fixture (values are fixtures, NOT hard-coded in the builder).
const omniCare: SourceDetailRequestInput = {
  reviewActionId: "ra-1",
  findingKey: "ytd_2026|balance_sheet|total_current_assets|missing_implied_component",
  actionType: "REQUEST_SOURCE_DETAIL",
  issueType: "missing_implied_component",
  statement: "balance_sheet",
  periodLabel: "YTD 2026",
  periodEndDate: "3/31/2026",
  periodIsInterim: true,
  lineItem: "TOTAL CURRENT ASSETS",
  sourceValue: 198_692.59, // present components
  recommendedValue: 2_898_652.37, // implied gap
  diffValue: 2_898_652.37,
  reason: "Direct Total Current Assets exceeds the sum of present components.",
};

describe("buildSourceDetailRequest — OmniCare YTD 2026 TCA", () => {
  const r = buildSourceDetailRequest(omniCare);

  it("produces the exact, useful title + tie-out + present + missing amounts", () => {
    assert.equal(r.title, "Upload 3/31/2026 current asset detail supporting Total Current Assets");
    assert.equal(r.tieOutTargetAmount, 198_692.59 + 2_898_652.37); // 3,097,344.96
    assert.equal(r.missingAmount, 2_898_652.37);
    assert.equal(r.priority, "high");
    assert.equal(r.requestedPeriodEnd, "3/31/2026");
    assert.equal(r.statementType, "balance sheet");
  });

  it("borrower message names the period, reported total, present total, and the unsupported gap", () => {
    const m = r.borrowerMessage;
    assert.match(m, /3\/31\/2026 interim balance sheet/);
    assert.match(m, /Total Current Assets of \$3,097,345/);
    assert.match(m, /only total \$198,693/);
    assert.match(m, /leaving \$2,898,652 unsupported/);
    assert.match(m, /AR aging, AR detail/);
    assert.match(m, /ties to Total Current Assets of \$3,097,345/);
  });

  it("lists acceptable docs (dated, tie-out) and unacceptable different-date AR / borrowing-base", () => {
    assert.ok(r.acceptableDocuments.some((d) => /3\/31\/2026 AR aging or AR detail/.test(d)));
    assert.ok(r.acceptableDocuments.some((d) => /detailed interim balance sheet/.test(d)));
    assert.ok(r.acceptableDocuments.some((d) => /Reconciliation from any nearby AR aging date back to 3\/31\/2026/.test(d)));
    assert.ok(r.unacceptableDocuments.some((d) => /different date with no reconciliation/i.test(d)));
    assert.ok(r.unacceptableDocuments.some((d) => /Borrowing-base AR as of a different date without a bridge to 3\/31\/2026/.test(d)));
  });

  it("links back to the source review action / finding_key and is all ASCII", () => {
    assert.equal(r.sourceReviewActionId, "ra-1");
    assert.equal(r.findingKey, omniCare.findingKey);
    assert.ok(r.tags.includes("current_assets") && r.tags.includes("accounts_receivable"));
    for (const s of [r.title, r.borrowerMessage, ...r.acceptableDocuments, ...r.unacceptableDocuments])
      assert.ok(!NON_ASCII.test(s), `ASCII: ${JSON.stringify(s)}`);
  });
});

describe("buildSourceDetailRequest — generic / future-deal robustness", () => {
  it("does NOT hard-code OmniCare: a different deal/period/line/amount flows through verbatim", () => {
    const r = buildSourceDetailRequest({
      findingKey: "2027|balance_sheet|total_current_assets|missing_implied_component",
      reviewActionId: "ra-x",
      actionType: "REQUEST_SOURCE_DETAIL",
      issueType: "missing_implied_component",
      statement: "balance_sheet",
      periodLabel: "2027",
      periodEndDate: "12/31/2027",
      periodIsInterim: false,
      lineItem: "TOTAL CURRENT ASSETS",
      sourceValue: 10_000,
      recommendedValue: 90_000,
      diffValue: 90_000,
    });
    assert.equal(r.tieOutTargetAmount, 100_000);
    assert.equal(r.missingAmount, 90_000);
    assert.match(r.borrowerMessage, /12\/31\/2027 balance sheet/); // not "interim", different date
    assert.match(r.borrowerMessage, /Total Current Assets of \$100,000/);
    assert.ok(!/3,097,345|2,898,652|3\/31\/2026/.test(JSON.stringify(r)), "no OmniCare values leak in");
  });

  it("generic balance-sheet line (non-current-asset): asks for that line's schedule + period", () => {
    const r = buildSourceDetailRequest({
      findingKey: "2025|balance_sheet|other_liabilities|missing_required_value",
      actionType: "REQUEST_SOURCE_DETAIL",
      issueType: "missing_required_value",
      statement: "balance_sheet",
      periodLabel: "2025",
      periodEndDate: "12/31/2025",
      lineItem: "OTHER LIABILITIES",
      sourceValue: null,
      recommendedValue: 250_000,
      diffValue: 250_000,
    });
    assert.match(r.title, /Upload 12\/31\/2025 detail supporting Other Liabilities/);
    assert.match(r.borrowerMessage, /source detail for Other Liabilities on the 12\/31\/2025 balance sheet/);
    assert.equal(r.missingDocumentType, "balance_sheet_detail");
    // non-AR line → no borrowing-base warning
    assert.ok(!r.unacceptableDocuments.some((d) => /Borrowing-base/.test(d)));
  });

  it("AR-implicating balance-sheet line still gets the different-date / borrowing-base warning", () => {
    const r = buildSourceDetailRequest({
      findingKey: "2025|balance_sheet|accounts_receivable|missing_required_value",
      actionType: "REQUEST_SOURCE_DETAIL",
      issueType: "missing_required_value",
      statement: "balance_sheet",
      periodLabel: "2025",
      periodEndDate: "12/31/2025",
      lineItem: "ACCOUNTS RECEIVABLE",
      recommendedValue: 500_000,
      diffValue: 500_000,
    });
    assert.ok(r.unacceptableDocuments.some((d) => /Borrowing-base AR as of a different date without a bridge to 12\/31\/2025/.test(d)));
  });

  it("income-statement line: asks for the statement-line detail for that period", () => {
    const r = buildSourceDetailRequest({
      findingKey: "2025|income_statement|other_deductions|missing_required_value",
      actionType: "REQUEST_SOURCE_DETAIL",
      issueType: "missing_required_value",
      statement: "income_statement",
      periodLabel: "2025",
      periodEndDate: null,
      lineItem: "OTHER DEDUCTIONS",
      sourceValue: null,
      recommendedValue: 120_000,
      diffValue: 120_000,
    });
    assert.match(r.title, /Upload 2025 detail supporting Other Deductions/);
    assert.match(r.borrowerMessage, /income statement/);
    assert.equal(r.statementType, "income statement");
    assert.equal(r.missingDocumentType, "income_statement_detail");
  });

  it("unknown statement/line fails safe with a conservative generic request", () => {
    const r = buildSourceDetailRequest({
      findingKey: "2025|cash_flow|mystery_line|formula_mismatch",
      actionType: "REQUEST_SOURCE_DETAIL",
      issueType: "formula_mismatch",
      statement: "cash_flow",
      periodLabel: "2025",
      lineItem: "MYSTERY LINE",
    });
    assert.match(r.borrowerMessage, /Please provide source documentation supporting Mystery Line for 2025\./);
    assert.equal(r.missingDocumentType, "financial_statement_detail");
    assert.equal(r.tieOutTargetAmount, null);
  });

  it("handles a missing amount gracefully (no gap clause, still asks for tie-out detail)", () => {
    const r = buildSourceDetailRequest({
      findingKey: "2026|balance_sheet|total_current_assets|missing_implied_component",
      actionType: "REQUEST_SOURCE_DETAIL",
      issueType: "missing_implied_component",
      statement: "balance_sheet",
      periodLabel: "YTD 2026",
      periodEndDate: "6/30/2026",
      periodIsInterim: true,
      lineItem: "TOTAL CURRENT ASSETS",
      sourceValue: null,
      recommendedValue: null,
      diffValue: null,
    });
    assert.equal(r.tieOutTargetAmount, null);
    assert.equal(r.missingAmount, null);
    assert.ok(!/unsupported/.test(r.borrowerMessage), "no fabricated unsupported amount");
    assert.match(r.borrowerMessage, /detailed current-asset schedule, AR aging, AR detail/);
    assert.match(r.borrowerMessage, /as of 6\/30\/2026/);
  });

  it("falls back to the period label when no end date is supplied", () => {
    const r = buildSourceDetailRequest({
      findingKey: "2024|balance_sheet|total_current_assets|missing_implied_component",
      actionType: "REQUEST_SOURCE_DETAIL",
      issueType: "missing_implied_component",
      statement: "balance_sheet",
      periodLabel: "2024",
      periodEndDate: null,
      lineItem: "TOTAL CURRENT ASSETS",
      sourceValue: 5_000,
      diffValue: 95_000,
      recommendedValue: 95_000,
    });
    assert.equal(r.requestedPeriodEnd, "2024");
    assert.match(r.title, /Upload 2024 current asset detail/);
  });
});
