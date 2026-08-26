import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../didit.ts", import.meta.url), "utf8");

test("Didit status reads use the supported v3 decision endpoint", () => {
  assert.match(
    source,
    /diditFetch\(\`\/session\/\$\{encodeURIComponent\(sessionId\)\}\/decision\/\`/,
    "canonical reads must call GET /v3/session/{sessionId}/decision/",
  );
  assert.match(
    source,
    /fetchDiditSession[\s\S]*return getDiditSessionDecision\(sessionId\)/,
    "the compatibility fetch function must delegate to the decision resource",
  );
  assert.doesNotMatch(
    source,
    /diditFetch\(\`\/session\/\$\{encodeURIComponent\(sessionId\)\}\/\`/,
    "the unsupported GET /v3/session/{sessionId}/ endpoint must never return",
  );
});
