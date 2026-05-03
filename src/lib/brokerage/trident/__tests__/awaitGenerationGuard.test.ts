import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Static guard: `generateTridentBundle` MUST be awaited at every call
 * site outside of the generator itself. Fire-and-forget does not survive
 * serverless function shutdown on Vercel — the function instance can be
 * reclaimed before the bundle row transitions to succeeded|failed,
 * leaving rows stuck in `running` indefinitely.
 *
 * This test parses the call sites by source-text and fails the build if
 * a `.catch(` discard pattern reappears or the `await` is dropped.
 */

const REPO_ROOT = resolve(process.cwd());

const CALL_SITES = [
  "src/app/api/brokerage/concierge/route.ts",
  "src/app/api/brokerage/voice/[sessionId]/dispatch/route.ts",
];

for (const rel of CALL_SITES) {
  test(`${rel}: generateTridentBundle is awaited (not fire-and-forget)`, () => {
    const src = readFileSync(resolve(REPO_ROOT, rel), "utf8");

    assert.ok(
      src.includes("generateTridentBundle("),
      `${rel} no longer references generateTridentBundle — wiring removed?`,
    );

    // Ban the fire-and-forget chain: `generateTridentBundle({...}).catch(`.
    // Match across whitespace + newlines.
    const fireAndForget = /generateTridentBundle\s*\([^)]*\)\s*\.catch\b/s;
    assert.equal(
      fireAndForget.test(src),
      false,
      `${rel} still has a .catch() chain on generateTridentBundle — must be awaited so bundle-row lifecycle (running → succeeded|failed) completes before the response returns.`,
    );

    // Require an explicit `await` immediately preceding a call site.
    const awaited = /await\s+generateTridentBundle\s*\(/;
    assert.equal(
      awaited.test(src),
      true,
      `${rel} must await generateTridentBundle so generation_completed_at + status are set before the response.`,
    );
  });
}

test("concierge maxDuration accommodates synchronous trident generation", () => {
  const src = readFileSync(
    resolve(REPO_ROOT, "src/app/api/brokerage/concierge/route.ts"),
    "utf8",
  );
  const m = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  assert.ok(m, "concierge route is missing maxDuration export");
  const seconds = Number(m![1]);
  assert.ok(
    seconds >= 300,
    `concierge maxDuration is ${seconds}s — must be ≥300 to allow awaited trident generation`,
  );
});

test("voice dispatch maxDuration accommodates synchronous trident generation", () => {
  const src = readFileSync(
    resolve(
      REPO_ROOT,
      "src/app/api/brokerage/voice/[sessionId]/dispatch/route.ts",
    ),
    "utf8",
  );
  const m = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  assert.ok(m, "voice dispatch is missing maxDuration export");
  const seconds = Number(m![1]);
  assert.ok(
    seconds >= 300,
    `voice dispatch maxDuration is ${seconds}s — must be ≥300 to allow awaited trident generation`,
  );
});
