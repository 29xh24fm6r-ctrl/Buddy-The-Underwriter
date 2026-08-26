import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

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
 * exceeding the request ceiling left the bundle holding a 90-minute lease in
 * `running` that refused every retry until the janitor reconciled it.
 *
 * It then listed the three surfaces it knew about. That is why it kept
 * passing while three OTHER request-scoped surfaces went on generating
 * inline — the borrower portal's preview route, the cookie-scoped preview
 * route, and the assumptions-confirm trigger, the last with a 120s ceiling
 * far below what a preview run needs (audit F-17/F-18).
 *
 * A hand-maintained list cannot fail for the thing it exists to catch. This
 * guard now DISCOVERS every module under src/app that imports the inline
 * generator and requires that set to be empty. Adding a new route cannot
 * escape it, and neither can renaming an existing one.
 */

const REPO_ROOT = resolve(process.cwd());
const APP_DIR = resolve(REPO_ROOT, "src/app");
const GENERATOR_MODULE = "lib/brokerage/trident/generateTridentBundle";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // Build output, not source. `.well-known/workflow` is emitted by the
    // Workflow DevKit and legitimately bundles the generator for the step
    // runner — that IS the durable executor, not a request surface.
    if (entry === "node_modules" || entry === ".well-known") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(full) && !full.includes("__tests__")) out.push(full);
  }
  return out;
}

/**
 * Matches a real import/re-export of the generator module, in any of the
 * forms TypeScript accepts. Deliberately NOT a substring search: prose in a
 * route's header comment that names the generator is documentation, not a
 * call, and a guard that trips on its own explanation gets deleted.
 */
function importsInlineGenerator(source: string): boolean {
  const specifier = String.raw`["'](?:@/|\.{1,2}/[^"']*?)${GENERATOR_MODULE.replace(/\//g, String.raw`\/`)}["']`;
  return (
    new RegExp(String.raw`\bfrom\s+${specifier}`).test(source) ||
    new RegExp(String.raw`\brequire\(\s*${specifier}`).test(source) ||
    new RegExp(String.raw`\bimport\(\s*${specifier}`).test(source)
  );
}

test("[F-18] no route under src/app imports the inline Trident generator", () => {
  const offenders = walk(APP_DIR)
    .filter((file) => importsInlineGenerator(readFileSync(file, "utf8")))
    .map((file) => relative(REPO_ROOT, file).split(sep).join("/"));

  assert.deepEqual(
    offenders,
    [],
    "request-scoped surfaces must admit runs via startTridentGeneration and let the " +
      "durable workflow execute them; a reclaimed function strands the bundle lease " +
      `for 90 minutes. Offending file(s): ${offenders.join(", ")}`,
  );
});

test("[F-18] the guard can actually detect an offender", () => {
  // A guard that scans a directory is only as good as its matcher. Prove the
  // matcher fires, so an empty result above means "none" and not "never
  // matched anything".
  for (const form of [
    `import { generateTridentBundle } from "@/${GENERATOR_MODULE}";`,
    `import x from "../../../${GENERATOR_MODULE}";`,
    `const m = require("@/${GENERATOR_MODULE}");`,
    `await import("@/${GENERATOR_MODULE}");`,
    `export { generateTridentBundle } from "@/${GENERATOR_MODULE}";`,
  ]) {
    assert.ok(importsInlineGenerator(form), `matcher missed: ${form}`);
  }
  // Prose naming the generator is not an import.
  assert.equal(
    importsInlineGenerator("// this route used to await generateTridentBundle() inline"),
    false,
  );
  assert.equal(importsInlineGenerator('import { startTridentGeneration } from "@/lib/brokerage/trident/startTridentGeneration";'), false);
});

test("[F-18] the discovery walk actually reaches the route tree", () => {
  // Guards against a silently-empty scan (bad path, over-eager skip list).
  const files = walk(APP_DIR);
  assert.ok(files.length > 200, `expected the app tree, walked ${files.length} files`);
  assert.ok(
    files.some((f) => f.endsWith("/trident/preview/route.ts")),
    "the preview routes must be inside the scanned set",
  );
});

/**
 * Every trigger surface routes through the shared admission helper. Kept as
 * an explicit list because this asserts presence, not absence — a missing
 * entry here cannot hide an inline generator, which the discovery guard
 * above owns.
 */
const TRIGGER_SURFACES = [
  "src/app/api/brokerage/concierge/route.ts",
  "src/app/api/brokerage/voice/[sessionId]/dispatch/route.ts",
  "src/app/api/brokerage/deals/[dealId]/trident/generate/route.ts",
  "src/app/api/brokerage/deals/[dealId]/trident/preview/route.ts",
  "src/app/api/portal/[token]/trident/preview/route.ts",
  "src/app/api/borrower/portal/[token]/sba-assumptions/route.ts",
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
  assert.ok(
    src.includes("sealed_snapshot"),
    "pick route must read the immutable seal-time binding",
  );
});
