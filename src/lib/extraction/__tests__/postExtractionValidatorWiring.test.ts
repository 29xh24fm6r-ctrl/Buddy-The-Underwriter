/**
 * SPEC-EXTRACT-VALIDATOR-WIRE-1 (rev 2) §2 wiring tests.
 *
 * V-3: postExtractionValidator structural self-gates + persistSkipped paths.
 * V-4: runRecord.ts finalizeExtractionRun caller constructs docRow.
 * V-5: validation_disabled self-gate reads from deals table inside validator.
 *
 * These are source-grep guard tests, matching the extraction directory's
 * existing convention (validationGateGuard, slotBindingGuard, etc.). The
 * validator imports server-only and touches Supabase, so behavioral tests
 * would require module mocking. The wired call path is exercised end-to-end
 * by the §10 OmniCare operator smoke test post-merge.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return readFileSync(path.resolve(__dirname, "../../../..", relPath), "utf-8");
}

// ── V-3: postExtractionValidator structural self-gates ─────────────────────

const VALIDATOR = read("src/lib/extraction/postExtractionValidator.ts");

test("[evw-v3-a] validation_disabled self-gate exists and returns SKIPPED without persisting a row", () => {
  // Reads deals.validation_disabled
  assert.match(VALIDATOR, /\.from\(["']deals["']\)/, "validator must query the deals table");
  assert.match(VALIDATOR, /validation_disabled/, "validator must read validation_disabled");

  // The disabled-branch returns SKIPPED with the canonical summary
  assert.match(
    VALIDATOR,
    /validation_disabled=true on deal/,
    "validator must use the canonical 'validation_disabled=true on deal' summary",
  );

  // The disabled-branch does NOT call persistSkipped (no row when tenant disables)
  const disabledBranch = VALIDATOR.match(
    /if \(dealRow\?\.validation_disabled\)[\s\S]*?return \{[\s\S]*?\};\s*\}/,
  );
  assert.ok(disabledBranch, "validation_disabled branch must exist");
  assert.equal(
    /persistSkipped/.test(disabledBranch![0]),
    false,
    "validation_disabled branch must NOT persist a SKIPPED row",
  );
});

test("[evw-v3-b] non-tax-return self-gate exists and returns SKIPPED without persisting", () => {
  assert.match(
    VALIDATOR,
    /isTaxReturnDocument/,
    "validator must self-gate on isTaxReturnDocument",
  );
  assert.match(
    VALIDATOR,
    /Not a tax-return document/,
    "validator must use the canonical 'Not a tax-return document' summary",
  );

  // The non-tax branch does NOT call persistSkipped
  const nonTaxBranch = VALIDATOR.match(
    /if \(!isTaxReturnDocument\(docRow\)\)[\s\S]*?return \{[\s\S]*?\};\s*\}/,
  );
  assert.ok(nonTaxBranch, "isTaxReturnDocument branch must exist");
  assert.equal(
    /persistSkipped/.test(nonTaxBranch![0]),
    false,
    "non-tax branch must NOT persist a SKIPPED row",
  );
});

test("[evw-v3-c] unresolved-form path persists a SKIPPED audit row", () => {
  // resolveIrsFormType is used (not hardcoded DOC_TYPE_TO_IRS_FORM)
  assert.match(VALIDATOR, /resolveIrsFormType/, "validator must call resolveIrsFormType");
  assert.equal(
    /DOC_TYPE_TO_IRS_FORM/.test(VALIDATOR),
    false,
    "validator must no longer use the hardcoded DOC_TYPE_TO_IRS_FORM map",
  );

  // The "irsFormType is null" branch calls persistSkipped before returning SKIPPED
  const unresolvedBranch = VALIDATOR.match(
    /if \(!irsFormType\)[\s\S]*?await persistSkipped\([\s\S]*?return \{[\s\S]*?\};\s*\}/,
  );
  assert.ok(
    unresolvedBranch,
    "unresolved-form-type branch must call persistSkipped before returning SKIPPED",
  );
});

test("[evw-v3-d] no-spec and facts-missing paths persist SKIPPED audit rows", () => {
  // Three persistSkipped call sites:
  //   1. unresolved form type (irsFormType is null)
  //   2. no form spec for the resolved type
  //   3. facts query failed OR returned no rows (single consolidated branch)
  const persistCount = (VALIDATOR.match(/await persistSkipped\(/g) ?? []).length;
  assert.equal(
    persistCount,
    3,
    `Expected 3 persistSkipped calls (unresolved-form + no-spec + facts-missing), got ${persistCount}`,
  );

  // Both error variants for the facts-missing branch must be present in the summary builder.
  assert.match(VALIDATOR, /Facts query failed/, "facts-error summary must exist");
  assert.match(VALIDATOR, /No facts found for document/, "no-facts summary must exist");
});

test("[evw-v3-e] validator never throws — wrapping try/catch present", () => {
  assert.match(VALIDATOR, /try \{/, "outer try block must exist");
  assert.match(
    VALIDATOR,
    /\} catch \(err\)[\s\S]*?status: ["']SKIPPED["']/,
    "outer catch must return SKIPPED, never throw",
  );
  assert.match(
    VALIDATOR,
    /Validation must never break extraction|Never throw|never throws/i,
    "validator must document the never-throw invariant",
  );
});

test("[evw-v3-f] signature accepts docRow shape (not bare canonicalType string)", () => {
  // Must declare a docRow parameter with the three expected fields
  assert.match(
    VALIDATOR,
    /docRow:\s*\{\s*canonical_type:\s*string\s*\|\s*null;\s*ai_form_numbers:\s*string\[\]\s*\|\s*null;\s*document_type:\s*string\s*\|\s*null;\s*\}/,
    "validator signature must accept docRow with the three required fields",
  );
});

// ── V-4: runRecord.ts caller constructs docRow ─────────────────────────────

const RUN_RECORD = read("src/lib/extraction/runRecord.ts");

test("[evw-v4-a] finalizeExtractionRun fetches deal_documents row before calling validator", () => {
  // The succeeded branch must SELECT canonical_type, ai_form_numbers, document_type
  assert.match(
    RUN_RECORD,
    /\.from\(["']deal_documents["']\)[\s\S]{0,200}\.select\(["'][^"']*canonical_type[^"']*ai_form_numbers[^"']*document_type/,
    "finalizeExtractionRun must fetch canonical_type + ai_form_numbers + document_type from deal_documents",
  );
});

test("[evw-v4-b] runPostExtractionValidation is called with docRow shape (not bare string)", () => {
  // The new call shape: canonical_type: docRow.canonical_type, ai_form_numbers: docRow.ai_form_numbers, document_type: docRow.document_type
  assert.match(
    RUN_RECORD,
    /runPostExtractionValidation\([\s\S]*?canonical_type:\s*docRow\.canonical_type[\s\S]*?ai_form_numbers:\s*docRow\.ai_form_numbers[\s\S]*?document_type:\s*docRow\.document_type/,
    "validator must be called with constructed docRow",
  );

  // And NOT with the old bare-string pattern
  assert.equal(
    /args\.metrics\?\.canonicalType as string/.test(RUN_RECORD),
    false,
    "old bare-canonicalType-string call shape must be gone",
  );
});

test("[evw-v4-c] caller guards on missing docRow (deletion between extraction and finalize)", () => {
  assert.match(
    RUN_RECORD,
    /if \(!docRow\) return/,
    "caller must short-circuit when docRow is missing (doc deleted)",
  );
});

test("[evw-v4-d] tax_year falls back through ai_tax_year → doc_year → metrics → null", () => {
  assert.match(
    RUN_RECORD,
    /docRow\.ai_tax_year\s*\?\?\s*docRow\.doc_year\s*\?\?\s*\(args\.metrics\?\.taxYear as number\)\s*\?\?\s*null/,
    "tax_year fallback chain must be ai_tax_year → doc_year → metrics → null",
  );
});

test("[evw-v4-e] caller remains fire-and-forget — wrapped in void async + try/catch", () => {
  // Find the succeeded-block and confirm both wrappers
  const succeededBlock = RUN_RECORD.match(
    /if \(args\.status === ["']succeeded["']\) \{[\s\S]*?\}\s*\)\(\);\s*\}/,
  );
  assert.ok(succeededBlock, "succeeded block must exist");
  assert.match(succeededBlock![0], /void \(async/, "must use void (async () => ...)() pattern");
  assert.match(
    succeededBlock![0],
    /catch \{[\s\S]*?\/\* validation must never break extraction \*\//,
    "validator failures must be swallowed inside the fire-and-forget block",
  );
});

// ── V-5: validation_disabled self-gate is INSIDE the validator ─────────────

test("[evw-v5-a] validation_disabled is read by validator, not by caller", () => {
  // Validator must read it (already covered in V-3a; reaffirmed here for clarity).
  assert.match(VALIDATOR, /validation_disabled/, "validator must read validation_disabled");

  // The CALLER must NOT also check validation_disabled — single source of truth.
  // (rev 2 design: validator self-gates so the flag applies uniformly across all call paths.)
  assert.equal(
    /validation_disabled/.test(RUN_RECORD),
    false,
    "runRecord.ts must NOT also check validation_disabled — validator owns the self-gate",
  );
});

test("[evw-v5-b] validation_disabled check happens BEFORE any other validator work", () => {
  // The validation_disabled check must precede the isTaxReturnDocument check and form resolution.
  const disabledIdx = VALIDATOR.indexOf("validation_disabled");
  const isTaxIdx = VALIDATOR.indexOf("isTaxReturnDocument(docRow)");
  const resolveIdx = VALIDATOR.indexOf("resolveIrsFormType(docRow)");

  assert.ok(disabledIdx > 0, "validation_disabled reference must exist");
  assert.ok(isTaxIdx > 0, "isTaxReturnDocument call must exist");
  assert.ok(resolveIdx > 0, "resolveIrsFormType call must exist");
  assert.ok(
    disabledIdx < isTaxIdx,
    "validation_disabled check must come before isTaxReturnDocument",
  );
  assert.ok(
    isTaxIdx < resolveIdx,
    "isTaxReturnDocument check must come before resolveIrsFormType",
  );
});

// ── extractFactsFromClassifiedArtifacts is NOT modified (rev 2 §3 dropped) ─

test("[evw-rev2-a] extractFactsFromClassifiedArtifacts.ts is NOT modified by this spec", () => {
  // rev 2 explicitly drops the batch-level wire-up. Confirm we did not touch it.
  const EXTRACT_BATCH = read("src/lib/financialFacts/extractFactsFromClassifiedArtifacts.ts");
  assert.equal(
    /runPostExtractionValidation/.test(EXTRACT_BATCH),
    false,
    "extractFactsFromClassifiedArtifacts must NOT import or call runPostExtractionValidation (rev 2 §3 dropped)",
  );
  assert.equal(
    /isTaxReturnDocument/.test(EXTRACT_BATCH),
    false,
    "extractFactsFromClassifiedArtifacts must NOT import isTaxReturnDocument either",
  );
});
