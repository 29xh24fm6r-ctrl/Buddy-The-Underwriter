/**
 * SPEC-FINANCIAL-PERIOD-REVIEW-QUEUE-1 — Resolver tests (source-pattern guards)
 *
 * Verifies the resolver module uses resolveChecklistKey as the single source
 * of truth and emits audit events. Pure source-pattern tests — no DB needed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { resolveChecklistKey } from "@/lib/docTyping/resolveChecklistKey";

const RESOLVER_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/lib/documents/resolveFinancialStatementPeriod.ts"),
  "utf-8",
);

describe("resolveFinancialStatementPeriod source guards", () => {
  it("imports resolveChecklistKey as single source of truth", () => {
    assert.ok(RESOLVER_SRC.includes("resolveChecklistKey"));
  });

  it("imports writeEvent for audit trail", () => {
    assert.ok(RESOLVER_SRC.includes("writeEvent"));
  });

  it("emits document.period_review.resolved event", () => {
    assert.ok(RESOLVER_SRC.includes("document.period_review.resolved"));
  });

  it("emits document.period_review.not_applicable event", () => {
    assert.ok(RESOLVER_SRC.includes("document.period_review.not_applicable"));
  });

  it("sets finalized_at on resolution", () => {
    assert.ok(RESOLVER_SRC.includes("finalized_at"));
  });

  it("does not hard-code checklist key strings (uses resolveChecklistKey)", () => {
    // Should not contain literal FIN_STMT_BS_CURRENT etc. — those come from resolveChecklistKey
    assert.ok(!RESOLVER_SRC.includes("\"FIN_STMT_BS_CURRENT\""),
      "Resolver must not hard-code FIN_STMT_BS_CURRENT — use resolveChecklistKey");
    assert.ok(!RESOLVER_SRC.includes("\"FIN_STMT_PL_YTD\""),
      "Resolver must not hard-code FIN_STMT_PL_YTD — use resolveChecklistKey");
  });
});

describe("resolveChecklistKey expected mappings", () => {
  it("BALANCE_SHEET + CURRENT → FIN_STMT_BS_CURRENT", () => {
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null, "CURRENT"), "FIN_STMT_BS_CURRENT");
  });

  it("BALANCE_SHEET + HISTORICAL → FIN_STMT_BS_HISTORICAL", () => {
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null, "HISTORICAL"), "FIN_STMT_BS_HISTORICAL");
  });

  it("INCOME_STATEMENT + YTD → FIN_STMT_PL_YTD", () => {
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null, "YTD"), "FIN_STMT_PL_YTD");
  });

  it("INCOME_STATEMENT + ANNUAL → FIN_STMT_PL_ANNUAL", () => {
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null, "ANNUAL"), "FIN_STMT_PL_ANNUAL");
  });

  it("invalid missing period_end rejects (returns null)", () => {
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null, null), null);
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null, null), null);
  });
});
