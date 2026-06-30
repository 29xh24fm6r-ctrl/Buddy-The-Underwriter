/**
 * SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 2 tests.
 *
 * Pure unit tests:
 *   - resolveDocTaxYear: ai_tax_year preference, doc_year fallback, null-safety.
 *   - summarizeRevalidation: per-doc outcomes → RevalidationSummary counts.
 *
 * Source-grep guards (the orchestrator is server-only with no fake-Supabase
 * seam, so we assert wiring by inspection — matching the extraction directory's
 * existing convention: postExtractionValidatorWiring, validationGateGuard, etc.):
 *   - revalidateDealDocuments enumerates deal_documents, calls the validator per
 *     doc, and emits extraction.deal_revalidation_complete.
 *   - the route mirrors the sibling deal-route auth and calls the orchestrator.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  resolveDocTaxYear,
  summarizeRevalidation,
  type RevalidationDocOutcome,
} from "@/lib/extraction/revalidationSummary";

function read(relPath: string): string {
  return readFileSync(path.resolve(__dirname, "../../../..", relPath), "utf-8");
}

// ── Pure: resolveDocTaxYear ────────────────────────────────────────────────

test("[vgr2-tax-a] prefers ai_tax_year when present", () => {
  assert.equal(resolveDocTaxYear({ ai_tax_year: 2024, doc_year: 2022 }), 2024);
});

test("[vgr2-tax-b] falls back to doc_year when ai_tax_year is null", () => {
  assert.equal(resolveDocTaxYear({ ai_tax_year: null, doc_year: 2023 }), 2023);
});

test("[vgr2-tax-c] null-safe when both are null", () => {
  assert.equal(resolveDocTaxYear({ ai_tax_year: null, doc_year: null }), null);
});

test("[vgr2-tax-d] ai_tax_year=0 is not treated as missing (nullish, not falsy)", () => {
  // ?? only falls back on null/undefined — a literal 0 stays 0 (defensive: real
  // tax years are never 0, but the operator semantics matter).
  assert.equal(resolveDocTaxYear({ ai_tax_year: 0, doc_year: 2021 }), 0);
});

// ── Pure: summarizeRevalidation reducer ────────────────────────────────────

function outcome(
  partial: Partial<RevalidationDocOutcome> & { documentId: string; status: string },
): RevalidationDocOutcome {
  return {
    formType: partial.formType ?? null,
    taxYear: partial.taxYear ?? null,
    rowWritten: partial.rowWritten ?? false,
    ...partial,
  };
}

test("[vgr2-sum-a] empty outcomes → zeroed summary", () => {
  const s = summarizeRevalidation("deal-1", []);
  assert.equal(s.dealId, "deal-1");
  assert.equal(s.docsProcessed, 0);
  assert.equal(s.rowsWritten, 0);
  assert.equal(s.passedTotal, 0);
  assert.equal(s.failedTotal, 0);
  assert.equal(s.skippedTotal, 0);
  assert.deepEqual(s.byStatus, {});
  assert.deepEqual(s.perDoc, []);
});

test("[vgr2-sum-b] rolls up VERIFIED/FLAGGED/BLOCKED/SKIPPED into pass/fail/skip totals", () => {
  const s = summarizeRevalidation("deal-1", [
    outcome({ documentId: "a", status: "VERIFIED", rowWritten: true, formType: "FORM_1120", taxYear: 2024 }),
    outcome({ documentId: "b", status: "FLAGGED", rowWritten: true }),
    outcome({ documentId: "c", status: "BLOCKED", rowWritten: true }),
    outcome({ documentId: "d", status: "SKIPPED", rowWritten: false }),
  ]);
  assert.equal(s.docsProcessed, 4);
  assert.equal(s.rowsWritten, 3);
  assert.equal(s.passedTotal, 1);
  assert.equal(s.failedTotal, 2); // FLAGGED + BLOCKED
  assert.equal(s.skippedTotal, 1);
  assert.deepEqual(s.byStatus, { VERIFIED: 1, FLAGGED: 1, BLOCKED: 1, SKIPPED: 1 });
});

test("[vgr2-sum-c] PARTIAL is counted in byStatus only, not in pass/fail/skip totals", () => {
  const s = summarizeRevalidation("deal-1", [
    outcome({ documentId: "a", status: "PARTIAL", rowWritten: true }),
    outcome({ documentId: "b", status: "PARTIAL", rowWritten: true }),
  ]);
  assert.equal(s.docsProcessed, 2);
  assert.equal(s.passedTotal, 0);
  assert.equal(s.failedTotal, 0);
  assert.equal(s.skippedTotal, 0);
  assert.deepEqual(s.byStatus, { PARTIAL: 2 });
});

test("[vgr2-sum-d] perDoc preserves documentId/formType/taxYear/status, drops rowWritten", () => {
  const s = summarizeRevalidation("deal-1", [
    outcome({ documentId: "a", status: "VERIFIED", rowWritten: true, formType: "FORM_1120", taxYear: 2024 }),
  ]);
  assert.deepEqual(s.perDoc, [
    { documentId: "a", formType: "FORM_1120", taxYear: 2024, status: "VERIFIED" },
  ]);
  assert.equal((s.perDoc[0] as Record<string, unknown>).rowWritten, undefined);
});

// ── Grep guard: orchestrator wiring ────────────────────────────────────────

const ORCH = read("src/lib/extraction/revalidateDealDocuments.ts");

test("[vgr2-orch-a] enumerates deal_documents selecting the tax-year columns", () => {
  assert.match(ORCH, /\.from\(["']deal_documents["']\)/, "must query deal_documents");
  assert.match(
    ORCH,
    /\.select\(["'][^"']*ai_tax_year[^"']*doc_year[^"']*["']\)/,
    "must select ai_tax_year + doc_year (NOT tax_year)",
  );
  assert.match(ORCH, /\.eq\(["']deal_id["']/, "must scope query by deal_id");
});

test("[vgr2-orch-b] calls runPostExtractionValidation per doc with docRow + resolved tax year", () => {
  assert.match(ORCH, /runPostExtractionValidation\(/, "must call the per-doc validator");
  assert.match(
    ORCH,
    /runPostExtractionValidation\([\s\S]*?canonical_type:\s*doc\.canonical_type[\s\S]*?ai_form_numbers:\s*doc\.ai_form_numbers[\s\S]*?document_type:\s*doc\.document_type/,
    "validator must be called with the constructed docRow",
  );
  assert.match(ORCH, /resolveDocTaxYear\(doc\)/, "tax year must come from resolveDocTaxYear");
});

test("[vgr2-orch-c] does NOT pre-filter tax vs non-tax before calling the validator", () => {
  // The validator's own isTaxReturnDocument self-gate is the single source of
  // truth. isTaxReturnDocument may be used for the rowWritten count, but must
  // NOT guard the runPostExtractionValidation call.
  assert.equal(
    /if\s*\(\s*!?\s*isTaxReturnDocument\([^)]*\)\s*\)\s*\{[\s\S]*?continue/.test(ORCH),
    false,
    "must not skip the validator call based on isTaxReturnDocument",
  );
});

test("[vgr2-orch-d] emits extraction.deal_revalidation_complete with the summary", () => {
  assert.match(ORCH, /writeEvent\(/, "must emit a ledger event");
  assert.match(
    ORCH,
    /kind:\s*["']extraction\.deal_revalidation_complete["']/,
    "ledger event kind must be extraction.deal_revalidation_complete",
  );
  assert.match(ORCH, /scope:\s*["']extraction["']/, "ledger scope must be extraction");
  assert.match(ORCH, /meta:\s*summary/, "ledger meta must be the summary");
});

test("[vgr2-orch-e] never throws — per-doc try/catch + non-fatal query guards", () => {
  assert.match(ORCH, /Never throws/i, "must document the never-throw contract");
  assert.match(ORCH, /catch \(err\)/, "must guard per-doc validation in try/catch");
});

// ── Grep guard: route mirrors sibling auth + calls orchestrator ────────────

const ROUTE = read("src/app/api/deals/[dealId]/revalidate/route.ts");
const SIBLING = read("src/app/api/deals/[dealId]/spread-output/route.ts");

test("[vgr2-route-a] mirrors the sibling deal-route auth import (ensureDealBankAccess)", () => {
  assert.match(
    SIBLING,
    /import \{ ensureDealBankAccess \} from "@\/lib\/tenant\/ensureDealBankAccess"/,
    "sibling must use ensureDealBankAccess (anchor for the mirror)",
  );
  assert.match(
    ROUTE,
    /import \{ ensureDealBankAccess \} from "@\/lib\/tenant\/ensureDealBankAccess"/,
    "route must embed the sibling's ensureDealBankAccess import verbatim",
  );
  assert.match(
    ROUTE,
    /const access = await ensureDealBankAccess\(dealId\);[\s\S]*?if \(!access\.ok\)/,
    "route must verify deal ownership before acting (never the path dealId alone)",
  );
});

test("[vgr2-route-b] POST calls revalidateDealDocuments and returns the summary", () => {
  assert.match(ROUTE, /export async function POST\(/, "route must export POST");
  assert.match(
    ROUTE,
    /import \{ revalidateDealDocuments \} from "@\/lib\/extraction\/revalidateDealDocuments"/,
    "route must import the orchestrator",
  );
  assert.match(
    ROUTE,
    /await revalidateDealDocuments\(dealId\)/,
    "route body of work must be revalidateDealDocuments(dealId)",
  );
  assert.match(ROUTE, /NextResponse\.json\(\{ ok: true, summary \}\)/, "route must return the summary");
});
