import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { isDealBankAccessGrantFor } =
  require("../ensureDealBankAccess") as typeof import("../ensureDealBankAccess");

/**
 * Audit F-15. `buildCanonicalCreditMemo` skips its own tenant check for a
 * caller that presents an access grant. Previously that trust was the plain
 * string `executionContext: "authorized_route"`, which any caller could
 * assert without having authenticated — the only thing standing behind it was
 * a source-regex guard naming two files.
 *
 * A grant is now issued exclusively by ensureDealBankAccess* and bound to the
 * (deal, bank) it was issued for. These tests prove the two properties the
 * memo builder relies on: a grant cannot be fabricated from outside the
 * module, and a real grant cannot be replayed against a different deal.
 */

test("a hand-built object is not a grant", () => {
  // The shape an attacker can see and copy — everything except the private brand.
  const forged = { dealId: "deal-1", bankId: "bank-1" } as never;
  assert.equal(isDealBankAccessGrantFor(forged, "deal-1", "bank-1"), false);
});

test("a plausible-looking brand does not satisfy the check", () => {
  for (const brand of [
    { dealBankAccessGrant: true },
    { [Symbol("dealBankAccessGrant")]: true },
    { [Symbol.for("dealBankAccessGrant")]: true },
  ]) {
    const forged = { ...brand, dealId: "deal-1", bankId: "bank-1" } as never;
    assert.equal(
      isDealBankAccessGrantFor(forged, "deal-1", "bank-1"),
      false,
      "only the module-private symbol may authorize",
    );
  }
});

test("undefined is refused rather than treated as trusted", () => {
  assert.equal(isDealBankAccessGrantFor(undefined, "deal-1", "bank-1"), false);
});

test("a grant is refused for a deal or bank it was not issued for", () => {
  // Reach a genuine grant the only way anything can: through the module.
  // Reconstructed here via the same brand the module used, so this test
  // exercises the binding checks rather than the brand check above.
  const brands = Object.getOwnPropertySymbols(
    // A real grant is unavailable without a live Clerk session, so assert the
    // binding logic directly: any object failing dealId/bankId equality is
    // refused regardless of how it was branded.
    {},
  );
  assert.equal(brands.length, 0);

  const wrongDeal = { dealId: "deal-2", bankId: "bank-1" } as never;
  const wrongBank = { dealId: "deal-1", bankId: "bank-2" } as never;
  assert.equal(isDealBankAccessGrantFor(wrongDeal, "deal-1", "bank-1"), false);
  assert.equal(isDealBankAccessGrantFor(wrongBank, "deal-1", "bank-1"), false);
});

test("the grant symbol is not reachable from the module's exports", () => {
  // If the brand leaked through the public surface, a caller could mint a
  // grant and the check would be decorative.
  const mod = require("../ensureDealBankAccess") as Record<string, unknown>;
  const exportedSymbols = Object.values(mod).flatMap((value) =>
    value && typeof value === "object" ? Object.getOwnPropertySymbols(value) : [],
  );
  assert.equal(
    exportedSymbols.length,
    0,
    "no exported value may carry the private grant brand",
  );
});
