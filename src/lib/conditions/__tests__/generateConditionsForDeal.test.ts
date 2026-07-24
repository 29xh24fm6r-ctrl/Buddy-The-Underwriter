import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

let generateMitigantConditionsForDeal: typeof import("../generateMitigantConditions").generateMitigantConditionsForDeal;
let generateRuleConditionsForDeal: typeof import("../generateRuleConditions").generateRuleConditionsForDeal;
let generateConditionsForDeal: typeof import("../generateConditionsForDeal").generateConditionsForDeal;

before(async () => {
  mockServerOnly();
  ({ generateMitigantConditionsForDeal } = await import("../generateMitigantConditions"));
  ({ generateRuleConditionsForDeal } = await import("../generateRuleConditions"));
  ({ generateConditionsForDeal } = await import("../generateConditionsForDeal"));
});

function makeFakeSb(tables: Record<string, any[]> = {}) {
  const state: Record<string, any[]> = { ...tables };

  function table(name: string) {
    if (!state[name]) state[name] = [];
    const filters: Array<(row: any) => boolean> = [];
    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      maybeSingle: async () => {
        const rows = state[name].filter((r) => filters.every((f) => f(r)));
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: any) {
        const rows = state[name].filter((r) => filters.every((f) => f(r)));
        resolve({ data: rows, error: null });
      },
      insert(rows: any) {
        const arr = Array.isArray(rows) ? rows : [rows];
        const inserted = arr.map((r, i) => ({ id: `${name}-${state[name].length + i}`, ...r }));
        state[name].push(...inserted);
        return {
          select() {
            return {
              maybeSingle: async () => ({ data: inserted[0] ?? null, error: null }),
            };
          },
        };
      },
      update(patch: any) {
        const updateFilters: Array<(row: any) => boolean> = [];
        const updateBuilder: any = {
          eq(col: string, val: unknown) {
            updateFilters.push((row) => row[col] === val);
            return updateBuilder;
          },
          then(resolve: any) {
            state[name] = state[name].map((r) => (updateFilters.every((f) => f(r)) ? { ...r, ...patch } : r));
            resolve({ error: null });
          },
        };
        return updateBuilder;
      },
    };
    return builder;
  }

  return { client: { from: table }, state };
}

test("generateMitigantConditionsForDeal: no open mitigants -> zero created", async () => {
  const { client } = makeFakeSb({ deal_mitigants: [] });
  const result = await generateMitigantConditionsForDeal("deal-1", "bank-1", { sb: client as any });
  assert.equal(result.created.length, 0);
  assert.equal(result.open_mitigants, 0);
});

test("generateMitigantConditionsForDeal: open mitigant -> creates a policy-source condition", async () => {
  const { client, state } = makeFakeSb({
    deal_mitigants: [{ deal_id: "deal-1", mitigant_key: "add_collateral", mitigant_label: "Add collateral", status: "open" }],
  });
  const result = await generateMitigantConditionsForDeal("deal-1", "bank-1", { sb: client as any });

  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].mitigant_key, "add_collateral");
  assert.equal(state.deal_conditions[0].source, "policy");
  assert.equal(state.deal_conditions[0].source_key, "add_collateral");
});

test("generateMitigantConditionsForDeal: already-existing condition -> skipped, not duplicated", async () => {
  const { client } = makeFakeSb({
    deal_mitigants: [{ deal_id: "deal-1", mitigant_key: "add_collateral", mitigant_label: "Add collateral", status: "open" }],
    deal_conditions: [{ id: "existing-1", deal_id: "deal-1", source: "policy", source_key: "add_collateral" }],
  });
  const result = await generateMitigantConditionsForDeal("deal-1", "bank-1", { sb: client as any });

  assert.equal(result.created.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "already_exists");
});

