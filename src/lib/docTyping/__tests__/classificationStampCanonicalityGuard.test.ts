/**
 * SPEC-CLEANUP-CLASSIFICATION-STAMP-CANONICALITY-1
 *
 * Guards that the job pipeline and artifact pipeline produce consistent
 * classification stamps, and that no canonical type drifts into stale
 * document_type / checklist_key values.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { normalizeToCanonical } from "@/lib/documents/normalizeType";
import { resolveDocTypeRouting } from "@/lib/documents/docTypeRouting";
import { resolveChecklistKey, PERIOD_REQUIRED_TYPES } from "@/lib/docTyping/resolveChecklistKey";

const CLASSIFY_PROCESSOR_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/lib/jobs/processors/classifyProcessor.ts"),
  "utf-8",
);

// ── Phase 3: AR Aging document_type canonicality ─────────────────────────────

describe("AR Aging classification stamp", () => {
  it("normalizeToCanonical maps AR_AGING → AR_AGING (not OTHER)", () => {
    assert.equal(normalizeToCanonical("AR_AGING"), "AR_AGING");
  });

  it("resolveDocTypeRouting maps AR_AGING → canonical AR_AGING + GEMINI_STRUCTURED", () => {
    const result = resolveDocTypeRouting("AR_AGING");
    assert.equal(result.canonical_type, "AR_AGING");
    assert.equal(result.routing_class, "GEMINI_STRUCTURED");
  });

  it("resolveChecklistKey maps AR_AGING → AR_AGING", () => {
    assert.equal(resolveChecklistKey("AR_AGING", null), "AR_AGING");
  });

  it("AR_AGING never produces document_type=OTHER from spine classification", () => {
    // The spine returns "AR_AGING". normalizeToCanonical must not fall through.
    const docType = normalizeToCanonical("AR_AGING");
    assert.notEqual(docType, "OTHER", "AR_AGING must not normalize to OTHER");
  });
});

// ── Phase 4: Balance Sheet checklist_key canonicality ─────────────────────────

describe("Balance Sheet classification stamp", () => {
  it("resolveDocTypeRouting maps BALANCE_SHEET → canonical BALANCE_SHEET", () => {
    const result = resolveDocTypeRouting("BALANCE_SHEET");
    assert.equal(result.canonical_type, "BALANCE_SHEET");
  });

  it("BALANCE_SHEET + CURRENT → FIN_STMT_BS_CURRENT", () => {
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null, "CURRENT"), "FIN_STMT_BS_CURRENT");
  });

  it("BALANCE_SHEET + HISTORICAL → FIN_STMT_BS_HISTORICAL", () => {
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null, "HISTORICAL"), "FIN_STMT_BS_HISTORICAL");
  });

  it("BALANCE_SHEET without period → null (requires period review)", () => {
    assert.equal(resolveChecklistKey("BALANCE_SHEET", null), null);
  });

  it("BALANCE_SHEET is in PERIOD_REQUIRED_TYPES", () => {
    assert.ok(PERIOD_REQUIRED_TYPES.has("BALANCE_SHEET"));
  });
});

// ── Phase 5: Income statement period-required is intentional ─────────────────

describe("Income Statement period behavior (intentional)", () => {
  it("INCOME_STATEMENT is in PERIOD_REQUIRED_TYPES", () => {
    assert.ok(PERIOD_REQUIRED_TYPES.has("INCOME_STATEMENT"));
  });

  it("INCOME_STATEMENT + YTD → FIN_STMT_PL_YTD", () => {
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null, "YTD"), "FIN_STMT_PL_YTD");
  });

  it("INCOME_STATEMENT + ANNUAL → FIN_STMT_PL_ANNUAL", () => {
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null, "ANNUAL"), "FIN_STMT_PL_ANNUAL");
  });

  it("INCOME_STATEMENT without period → null (period-required is intentional, not a classifier failure)", () => {
    // Income statements require manual period confirmation when period
    // cannot be derived from the document date. This is by design.
    assert.equal(resolveChecklistKey("INCOME_STATEMENT", null), null);
  });
});

// ── Pipeline consistency guards ──────────────────────────────────────────────

describe("Job pipeline / artifact pipeline consistency", () => {
  it("classifyProcessor imports classifyDocumentSpine (not legacy classifyDocument)", () => {
    assert.ok(
      CLASSIFY_PROCESSOR_SRC.includes("classifyDocumentSpine"),
      "classifyProcessor must use classifyDocumentSpine",
    );
    assert.ok(
      !CLASSIFY_PROCESSOR_SRC.includes("from \"@/lib/intelligence/classifyDocument\""),
      "classifyProcessor must NOT import legacy classifyDocument",
    );
  });

  it("classifyProcessor imports normalizeToCanonical for document_type", () => {
    assert.ok(
      CLASSIFY_PROCESSOR_SRC.includes("normalizeToCanonical"),
      "classifyProcessor must use normalizeToCanonical for document_type",
    );
  });

  it("classifyProcessor imports resolveChecklistKey", () => {
    assert.ok(
      CLASSIFY_PROCESSOR_SRC.includes("resolveChecklistKey"),
      "classifyProcessor must call resolveChecklistKey for checklist_key",
    );
  });

  it("classifyProcessor stamps checklist_key in the deal_documents update", () => {
    assert.ok(
      CLASSIFY_PROCESSOR_SRC.includes("checklist_key"),
      "classifyProcessor must stamp checklist_key",
    );
  });

  it("classifyProcessor passes classifierPeriodEnd for period derivation", () => {
    assert.ok(
      CLASSIFY_PROCESSOR_SRC.includes("classifierPeriodEnd"),
      "classifyProcessor must pass periodEnd for statement period derivation",
    );
  });

  it("resolveChecklistKey is the single source of truth for period-based financial statements", () => {
    // resolveChecklistKey must handle both BALANCE_SHEET and INCOME_STATEMENT
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/docTyping/resolveChecklistKey.ts"),
      "utf-8",
    );
    assert.ok(src.includes("case \"BALANCE_SHEET\":"));
    assert.ok(src.includes("case \"INCOME_STATEMENT\":"));
    assert.ok(src.includes("FIN_STMT_BS_CURRENT"));
    assert.ok(src.includes("FIN_STMT_BS_HISTORICAL"));
    assert.ok(src.includes("FIN_STMT_PL_YTD"));
    assert.ok(src.includes("FIN_STMT_PL_ANNUAL"));
  });
});
