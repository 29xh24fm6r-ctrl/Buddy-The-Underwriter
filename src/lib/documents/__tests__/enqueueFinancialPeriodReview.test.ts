/**
 * SPEC-FINANCIAL-PERIOD-REVIEW-QUEUE-ENQUEUE-1 — Enqueue + wiring guards
 *
 * The full detection matrix lives in financialPeriodReview.test.ts. Here we
 * verify, without importing the server-only enqueue module (the repo convention
 * is to string-read server-only files in tests):
 *
 * - the enqueue decision gate is the pure getFinancialPeriodReviewReason, so the
 *   acceptance cases resolve correctly (generic IS / generic BS enqueue; resolved
 *   annual P&L and non-financial docs do not);
 * - the enqueue function is idempotent (OPEN pre-check + 23505 race handling),
 *   requires bank_id, and inserts an OPEN row; and
 * - both the automatic classify path and the admin seed endpoint route through
 *   the single shared enqueue function.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getFinancialPeriodReviewReason } from "../financialPeriodReview";

const repoRoot = resolve(__dirname, "../../../..");
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

const ENQUEUE = read("src/lib/documents/enqueueFinancialPeriodReview.ts");
const CLASSIFY = read("src/lib/jobs/processors/classifyProcessor.ts");
const ADMIN = read("src/app/api/admin/financial-period-reviews/route.ts");

describe("enqueue decision gate (pure getFinancialPeriodReviewReason)", () => {
  it("generic INCOME_STATEMENT (null checklist_key) → enqueues with YTD/ANNUAL reason", () => {
    const reason = getFinancialPeriodReviewReason({
      canonicalType: "INCOME_STATEMENT", checklistKey: null, statementPeriod: null,
    });
    assert.ok(reason);
    assert.match(reason!, /YTD or ANNUAL/);
  });

  it("generic BALANCE_SHEET → enqueues with CURRENT/HISTORICAL reason (no live BS needed)", () => {
    const reason = getFinancialPeriodReviewReason({
      canonicalType: "BALANCE_SHEET", checklistKey: "BALANCE_SHEET", statementPeriod: null,
    });
    assert.ok(reason);
    assert.match(reason!, /CURRENT or HISTORICAL/);
  });

  it("resolved annual P&L (FIN_STMT_PL_ANNUAL) → does NOT enqueue", () => {
    assert.equal(getFinancialPeriodReviewReason({
      canonicalType: "INCOME_STATEMENT", checklistKey: "FIN_STMT_PL_ANNUAL", statementPeriod: "ANNUAL",
    }), null);
  });

  it("non-financial document → does NOT enqueue", () => {
    assert.equal(getFinancialPeriodReviewReason({
      canonicalType: "BUSINESS_TAX_RETURN", checklistKey: "IRS_BUSINESS_2025", statementPeriod: null,
    }), null);
  });
});

describe("enqueueFinancialPeriodReview function (source guards)", () => {
  it("gates on the pure reason and returns early when not needed", () => {
    assert.match(ENQUEUE, /getFinancialPeriodReviewReason/);
    assert.match(ENQUEUE, /if \(!reason\) return \{ enqueued: false, skipped: "not_needed" \}/);
  });

  it("is idempotent — pre-checks for an existing OPEN review by document_id", () => {
    assert.match(ENQUEUE, /\.eq\("document_id", args\.documentId\)/);
    assert.match(ENQUEUE, /\.eq\("status", "OPEN"\)/);
    assert.match(ENQUEUE, /already_open/);
  });

  it("treats a 23505 unique-violation race as already_open (the partial OPEN index)", () => {
    assert.match(ENQUEUE, /23505/);
  });

  it("requires bank_id (NOT NULL column) before inserting", () => {
    assert.match(ENQUEUE, /if \(!args\.bankId\) return \{ enqueued: false, skipped: "missing_bank"/);
  });

  it("inserts an OPEN review row", () => {
    assert.match(ENQUEUE, /status: "OPEN"/);
  });
});

describe("wiring: single shared enqueue path", () => {
  it("classifyProcessor calls enqueueFinancialPeriodReviewIfNeeded with the fresh resolution", () => {
    assert.match(CLASSIFY, /enqueueFinancialPeriodReviewIfNeeded/);
    assert.match(CLASSIFY, /canonicalType: canonical_type/);
    assert.match(CLASSIFY, /checklistKey: checklist_key/);
    assert.match(CLASSIFY, /statementPeriod,/);
  });

  it("admin seed endpoint routes through the same shared function", () => {
    assert.match(ADMIN, /enqueueFinancialPeriodReviewIfNeeded/);
    // The old hand-rolled batch insert must be gone (DRY — one enqueue rule).
    assert.doesNotMatch(ADMIN, /\.insert\(newRows\)/);
  });
});
