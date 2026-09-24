import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { loadMemoBorrowerEvidence } = require("../packageBorrowerEvidence") as typeof import("../packageBorrowerEvidence");
function client(fail = "", wrongBank = false) {
  const rows: Record<string, any> = {
    deals: { id: "deal", bank_id: wrongBank ? "other" : "bank", borrower_id: "business", name: "Legacy Contact" },
    borrowers: { legal_name: "QA Coffee LLC", entity_type: "llc", naics_code: "722515" },
    borrower_applications: null,
    borrower_concierge_sessions: { confirmed_facts: { package_answers: { B07: { value: "Preparing to open" } } } },
    ownership_entities: [{ id: "owner-b", display_name: "Second Owner", ownership_pct: 30 }, { id: "owner-a", display_name: "First Owner", ownership_pct: 70 }],
    borrower_applicant_financials: [{ applicant_id: "owner-a", liquid_assets: "350000", net_worth: "750000", income_salary: "100000" }, { applicant_id: "owner-b", liquid_assets: "", net_worth: null, income_salary: false }],
  };
  const reads: string[] = [];
  return { reads, from(table: string) {
    reads.push(table);
    const filters: Record<string, unknown> = {};
    const q: any = { select: () => q, order: () => q, limit: () => q, maybeSingle: () => q,
      eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      in: (key: string, values: string[]) => { assert.equal(key, "applicant_id"); assert.deepEqual(values, ["owner-b", "owner-a"]); return q; },
      then: (resolve: any) => {
        if (table === "deals") assert.deepEqual(filters, { id: "deal", bank_id: "bank" });
        if (table === "ownership_entities") assert.equal(filters.deal_id, "deal");
        return Promise.resolve({ data: rows[table], error: table === fail ? { message: "read failed" } : null }).then(resolve);
      } };
    return q;
  } };
}
test("canonical-only owner statements remain identified, qualified and separate from ongoing income", async () => {
  const evidence = await loadMemoBorrowerEvidence(client(), "deal", "bank");
  assert.equal(evidence.business.name, "QA Coffee LLC");
  assert.equal(evidence.business.businessEntityType, "llc");
  assert.equal(evidence.owners[0].personalStatement.netWorth, null);
  assert.equal(evidence.owners[0].personalStatement.statedAnnualSalary, null);
  assert.equal(evidence.owners[1].personalStatement.netWorth, 750000);
  assert.equal(evidence.owners[1].personalStatement.liquidAssets, 350000);
  assert.equal(evidence.owners[1].personalStatement.ongoingIncomeConfirmed, false);
  assert.match(evidence.evidencePolicy, /not verified guarantees/);
});
test("tenant mismatch and missing evidence reads fail closed", async () => {
  const mismatch = client("", true);
  await assert.rejects(loadMemoBorrowerEvidence(mismatch, "deal", "bank"), /deal_mismatch/);
  assert.deepEqual(mismatch.reads, ["deals"]);
  for (const table of ["ownership_entities", "borrower_applicant_financials"]) {
    await assert.rejects(loadMemoBorrowerEvidence(client(table), "deal", "bank"), /unavailable/);
  }
});