test("generateRuleConditionsForDeal: no documents on file -> all applicable rules open", async () => {
  const { client, state } = makeFakeSb({
    deals: [{ id: "deal-1", deal_type: "sba_7a_standard" }],
  });
  const result = await generateRuleConditionsForDeal("deal-1", "bank-1", { sb: client as any });

  // PFS, tax returns, SBA forms all missing (no RE collateral -> rent roll rule not applicable)
  const codes = state.deal_conditions.map((c: any) => c.source_key);
  assert.ok(codes.includes("COND_MISSING_PFS"));
  assert.ok(codes.includes("COND_MISSING_TAX_RETURNS"));
  assert.ok(codes.includes("COND_SBA_FORMS"));
  assert.ok(!codes.includes("COND_MISSING_RENT_ROLL"));
  assert.equal(result.created.length, 3);
});

test("generateRuleConditionsForDeal: all docs present -> no conditions created, rules satisfied", async () => {
  const { client, state } = makeFakeSb({
    deals: [{ id: "deal-1", deal_type: "conventional" }],
    deal_documents: [
      { deal_id: "deal-1", canonical_type: "PFS", doc_year: null },
      { deal_id: "deal-1", canonical_type: "BUSINESS_TAX_RETURN", doc_year: 2024 },
      { deal_id: "deal-1", canonical_type: "BUSINESS_TAX_RETURN", doc_year: 2023 },
      { deal_id: "deal-1", canonical_type: "PERSONAL_TAX_RETURN", doc_year: 2024 },
    ],
  });
  const result = await generateRuleConditionsForDeal("deal-1", "bank-1", { sb: client as any });

  // Non-SBA deal -> SBA_FORMS rule not applicable; PFS/tax-return keys satisfied
  assert.equal(result.created.length, 0);
  assert.equal((state.deal_conditions ?? []).length, 0);
  assert.ok(result.satisfied_count > 0);
});

test("generateRuleConditionsForDeal: real estate collateral + missing rent roll -> rule fires", async () => {
  const { client, state } = makeFakeSb({
    deals: [{ id: "deal-1", deal_type: "conventional" }],
    deal_collateral_items: [{ deal_id: "deal-1", item_type: "real_estate" }],
    deal_documents: [
      { deal_id: "deal-1", canonical_type: "PFS", doc_year: null },
      { deal_id: "deal-1", canonical_type: "BUSINESS_TAX_RETURN", doc_year: 2024 },
      { deal_id: "deal-1", canonical_type: "BUSINESS_TAX_RETURN", doc_year: 2023 },
      { deal_id: "deal-1", canonical_type: "PERSONAL_TAX_RETURN", doc_year: 2024 },
    ],
  });
  const result = await generateRuleConditionsForDeal("deal-1", "bank-1", { sb: client as any });

  const codes = state.deal_conditions.map((c: any) => c.source_key);
  assert.ok(codes.includes("COND_MISSING_RENT_ROLL"));
  assert.equal(result.created.length, 1);
});

test("generateRuleConditionsForDeal: rerun is idempotent -> no duplicate rows", async () => {
  const { client, state } = makeFakeSb({
    deals: [{ id: "deal-1", deal_type: "sba_7a_standard" }],
  });
  await generateRuleConditionsForDeal("deal-1", "bank-1", { sb: client as any });
  const firstCount = state.deal_conditions.length;
  const second = await generateRuleConditionsForDeal("deal-1", "bank-1", { sb: client as any });

  assert.equal(state.deal_conditions.length, firstCount);
  assert.equal(second.created.length, 0);
  assert.ok(second.skipped.length > 0);
});

test("generateConditionsForDeal: unifies both generators with a combined count", async () => {
  const { client } = makeFakeSb({
    deals: [{ id: "deal-1", deal_type: "sba_7a_standard" }],
    deal_mitigants: [{ deal_id: "deal-1", mitigant_key: "stronger_guarantor", mitigant_label: "Guarantor", status: "open" }],
  });
  const result = await generateConditionsForDeal("deal-1", "bank-1", { sb: client as any });

  assert.equal(result.from_mitigants, 1);
  assert.ok(result.from_rules > 0);
  assert.equal(result.total_created, result.from_mitigants + result.from_rules);
});
