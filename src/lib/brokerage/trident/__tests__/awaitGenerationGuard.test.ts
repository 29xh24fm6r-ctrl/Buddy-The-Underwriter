import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Static guard: no request-scoped surface may generate a Trident bundle
 * inline.
 *
 * This guard used to assert the opposite — that `generateTridentBundle` was
 * always AWAITED — because fire-and-forget does not survive serverless
 * shutdown, and at the time awaiting was the only way to keep the function
 * alive to completion. The durable workflow removed that trade-off, and the
 * inline await became the larger risk: a preview run performs LLM generation,
 * an AI verifier pass, the feasibility engine and several PDF renders, and
 * exceeding the 300s ceiling left the bundle holding a 90-minute lease in
 * `running` that refused every retry until the janitor reconciled it.
 *
 * Every trigger surface now goes through startTridentGeneration, which admits
 * the run and hands it to the workflow. This file fails the build if any of
 * them reverts to generating in-request.
 */

const REPO_ROOT = resolve(process.cwd());

const TRIGGER_SURFACES = [
  "src/app/api/brokerage/concierge/route.ts",
  "src/app/api/brokerage/voice/[sessionId]/dispatch/route.ts",
  "src/app/api/brokerage/deals/[dealId]/trident/generate/route.ts",
  // marketplace/pick binds to the seal-time artifact set and generates
  // nothing at all (audit F-04/F-06); its own guard lives below.
];

for (const rel of TRIGGER_SURFACES) {
  test(`${rel}: hands generation to the durable workflow`, () => {
    const src = readFileSync(resolve(REPO_ROOT, rel), "utf8");

    assert.ok(
      src.includes("startTridentGeneration("),
      `${rel} must start the durable workflow via startTridentGeneration`,
    );
    assert.equal(
      /await\s+generateTridentBundle\s*\(/.test(src),
      false,
      `${rel} must not await inline generation — a reclaimed function strands the bundle lease`,
    );
    assert.equal(
      /generateTridentBundle\s*\([^)]*\)\s*\.catch\b/s.test(src),
      false,
      `${rel} must not fire-and-forget generation either`,
    );
    assert.equal(
      src.includes('from "@/lib/brokerage/trident/generateTridentBundle"'),
      false,
      `${rel} must not import the inline generator`,
    );
  });
}


/**
 * The inverse guard for the call site that was removed: the pick route must
 * never reintroduce inline generation. Sealing already certifies the final
 * bundle, and the seal route freezes its artifact paths onto the sealed
 * package, so generating here is both redundant and destructive to the
 * seal's provenance.
 */
test("marketplace/pick does not generate a trident bundle", () => {
  const src = readFileSync(
    resolve(REPO_ROOT, "src/app/api/brokerage/deals/[dealId]/marketplace/pick/route.ts"),
    "utf8",
  );
  assert.equal(
    /\bgenerateTridentBundle\s*\(/.test(src),
    false,
    "pick route must bind to the seal-time artifact set, not run the factory inline",
  );
  assert.equal(
    src.includes('from "@/lib/brokerage/trident/generateTridentBundle"'),
    false,
    "pick route must not import the generator",
  );
  assert.ok(
    src.includes("sealed_snapshot"),
    "pick route must read the immutable seal-time binding",
  );
});
