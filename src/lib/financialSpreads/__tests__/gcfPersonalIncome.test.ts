import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  GCF_PERSONAL_INCOME_COMPONENT_KEYS,
  GCF_K1_EXCLUDED_KEYS,
  sumGcfPersonalIncome,
  type GcfPersonalIncomeFact,
} from "@/lib/financialSpreads/gcfPersonalIncome";

/**
 * SPEC-GCF-SOURCE-OF-TRUTH-AUDIT-AND-CONSOLIDATION-1
 * Invariant 6: GCF personal income must NOT double-count business pass-through
 * / K-1 income. Invariant 7 (partial): one shared component list is the single
 * model — the spread template and the persist path both reference it.
 */

function pf(over: Partial<GcfPersonalIncomeFact>): GcfPersonalIncomeFact {
  return {
    owner_type: "PERSONAL",
    owner_entity_id: "owner-1",
    fact_type: "PERSONAL_INCOME",
    fact_value_num: 0,
    fact_period_end: "2025-12-31",
    ...over,
  };
}

test("component list never overlaps the K-1 / AGI exclusion set", () => {
  for (const key of GCF_PERSONAL_INCOME_COMPONENT_KEYS) {
    assert.ok(
      !GCF_K1_EXCLUDED_KEYS.has(key),
      `${key} must not be a GCF personal-income component (it is K-1 / AGI)`,
    );
  }
  // The AGI aggregate that bundles K-1 is explicitly excluded.
  assert.ok(GCF_K1_EXCLUDED_KEYS.has("TOTAL_PERSONAL_INCOME"));
});

test("sumGcfPersonalIncome excludes K-1 pass-through income", () => {
  const facts: GcfPersonalIncomeFact[] = [
    pf({ fact_key: "WAGES_W2", fact_value_num: 120_000 }),
    pf({ fact_key: "K1_ORDINARY_INCOME", fact_value_num: 500_000 }),
    pf({ fact_key: "SCH_E_K1_NONPASSIVE_INCOME", fact_value_num: 250_000 }),
    pf({ fact_key: "TOTAL_PERSONAL_INCOME", fact_value_num: 870_000 }),
  ];
  const r = sumGcfPersonalIncome(facts);
  // Only WAGES_W2 counts — K-1 and the AGI aggregate are ignored.
  assert.equal(r.value, 120_000);
  assert.deepEqual(Object.keys(r.components), ["WAGES_W2"]);
});

test("prefers SCH_E_RENTAL_TOTAL over SCH_E_NET to avoid K-1 contamination", () => {
  const withRental = sumGcfPersonalIncome([
    pf({ fact_key: "WAGES_W2", fact_value_num: 100_000 }),
    pf({ fact_key: "SCH_E_RENTAL_TOTAL", fact_value_num: 40_000 }),
    pf({ fact_key: "SCH_E_NET", fact_value_num: 90_000 }), // bundles K-1 — must be ignored
  ]);
  assert.equal(withRental.value, 140_000); // 100k + 40k, NOT + 90k

  const withoutRental = sumGcfPersonalIncome([
    pf({ fact_key: "WAGES_W2", fact_value_num: 100_000 }),
    pf({ fact_key: "SCH_E_NET", fact_value_num: 30_000 }), // used only when no rental total
  ]);
  assert.equal(withoutRental.value, 130_000);
});

test("scopes to a single PERSONAL owner when ownerEntityId is given", () => {
  const facts: GcfPersonalIncomeFact[] = [
    pf({ owner_entity_id: "owner-1", fact_key: "WAGES_W2", fact_value_num: 100_000 }),
    pf({ owner_entity_id: "owner-2", fact_key: "WAGES_W2", fact_value_num: 80_000 }),
  ];
  assert.equal(sumGcfPersonalIncome(facts, { ownerEntityId: "owner-1" }).value, 100_000);
  // Deal-wide (no owner filter) sums both owners.
  assert.equal(sumGcfPersonalIncome(facts).value, 180_000);
});

test("returns null when no personal income components are present", () => {
  const r = sumGcfPersonalIncome([
    pf({ fact_key: "K1_ORDINARY_INCOME", fact_value_num: 500_000 }),
  ]);
  assert.equal(r.value, null);
});

test("both producers derive personal income from the shared component list", () => {
  const root = process.cwd();
  const template = fs.readFileSync(
    path.resolve(root, "src/lib/financialSpreads/templates/globalCashFlow.ts"),
    "utf8",
  );
  const persist = fs.readFileSync(
    path.resolve(root, "src/lib/financialIntelligence/persistGlobalCashFlow.ts"),
    "utf8",
  );
  assert.ok(
    /GCF_PERSONAL_INCOME_COMPONENT_KEYS/.test(template),
    "GCF template must use the shared component list",
  );
  assert.ok(
    /sumGcfPersonalIncome/.test(persist),
    "persistGlobalCashFlow must use the shared build-up, not TOTAL_PERSONAL_INCOME",
  );
  assert.ok(
    !/factKey:\s*"TOTAL_PERSONAL_INCOME"/.test(persist),
    "persistGlobalCashFlow must not read the AGI aggregate TOTAL_PERSONAL_INCOME",
  );
});
