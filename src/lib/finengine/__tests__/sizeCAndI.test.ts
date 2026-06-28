/**
 * SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream C: C&I leverage sizing.
 *
 * Incremental capacity = most-restrictive of total-leverage, senior-leverage
 * (both net of existing debt), and DSCR cash-flow capacity. Over-levered floors
 * to 0 with a flag. Registry-driven (leverage_total_max, leverage_senior_max,
 * dscr_floor).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sizeCAndI } from "@/lib/finengine/sizing";

// EBITDA $2M, $1M funded / $0.5M senior existing, 0.15 constant.
const base = { ebitda: 2_000_000, existingFundedDebt: 1_000_000, existingSeniorDebt: 500_000, annualConstantRate: 0.15 };

describe("Workstream C — sizeCAndI", () => {
  it("binds on senior leverage when it is the tightest (3.0×$2M − $0.5M = $5.5M)", () => {
    const r = sizeCAndI(base);
    assert.equal(r.maxLoan, 5_500_000);
    assert.equal(r.bindingConstraint?.name, "SENIOR_LEVERAGE");
  });

  it("subtracts existing funded debt from total-leverage capacity (4.5×$2M − $1M = $8M)", () => {
    const r = sizeCAndI(base);
    const total = r.constraints.find((c) => c.name === "TOTAL_LEVERAGE");
    assert.equal(total?.maxLoan, 8_000_000);
  });

  it("binds on DSCR cash-flow capacity when the constant is high", () => {
    // $2M / 1.2 / 0.40 = $4.17M < $5.5M senior.
    const r = sizeCAndI({ ...base, annualConstantRate: 0.4 });
    assert.equal(r.bindingConstraint?.name, "DSCR");
    assert.equal(Math.round(r.maxLoan!), 4_166_667);
  });

  it("floors negative leverage headroom to 0 and flags over-levered", () => {
    // existing funded debt $10M > 4.5×$2M = $9M cap → no incremental total capacity.
    const r = sizeCAndI({ ...base, existingFundedDebt: 10_000_000 });
    assert.equal(r.maxLoan, 0);
    assert.equal(r.bindingConstraint?.name, "TOTAL_LEVERAGE");
    assert.match(r.bindingConstraint!.note, /already over total-leverage cap/);
  });

  it("is null-safe when EBITDA is absent", () => {
    const r = sizeCAndI({ ebitda: 0, existingFundedDebt: 0, existingSeniorDebt: 0, annualConstantRate: 0.15 });
    assert.equal(r.maxLoan, null);
    assert.equal(r.bindingConstraint, null);
  });

  it("honors tenant overrides on the leverage caps (registry, not hardcoded)", () => {
    // total cap raised to 5.0×; senior still 3.0× binds at $5.5M.
    const r = sizeCAndI({ ...base, ctx: { overrides: { leverage_total_max: 5.0 } } });
    const total = r.constraints.find((c) => c.name === "TOTAL_LEVERAGE");
    assert.equal(total?.maxLoan, 9_000_000); // 5.0×$2M − $1M
    assert.equal(r.bindingConstraint?.name, "SENIOR_LEVERAGE"); // senior still tightest
  });
});
