import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

let reviewCalls = 0;

require.cache[require.resolve("../gateway")] = {
  id: "gw-stub", filename: "gw-stub", loaded: true,
  exports: {
    runRole: async (_role: string, opts: { purpose?: string }) => {
      if ((opts.purpose ?? "").includes("repair")) {
        return { text: JSON.stringify({ sections: [{ key: "s1", text: "t" }] }) };
      }
      reviewCalls += 1;
      return { text: JSON.stringify({ issues: [] }) };
    },
  },
} as never;

const { reviewContentHash, finishInstitutionalArtifact } =
  require("../frontierArtifactFactory") as typeof import("../frontierArtifactFactory");

const IDENTITY = {
  artifactType: "feasibility" as const,
  facts: { dscr: 1.71, revenue: 2_753_880 },
  sections: [{ key: "market", text: "a" }, { key: "financial", text: "b" }],
};

test("identical content hashes identically", () => {
  assert.equal(reviewContentHash(IDENTITY), reviewContentHash({ ...IDENTITY }));
});

test("section order does not change the identity", () => {
  const reordered = { ...IDENTITY, sections: [...IDENTITY.sections].reverse() };
  assert.equal(reviewContentHash(IDENTITY), reviewContentHash(reordered));
});

test("changed prose changes the identity", () => {
  const edited = {
    ...IDENTITY,
    sections: [{ key: "market", text: "a" }, { key: "financial", text: "b (revised)" }],
  };
  assert.notEqual(reviewContentHash(IDENTITY), reviewContentHash(edited));
});

test("changed evidence changes the identity", () => {
  const restated = { ...IDENTITY, facts: { dscr: 1.71, revenue: 2_800_000 } };
  assert.notEqual(reviewContentHash(IDENTITY), reviewContentHash(restated));
});

test("a different artifact type is a different review", () => {
  assert.notEqual(
    reviewContentHash(IDENTITY),
    reviewContentHash({ ...IDENTITY, artifactType: "business_plan" }),
  );
});

test("the hash the lane returns is the hash of what it was given", async () => {
  reviewCalls = 0;
  const result = await finishInstitutionalArtifact({ ...IDENTITY, dealId: "deal-1" });

  assert.equal(result.contentHash, reviewContentHash(IDENTITY));
  assert.equal(reviewCalls, 1);
});

test("a stored pass on identical content is reusable; anything else is not", () => {
  // The condition both gates apply before spending a review.
  const stored = { verdict: "pass", hash: reviewContentHash(IDENTITY) };
  const reusable = (verdict: string, hash: string | null, about: typeof IDENTITY) =>
    verdict === "pass" && typeof hash === "string" && hash === reviewContentHash(about);

  assert.equal(reusable(stored.verdict, stored.hash, IDENTITY), true);
  // A previous block must be re-examined — the repair budget may land differently.
  assert.equal(reusable("flagged", stored.hash, IDENTITY), false);
  // An unbackfilled row has no hash and must never read as approved.
  assert.equal(reusable("pass", null, IDENTITY), false);
  // Content moved on.
  assert.equal(
    reusable(stored.verdict, stored.hash, { ...IDENTITY, facts: { dscr: 9, revenue: 1 } }),
    false,
  );
});
