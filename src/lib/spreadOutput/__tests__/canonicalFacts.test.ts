/**
 * SPEC-SPREAD-ENTITY-SCOPING-1 — canonical-fact source scoping + key wiring.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCanonicalFactsFromRows,
  type CanonicalFactRow,
} from "@/lib/spreadOutput/canonicalFacts";

function row(p: Partial<CanonicalFactRow>): CanonicalFactRow {
  return {
    fact_key: p.fact_key ?? "",
    fact_value_num: p.fact_value_num ?? null,
    fact_value_text: p.fact_value_text ?? null,
    fact_period_end: p.fact_period_end ?? null,
    source_canonical_type: p.source_canonical_type ?? null,
  };
}

test("[canonical-facts-1] personal facts barred from business-owned cells", () => {
  const { facts } = buildCanonicalFactsFromRows([
    row({ fact_key: "GROSS_RECEIPTS", fact_value_num: 14765311, fact_period_end: "2023-12-31", source_canonical_type: "BUSINESS_TAX_RETURN" }),
    row({ fact_key: "TOTAL_INCOME", fact_value_num: 282742, fact_period_end: "2023-12-31", source_canonical_type: "PERSONAL_TAX_RETURN" }),
    row({ fact_key: "TOTAL_INCOME", fact_value_num: 1472421, fact_period_end: "2023-12-31", source_canonical_type: "BUSINESS_TAX_RETURN" }),
  ]);
  assert.equal(facts["GROSS_RECEIPTS_2023"], 14765311);
  // Business value occupies the cell; personal 282742 never enters.
  assert.equal(facts["TOTAL_INCOME_2023"], 1472421);
});

test("[canonical-facts-2] revenue alias cannot pull a personal TOTAL_INCOME", () => {
  const { facts } = buildCanonicalFactsFromRows([
    row({ fact_key: "TOTAL_INCOME", fact_value_num: 282742, fact_period_end: "2023-12-31", source_canonical_type: "PERSONAL_TAX_RETURN" }),
  ]);
  // No business revenue → the business revenue cell must stay empty.
  assert.equal(facts["GROSS_RECEIPTS_2023"] ?? null, null);
});

test("[canonical-facts-3] INCOME_STATEMENT TOTAL_REVENUE still aliases to GROSS_RECEIPTS", () => {
  const { facts } = buildCanonicalFactsFromRows([
    row({ fact_key: "TOTAL_REVENUE", fact_value_num: 25861373, fact_period_end: "2025-12-31", source_canonical_type: "INCOME_STATEMENT" }),
  ]);
  assert.equal(facts["GROSS_RECEIPTS_2025"], 25861373);
});

test("[canonical-facts-4] Sched E rent add-back (personal source) is not barred", () => {
  const { facts } = buildCanonicalFactsFromRows([
    row({ fact_key: "SCH_E_GROSS_RENTS_RECEIVED", fact_value_num: 50000, fact_period_end: "2024-12-31", source_canonical_type: "PERSONAL_TAX_RETURN" }),
  ]);
  assert.equal(facts["SCH_E_GROSS_RENTS_RECEIVED_2024"], 50000);
});

test("[canonical-facts-5] FinancialsClient Officer Compensation row wires OFFICER_COMPENSATION", () => {
  const FILE = resolve(
    process.cwd(),
    "src/app/(app)/deals/[dealId]/financials/FinancialsClient.tsx",
  );
  const SRC = readFileSync(FILE, "utf8");
  // The Officer Compensation RowDef must list the real extractor key.
  assert.match(
    SRC,
    /Officer Compensation[^\n]*"OFFICER_COMPENSATION"/,
    "Officer Compensation row does not reference the real OFFICER_COMPENSATION key",
  );
});
