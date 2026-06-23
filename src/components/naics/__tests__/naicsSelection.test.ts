import test from "node:test";
import assert from "node:assert/strict";

import {
  selectionFromSuggestion,
  selectionFromManual,
} from "@/components/naics/NaicsSuggestionPicker";

/**
 * SPEC-NAICS-TOOL-MEMO-INPUTS-INTEGRATION-1
 *
 * The picker reuses POST /api/deals/[dealId]/recovery/naics-suggest and maps a
 * chosen suggestion (or manual entry) into the borrower-story NAICS fields.
 */

test("selectionFromSuggestion maps code/description/confidence/rationale, source=suggested", () => {
  const sel = selectionFromSuggestion({
    naics_code: "561422",
    naics_description: "Telemarketing Bureaus and Other Contact Centers",
    confidence: 0.91,
    rationale: "BPO call center matches contact-center services.",
  });
  assert.equal(sel.naics_code, "561422");
  assert.equal(sel.naics_description, "Telemarketing Bureaus and Other Contact Centers");
  assert.equal(sel.industry_classification, "Telemarketing Bureaus and Other Contact Centers");
  assert.equal(sel.confidence, 0.91);
  assert.equal(sel.source, "suggested");
  assert.equal(sel.rationale, "BPO call center matches contact-center services.");
});

test("selectionFromManual maps code + description, source=manual, confidence null", () => {
  const sel = selectionFromManual("561422", "Call center / customer contact services");
  assert.equal(sel.naics_code, "561422");
  assert.equal(sel.naics_description, "Call center / customer contact services");
  assert.equal(sel.industry_classification, "Call center / customer contact services");
  assert.equal(sel.confidence, null);
  assert.equal(sel.source, "manual");
  assert.equal(sel.rationale, null);
});

test("selectionFromManual with blank code keeps the industry description (no fabricated code)", () => {
  const sel = selectionFromManual("", "Business process outsourcing / call center");
  assert.equal(sel.naics_code, null);
  assert.equal(sel.naics_description, "Business process outsourcing / call center");
  assert.equal(sel.industry_classification, "Business process outsourcing / call center");
  assert.equal(sel.source, "manual");
});
