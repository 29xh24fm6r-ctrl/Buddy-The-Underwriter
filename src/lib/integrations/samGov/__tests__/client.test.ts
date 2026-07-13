import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

// client.ts has `import "server-only"` — same require()-after-patch pattern
// as geminiClient.test.ts.
mockServerOnly();
const require = createRequire(import.meta.url);
const { fetchSamExclusions } = require("../client") as typeof import("../client");

type FetchImpl = (input: any, init?: any) => Promise<Response>;

function installFetch(impl: FetchImpl): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("fetchSamExclusions: match found -> returns exclusion records", async () => {
  const restore = installFetch(async () =>
    new Response(
      JSON.stringify({
        totalRecords: 1,
        exclusionDetails: [{ classificationCode: "Firm", exclusionProgram: "Debarment", samNumber: "SAM123" }],
      }),
      { status: 200 },
    ),
  );
  try {
    const result = await fetchSamExclusions({ name: "Excluded Corp", ein: "12-3456789" });
    assert.equal(result.length, 1);
    assert.equal(result[0].samNumber, "SAM123");
  } finally {
    restore();
  }
});

test("fetchSamExclusions: no match -> returns empty array", async () => {
  const restore = installFetch(async () => new Response(JSON.stringify({ totalRecords: 0, exclusionDetails: [] }), { status: 200 }));
  try {
    const result = await fetchSamExclusions({ name: "Clean Business LLC" });
    assert.deepEqual(result, []);
  } finally {
    restore();
  }
});

test("fetchSamExclusions: rate-limited (429) -> throws a clear error, not a silent empty result", async () => {
  const restore = installFetch(async () => new Response("Too Many Requests", { status: 429 }));
  try {
    await assert.rejects(() => fetchSamExclusions({ name: "Some Business" }), /rate-limited/i);
  } finally {
    restore();
  }
});
