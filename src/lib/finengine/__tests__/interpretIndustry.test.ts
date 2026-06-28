/**
 * SPEC-FINENGINE god-tier improvement B — industry-relative interpretation.
 *
 * interpret() rates a benchmarkable metric against revenue-tiered NAICS peer
 * percentiles when industry context is supplied, and is identical to the fixed
 * bands when it is not.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { interpret } from "@/lib/finengine/metrics/interpret";

const LAW = { naics: "541110", annualRevenue: 5_000_000 };   // peers ~55% gross margin
const AUTO = { naics: "441110", annualRevenue: 5_000_000 };  // peers ~16% gross margin

describe("industry-relative interpretation", () => {
  it("is backward-compatible: no industry context → fixed bands, no percentile", () => {
    const i = interpret({ metric: "GROSS_MARGIN", value: 0.4 });
    assert.equal(i.rating, "strong"); // fixed band strong = 0.40
    assert.equal(i.percentile, undefined);
  });

  it("the SAME 40% gross margin is weak for a law office and strong for an auto dealer", () => {
    const law = interpret({ metric: "GROSS_MARGIN", value: 0.4 }, { industry: LAW });
    const auto = interpret({ metric: "GROSS_MARGIN", value: 0.4 }, { industry: AUTO });
    assert.equal(law.rating, "weak");
    assert.equal(auto.rating, "strong");
    assert.ok(law.percentile != null && law.percentile < 50, `law percentile ${law.percentile}`);
    assert.ok(auto.percentile != null && auto.percentile > 50, `auto percentile ${auto.percentile}`);
    assert.match(law.benchmark!.label, /NAICS 541110/);
    assert.match(law.signal, /percentile vs NAICS 541110 peers/);
  });

  it("a non-benchmarkable metric falls back to fixed bands even with industry context", () => {
    const i = interpret({ metric: "EQUITY_MULTIPLIER", value: 1.2 }, { industry: LAW });
    assert.equal(i.percentile, undefined);
    assert.equal(i.rating, "strong"); // fixed-band lower-is-better, 1.2 <= 1.5
  });

  it("an unsupported NAICS leaves the fixed-band rating intact (graceful)", () => {
    const i = interpret({ metric: "GROSS_MARGIN", value: 0.4 }, { industry: { naics: "000000", annualRevenue: 5_000_000 } });
    assert.equal(i.rating, "strong");
    assert.equal(i.percentile, undefined);
  });

  it("the conservative policy floor is preserved: an industry overlay never upgrades past a policy breach", () => {
    // debt/equity 3.5 breaches the debt_to_equity_max cap (3.0) → demoted; industry must not rescue it.
    const i = interpret({ metric: "DEBT_TO_EQUITY", value: 3.5 }, { industry: AUTO });
    assert.ok(i.rating === "weak" || i.rating === "flag", `expected weak/flag, got ${i.rating}`);
    assert.ok(i.redFlags.some((f) => f.includes("debt_to_equity_max")));
  });
});
