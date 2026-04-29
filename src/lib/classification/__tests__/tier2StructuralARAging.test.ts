/**
 * AR Aging Classifier — Bulletproof Coverage
 *
 * Pre-merge gate for PR #356 (AR aging borrowing-base processor): the
 * processor only runs when document_type === "AR_AGING", so this test file
 * locks in the four scenarios from the spec:
 *
 *   1. QuickBooks-style title + buckets        → AR_AGING
 *   2. Table-only AR aging (weak title)        → AR_AGING (via table heuristic)
 *   3. Balance sheet with "accounts receivable" line item → NOT AR_AGING
 *   4. AP aging / accounts payable aging       → NOT AR_AGING (negative gate)
 *
 * Plus the Omnicare reproduction case that previously classified as OTHER.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { runTier2Structural } from "../tier2Structural";
import { normalizeDocument } from "../normalizeDocument";

function makeDoc(text: string, filename = "test.pdf") {
  return normalizeDocument("test-art", text, filename, "application/pdf");
}

// ─── 1. QuickBooks-style AR Aging ───────────────────────────────────────────

describe("AR Aging — QuickBooks-style title + buckets", () => {
  test("QuickBooks 'A/R Aging Summary' with full bucket columns → AR_AGING", () => {
    const text = [
      "QuickBooks Online",
      "A/R Aging Summary",
      "As of December 31, 2025",
      "",
      "Customer       Current    1 - 30    31 - 60    61 - 90    > 90    Total",
      "Acme Corp      $5,000     $2,000    $500       $0         $0      $7,500",
      "Beta LLC       $0         $0        $250       $0         $0      $250",
      "Gamma Inc      $1,200     $300      $0         $0         $200    $1,700",
      "Total          $6,200     $2,300    $750       $0         $200    $9,450",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    assert.equal(result.matched, true, "should classify as AR_AGING");
    assert.equal(result.docType, "AR_AGING");
    assert.equal(result.patternId, "AR_AGING_KEYWORD_AND_TABLE");
    assert.ok(result.confidence >= 0.85, "high confidence on strong match");
    // Evidence must include both keyword and bucket signals
    const allEvidence = result.evidence.map((e) => e.matchedText).join("|");
    assert.match(allEvidence, /keyword:/, "evidence contains keyword signal");
    assert.match(allEvidence, /bucket:/, "evidence contains bucket signal");
  });

  test("'Accounts Receivable Aging' formal title → AR_AGING", () => {
    const text = [
      "Acme Corporation",
      "Accounts Receivable Aging",
      "As of June 30, 2025",
      "",
      "Customer Name        Current    0-30      31-60     61-90     90+",
      "Customer A           1,000      0         0         0         0",
      "Customer B           0          500       250       0         0",
      "Customer C           0          0         0         750       1,200",
    ].join("\n");
    const result = runTier2Structural(makeDoc(text));
    assert.equal(result.docType, "AR_AGING");
    assert.equal(result.patternId, "AR_AGING_KEYWORD_AND_TABLE");
  });
});

// ─── 2. Table-only AR Aging (no title / weak title) ─────────────────────────

describe("AR Aging — table-structure-only path (weak/missing title)", () => {
  test("Customer column + 4 aging buckets (no AR keyword) → AR_AGING via table heuristic", () => {
    // Common case: company-branded export where the title was cropped or
    // renamed to just the company name — but the table shape is unmistakable.
    const text = [
      "Big Box Distribution Co.",
      "Reporting Period: Q4 2025",
      "",
      "Customer       Current    0-30      31-60     61-90     90+       Total",
      "Tenant 1       12,000     5,000     2,000     1,000     0         20,000",
      "Tenant 2       8,000      3,000     0         0         500       11,500",
      "Tenant 3       0          0         1,500     750       2,250     4,500",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    assert.equal(result.matched, true);
    assert.equal(result.docType, "AR_AGING");
    assert.equal(result.patternId, "AR_AGING_TABLE_STRUCTURE");
    assert.ok(result.confidence >= 0.80);
    const evidenceText = result.evidence.map((e) => e.matchedText).join("|");
    assert.match(evidenceText, /customer_column:/);
    assert.match(evidenceText, /bucket:/);
  });

  test("Client Name column + 3 buckets → AR_AGING via table heuristic", () => {
    const text = [
      "Aging Report (Q4)",
      "",
      "Client Name        Current    31-60     61-90",
      "Client A           500        0         0",
      "Client B           0          250       100",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    assert.equal(result.matched, true);
    assert.equal(result.docType, "AR_AGING");
    // Either KEYWORD_AND_TABLE (if "Aging Report" → "aging summary"-ish) or TABLE_STRUCTURE
    assert.ok(
      ["AR_AGING_KEYWORD_AND_TABLE", "AR_AGING_TABLE_STRUCTURE"].includes(
        result.patternId ?? "",
      ),
    );
  });
});

// ─── 3. Balance sheet with AR line item → NOT AR_AGING ──────────────────────

describe("AR Aging — must NOT match balance sheets", () => {
  test("Balance sheet mentioning accounts receivable as a line item → NOT AR_AGING", () => {
    const text = [
      "Acme Corp",
      "Balance Sheet",
      "As of December 31, 2025",
      "",
      "ASSETS",
      "Current Assets",
      "  Cash                          $100,000",
      "  Accounts Receivable           $250,000",
      "  Inventory                     $400,000",
      "Total Current Assets             $750,000",
      "",
      "Property, Plant, and Equipment   $1,200,000",
      "Total Assets                     $1,950,000",
      "",
      "LIABILITIES",
      "Current Liabilities              $300,000",
      "Long-term Debt                   $500,000",
      "Total Liabilities                $800,000",
      "",
      "Equity                           $1,150,000",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    if (result.matched) {
      assert.notEqual(
        result.docType,
        "AR_AGING",
        `Balance sheet wrongly classified as AR_AGING (pattern: ${result.patternId})`,
      );
    }
  });

  test("Balance sheet with AR line + 'current assets' / 'current liabilities' → NOT AR_AGING", () => {
    // The "current" negative-lookahead must skip "current assets" /
    // "current liabilities" so this BS does not present 3+ "buckets".
    const text = [
      "BALANCE SHEET",
      "Total Current Assets    1,000,000",
      "Total Current Liabilities  400,000",
      "Net Worth (Current Period)  600,000",
      "Accounts Receivable        250,000",
      "30-day return policy",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    if (result.matched) {
      assert.notEqual(result.docType, "AR_AGING");
    }
  });
});

// ─── 4. AP aging / Accounts Payable → NOT AR_AGING ──────────────────────────

describe("AR Aging — must NOT match AP / payables", () => {
  test("'Accounts Payable Aging' with full buckets → NOT AR_AGING", () => {
    const text = [
      "Acme Corp",
      "Accounts Payable Aging",
      "As of December 31, 2025",
      "",
      "Vendor          Current    0-30      31-60     61-90     90+       Total",
      "Vendor A        $5,000     $2,000    $500      $0        $0        $7,500",
      "Vendor B        $0         $0        $250      $0        $0        $250",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    if (result.matched) {
      assert.notEqual(
        result.docType,
        "AR_AGING",
        "AP aging must not be classified as AR_AGING",
      );
    }
  });

  test("'A/P Aging Summary' → NOT AR_AGING", () => {
    const text = [
      "A/P Aging Summary",
      "Current    0-30    31-60    61-90    90+",
      "$1,000     $500    $250     $0       $200",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    if (result.matched) {
      assert.notEqual(result.docType, "AR_AGING");
    }
  });

  test("'Vendor Aging Report' → NOT AR_AGING", () => {
    const text = [
      "Vendor Aging Report",
      "Vendor    Current    30 days    60 days    90 days",
      "Acme      $1,000     $500       $0         $0",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    if (result.matched) {
      assert.notEqual(result.docType, "AR_AGING");
    }
  });

  test("'Aged Payables' → NOT AR_AGING", () => {
    const text = [
      "Aged Payables",
      "Current    30 days    60 days    90 days    120 days",
      "$5,000     $1,000     $500       $200       $0",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    if (result.matched) {
      assert.notEqual(result.docType, "AR_AGING");
    }
  });
});

// ─── 5. Omnicare reproduction (previously classified as OTHER) ──────────────

describe("AR Aging — Omnicare reproduction", () => {
  test("Omnicare-style A/R aging that was OTHER pre-fix → AR_AGING", () => {
    // Reconstructed shape of the Omnicare A/R aging that fell through to
    // OTHER on main. Has the title, a customer column, and the 5-bucket
    // QuickBooks-export shape. With this fix it should classify cleanly.
    const text = [
      "Omnicare 365",
      "A/R Aging Summary",
      "As of: 12/31/2025",
      "",
      "Customer                Current      1 - 30      31 - 60     61 - 90     > 90       Total",
      "ABC Healthcare LLC      12,500.00    3,200.00    0.00        0.00        0.00       15,700.00",
      "Beta Medical Group      0.00         5,400.00    1,200.00    0.00        0.00       6,600.00",
      "Gamma Surgical Inc      8,900.00     0.00        0.00        2,100.00    0.00       11,000.00",
      "Delta Therapy Co        0.00         0.00        0.00        0.00        4,500.00   4,500.00",
      "Epsilon Diagnostics     2,300.00     1,100.00    750.00      0.00        0.00       4,150.00",
      "",
      "Total                   23,700.00    9,700.00    1,950.00    2,100.00    4,500.00   41,950.00",
    ].join("\n");

    const result = runTier2Structural(makeDoc(text));
    assert.equal(result.matched, true, "Omnicare doc must classify");
    assert.equal(
      result.docType,
      "AR_AGING",
      "Omnicare doc must be AR_AGING (was OTHER pre-fix)",
    );
    // Evidence must include keyword + customer column + buckets for audit
    const evidenceText = result.evidence.map((e) => e.matchedText).join("|");
    assert.match(evidenceText, /keyword:A\/R aging/);
    assert.match(evidenceText, /bucket:current/);
    assert.match(evidenceText, /bucket:1-30/);
  });
});

// ─── 6. Edge cases that should still classify ───────────────────────────────

describe("AR Aging — additional banker-realistic shapes", () => {
  test("'Aged Receivables' title + buckets → AR_AGING", () => {
    const text = [
      "Aged Receivables",
      "Customer    Current    30 days    60 days    90 days",
      "Foo         100        50         0          0",
    ].join("\n");
    const result = runTier2Structural(makeDoc(text));
    assert.equal(result.docType, "AR_AGING");
  });

  test("'Customer Aging' title + buckets → AR_AGING", () => {
    const text = [
      "Customer Aging",
      "Customer Name    Current    0-30    31-60    61-90    90+",
      "Tenant A         500        0       0        0        0",
    ].join("\n");
    const result = runTier2Structural(makeDoc(text));
    assert.equal(result.docType, "AR_AGING");
  });

  test("'Open Receivables' title + buckets → AR_AGING", () => {
    const text = [
      "Open Receivables",
      "Customer    Current    30 days    60 days    90 days",
      "Foo Inc     2,000      1,000      500        100",
    ].join("\n");
    const result = runTier2Structural(makeDoc(text));
    assert.equal(result.docType, "AR_AGING");
  });

  test("UK spelling 'ageing' is recognized", () => {
    const text = [
      "Accounts Receivable Ageing",
      "Customer    Current    0-30    31-60    61-90",
      "Foo         500        100     50       0",
    ].join("\n");
    const result = runTier2Structural(makeDoc(text));
    assert.equal(result.docType, "AR_AGING");
  });
});
