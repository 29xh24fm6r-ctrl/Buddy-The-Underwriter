import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm1919Input } from "@/lib/sba/forms/form1919/inputBuilder";

/**
 * SPEC-M7 ZERO-REPEAT-PREFILL-1 — regression coverage for
 * inputBuilder.ts's additive use-of-proceeds classification. The critical
 * guarantee: with no CONFIRMED row, output is unchanged from pre-M7
 * behavior — only a confirmed row unlocks the per-category fields.
 */

type Row = Record<string, any>;

function fakeDb(tables: Record<string, Row | Row[] | null | undefined>) {
  return {
    from(table: string) {
      const value = tables[table];
      const asArray = Array.isArray(value) ? value : value ? [value] : [];
      const filters: Array<[string, any]> = [];
      const q: any = {
        select() {
          return q;
        },
        eq(col: string, val: any) {
          filters.push([col, val]);
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        maybeSingle() {
          const matched = asArray.filter((row) => filters.every(([col, val]) => row[col] === val));
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
        then(onFulfilled: any, onRejected: any) {
          const matched = asArray.filter((row) => filters.every(([col, val]) => row[col] === val));
          return Promise.resolve({ data: matched, error: null }).then(onFulfilled, onRejected);
        },
      };
      return q;
    },
  };
}

const BASE_TABLES = {
  deals: { id: "deal-1", deal_type: "7a", loan_amount: 250000, borrower_id: "borrower-1" },
  deal_loan_requests: {
    deal_id: "deal-1",
    requested_amount: 250000,
    use_of_proceeds: [{ category: "equipment", amount: 250000, description: "buying equipment" }],
  },
  borrowers: { id: "borrower-1", legal_name: "Acme LLC" },
  ownership_entities: [],
};

function confirmationRow(overrides: Partial<Row>): Row {
  return {
    deal_id: "deal-1",
    form_code: "1919",
    field_key: "use_of_proceeds_categories",
    confirmed: true,
    ...overrides,
  };
}

test("no confirmed classification row: category fields stay null, flag is false — pre-M7 behavior preserved", async () => {
  const db = fakeDb({ ...BASE_TABLES, deal_structured_field_confirmations: [] });
  const input = await buildForm1919Input("deal-1", db as any);

  assert.equal(input.sectionI.has_confirmed_use_of_proceeds_categories, false);
  assert.equal(input.sectionI.debt_refinance_amount, null);
  assert.equal(input.sectionI.equipment_amount, null);
  assert.equal(input.sectionI.other_purpose_1_amount, null);
  // The pre-M7 field is completely unaffected.
  assert.equal(input.sectionI.use_of_proceeds_summary, "buying equipment");
});

test("an UNCONFIRMED classification row is ignored — same as having none at all", async () => {
  const db = fakeDb({
    ...BASE_TABLES,
    deal_structured_field_confirmations: [
      confirmationRow({
        confirmed: false,
        value: { categorized: [{ category: "equipment", amount: 250000, description: "buying equipment" }] },
      }),
    ],
  });
  const input = await buildForm1919Input("deal-1", db as any);

  assert.equal(input.sectionI.has_confirmed_use_of_proceeds_categories, false);
  assert.equal(input.sectionI.equipment_amount, null);
});

test("a CONFIRMED classification row populates the real per-category fields", async () => {
  const db = fakeDb({
    ...BASE_TABLES,
    deal_structured_field_confirmations: [
      confirmationRow({
        value: { categorized: [{ category: "equipment", amount: 250000, description: "buying equipment" }] },
      }),
    ],
  });
  const input = await buildForm1919Input("deal-1", db as any);

  assert.equal(input.sectionI.has_confirmed_use_of_proceeds_categories, true);
  assert.equal(input.sectionI.equipment_amount, 250000);
  assert.equal(input.sectionI.debt_refinance_amount, null);
});

test("a CONFIRMED multi-category classification splits amounts across the right fields, with residue in Other", async () => {
  const db = fakeDb({
    ...BASE_TABLES,
    deal_structured_field_confirmations: [
      confirmationRow({
        value: {
          categorized: [
            { category: "equipment", amount: 100000, description: "CNC machine" },
            { category: "working_capital", amount: 100000, description: "payroll runway" },
            { category: "other", amount: 50000, description: "misc" },
          ],
        },
      }),
    ],
  });
  const input = await buildForm1919Input("deal-1", db as any);

  assert.equal(input.sectionI.equipment_amount, 100000);
  assert.equal(input.sectionI.working_capital_amount, 100000);
  assert.equal(input.sectionI.other_purpose_1_amount, 50000);
  assert.equal(input.sectionI.other_purpose_1_description, "misc");
});
