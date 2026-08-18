import { test } from "node:test";
import assert from "node:assert/strict";
import { readCanonicalEquityInjectionPct } from "@/lib/feasibility/canonicalProjectionInputs";

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
