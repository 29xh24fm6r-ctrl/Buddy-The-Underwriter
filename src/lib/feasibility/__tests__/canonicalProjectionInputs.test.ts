import { test } from "node:test";
import assert from "node:assert/strict";
import { readCanonicalDownsideCoverage, readCanonicalEquityInjectionPct, readCanonicalReserveMonths } from "@/lib/feasibility/canonicalProjectionInputs";

test("reads the canonical nested equity percentage emitted by the projection engine", () => {
  assert.equal(
    readCanonicalEquityInjectionPct({
      totalUses: 1_000_000,
      equityInjection: {
        actualAmount: 150_000,
        actualPct: 0.15,
        minimumPct: 0.1,
        passes: true,
      },
    }),
    0.15,
  );
});

test("does not recreate equity math when the canonical percentage is absent", () => {
  assert.equal(
    readCanonicalEquityInjectionPct({
      totalUses: 1_000_000,
      sources: [{ kind: "equity_injection", amount: 150_000 }],
    }),
    null,
  );
});

test("supports the legacy direct canonical field without accepting invalid ratios", () => {
  assert.equal(readCanonicalEquityInjectionPct({ equityInjectionPct: 0.2 }), 0.2);
  assert.equal(readCanonicalEquityInjectionPct({ equityInjectionPct: 20 }), null);
});

test("planned reserve coverage uses canonical costs, includes COGS and does not count equity twice", () => {
  const budget = { balanced: true, equityInjection: { actualAmount: 250000 }, uses: [
    { category: "equipment", amount: 200000 }, { category: "working_capital", amount: 90000 },
    { category: "working_capital", amount: 60000 },
  ] };
  assert.equal(readCanonicalReserveMonths(budget, [{ cogs: 300000, operatingExpenses: 300000 }]), 3);
  assert.equal(readCanonicalReserveMonths({ ...budget, uses: [{ category: "working_capital", amount: 0 }] }, [{ cogs: 300000, operatingExpenses: 300000 }]), 0);
});

test("missing, invalid and unreconciled reserve inputs remain unknown", () => {
  const budget = { balanced: true, uses: [{ category: "working_capital", amount: 150000 }] };
  const annual = [{ cogs: 300000, operatingExpenses: 300000 }];
  for (const b of [null, { ...budget, balanced: false }, { ...budget, uses: [] },
    ...[null, -1, Infinity, "150000"].map(amount => ({ ...budget, uses: [{ category: "working_capital", amount }] }))]) {
    assert.equal(readCanonicalReserveMonths(b, annual), null);
  }
  for (const a of [null, [], [{ cogs: null, operatingExpenses: 300000 }], [{ cogs: 0, operatingExpenses: 0 }], [{ cogs: 3, operatingExpenses: Infinity }]]) {
    assert.equal(readCanonicalReserveMonths(budget, a), null);
  }
  assert.equal(readCanonicalEquityInjectionPct({ equityInjection: { actualPct: null } }), null);
});

test("downside adapter preserves all three years from canonical and legacy saved scenarios", () => {
  assert.deepEqual(readCanonicalDownsideCoverage([{ name: "downside", dscrYear1: 1.44, dscrYear2: .77, dscrYear3: .14 }]), [1.44, .77, .14]);
  assert.deepEqual(readCanonicalDownsideCoverage([{ scenario: " Downside ", dscr_year1: "1.44", dscr_year2: "0.77", dscr_year3: "-0.14" }]), [1.44, .77, -.14]);
});
test("missing downside values do not inherit base-case coverage or become zero", () => {
  for (const input of [null, {}, [], [null, { name: "base", dscrYear1: 3, dscrYear2: 3, dscrYear3: 3 }]]) {
    assert.deepEqual(readCanonicalDownsideCoverage(input), [null, null, null]);
  }
  for (const value of [undefined, null, "", " ", NaN, Infinity, "NaN", true, {}]) {
    assert.deepEqual(readCanonicalDownsideCoverage([{ name: "downside", dscrYear1: 1.44, dscrYear2: value, dscrYear3: 0 }]), [1.44, null, 0]);
  }
});
