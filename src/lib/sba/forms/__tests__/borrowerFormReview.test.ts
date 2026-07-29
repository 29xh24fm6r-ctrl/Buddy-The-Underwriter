import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { buildBorrowerFormReview, confirmStructuredField } =
  require("../borrowerFormReview") as typeof import("../borrowerFormReview");
const { __setProviderImplForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../../../ai/gateway") as typeof import("../../../ai/gateway");

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

// ─── Generic fake Supabase — single-row-or-array per table, matching each
// table's own consistent query shape in the real input builders. ────────
type Row = Record<string, any>;

function fakeDb(tables: Record<string, Row | Row[] | null | undefined>) {
  return {
    from(table: string) {
      const value = tables[table];
      const asArray = Array.isArray(value) ? value : value ? [value] : [];
      const q: any = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        in() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        maybeSingle() {
          return Promise.resolve({ data: asArray[0] ?? null, error: null });
        },
        upsert(payload: Row) {
          tables[table] = tables[table] ?? [];
          (tables[table] as Row[]).push(payload);
          return Promise.resolve({ data: null, error: null });
        },
        update(payload: Row) {
          if (asArray[0]) Object.assign(asArray[0], payload);
          return q;
        },
        then(onFulfilled: any, onRejected: any) {
          return Promise.resolve({ data: asArray, error: null }).then(onFulfilled, onRejected);
        },
      };
      return q;
    },
  };
}

test("buildBorrowerFormReview(413): flattens the primary signer's deterministic fields, no structurer involved", async () => {
  const db = fakeDb({
    deals: { borrower_id: "borrower-1" },
    borrowers: { legal_name: "Acme LLC", phone: "555-0100", entity_type: "llc" },
    ownership_entities: [{ id: "owner-1", entity_type: "individual", display_name: "Jane Doe", ownership_pct: 60 }],
    borrower_applicant_financials: { net_worth: 500000, liquid_assets: 100000 },
  });

  const review = await buildBorrowerFormReview("deal-1", "bank-1", "413", db);

  assert.equal(review.formCode, "413");
  const nameField = review.fields.find((f) => f.key === "full_name");
  assert.equal(nameField?.value, "Jane Doe");
  assert.equal(nameField?.source, "deterministic");
  assert.equal(nameField?.confirmed, true);
  // schedule arrays (notes_payable/securities/real_estate_properties) are excluded from the flat review
  assert.equal(review.fields.some((f) => f.key === "notes_payable"), false);
});

test("buildBorrowerFormReview(1919): no confirmed classification yet — generates and persists one, unconfirmed", async () => {
  __setProviderImplForTests("openai", async () => ({
    text: JSON.stringify({
      categorized: [{ category: "equipment", amount: 200000, description: "machinery" }],
      hasUncategorizedResidue: false,
      rationale: "single clear purpose",
    }),
    tokensIn: 10,
    tokensOut: 10,
  }));

  const tables: Record<string, any> = {
    deals: { id: "deal-1", deal_type: "7a", loan_amount: 200000, borrower_id: "borrower-1" },
    deal_loan_requests: { requested_amount: 200000, use_of_proceeds: "buying new machinery" },
    borrowers: { legal_name: "Acme LLC" },
    ownership_entities: [],
  };
  const db = fakeDb(tables);

  const review = await buildBorrowerFormReview("deal-1", "bank-1", "1919", db);

  const equipmentField = review.fields.find((f) => f.key === "use_of_proceeds:equipment");
  assert.ok(equipmentField, "expected an equipment category field");
  assert.equal(equipmentField!.value, 200000);
  assert.equal(equipmentField!.source, "structurer");
  assert.equal(equipmentField!.confirmed, false, "freshly generated classification must be unconfirmed");

  const persisted = (tables.deal_structured_field_confirmations ?? [])[0];
  assert.ok(persisted, "classification must be persisted");
  assert.equal(persisted.confirmed, false);
});

test("buildBorrowerFormReview(1919): a previously confirmed classification is read back as confirmed", async () => {
  const tables: Record<string, any> = {
    deals: { id: "deal-1", deal_type: "7a", loan_amount: 200000, borrower_id: "borrower-1" },
    deal_loan_requests: { requested_amount: 200000, use_of_proceeds: "buying new machinery" },
    borrowers: { legal_name: "Acme LLC" },
    ownership_entities: [],
    deal_structured_field_confirmations: {
      value: { categorized: [{ category: "equipment", amount: 200000, description: "machinery" }] },
      confirmed: true,
    },
  };
  const db = fakeDb(tables);

  const review = await buildBorrowerFormReview("deal-1", "bank-1", "1919", db);
  const equipmentField = review.fields.find((f) => f.key === "use_of_proceeds:equipment");
  assert.equal(equipmentField?.confirmed, true);
});

test("confirmStructuredField marks an existing row confirmed", async () => {
  const tables: Record<string, any> = {
    deal_structured_field_confirmations: {
      id: "row-1",
      value: { categorized: [{ category: "other", amount: 100000, description: null }] },
      confirmed: false,
    },
  };
  const db = fakeDb(tables);

  const result = await confirmStructuredField("deal-1", "1919", "use_of_proceeds_categories", null, db);
  assert.equal(result.ok, true);
  assert.equal(tables.deal_structured_field_confirmations.confirmed, true);
});

test("confirmStructuredField returns not_found when no row exists yet", async () => {
  const db = fakeDb({});
  const result = await confirmStructuredField("deal-1", "1919", "use_of_proceeds_categories", null, db);
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_found");
});
