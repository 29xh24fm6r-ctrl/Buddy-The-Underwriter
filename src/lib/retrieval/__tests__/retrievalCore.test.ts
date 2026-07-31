import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// retrievalCore.ts doesn't import "server-only" itself, but it now
// transitively pulls it in via @/lib/ai/embed.ts and @/lib/ai/gateway.ts —
// same CJS-resolver-patch + require() pattern as every other test that
// loads gateway-touching code.
mockServerOnly();
const require = createRequire(import.meta.url);

const { __rerankChunksForTests } =
  require("../retrievalCore") as { __rerankChunksForTests: any };
const {
  __setEmbedImplForTests,
  __resetEmbedTestOverrides,
  __resetEmbedBudgetForTests,
} = require("../../ai/embed") as typeof import("../../ai/embed");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../ai/gateway") as typeof import("../../ai/gateway");
const { __setVendorApprovalForTests, __resetVendorApprovalForTests } =
  require("../../ai/vendorApproval") as typeof import("../../ai/vendorApproval");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

beforeEach(() => {
  __setProviderImplForTests("anthropic", async () => {
    throw new Error("anthropic not configured in this test");
  });
  // rerankChunks is npiTagged (audit fix: deal_doc_chunks is real borrower
  // document content) — approve openai here so these tests exercise the
  // rerank logic itself rather than the NPI-refusal gate.
  __setVendorApprovalForTests("openai", "APPROVED");
});

after(() => {
  __resetEmbedTestOverrides();
  __resetEmbedBudgetForTests();
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
  __resetVendorApprovalForTests();
});

test("__rerankChunksForTests: scores via the gateway's structurer role and sorts by score desc", async () => {
  let captured: any = null;
  __setProviderImplForTests("openai", async (req: any) => {
    captured = req;
    return okResult("[3, 9, 1]");
  });

  const chunks = [
    { content: "chunk A", source: { id: "a" } },
    { content: "chunk B", source: { id: "b" } },
    { content: "chunk C", source: { id: "c" } },
  ];
  const ranked = await __rerankChunksForTests("what is relevant?", chunks, 2);

  assert.equal(captured.model, "gpt-4o-mini");
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].source.id, "b");
  assert.equal(ranked[0].score, 9);
  assert.equal(ranked[1].source.id, "a");
});

test("__rerankChunksForTests: falls back to the first N chunks on gateway failure", async () => {
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom");
  });

  const chunks = [
    { content: "chunk A", source: { id: "a" } },
    { content: "chunk B", source: { id: "b" } },
    { content: "chunk C", source: { id: "c" } },
  ];
  const ranked = await __rerankChunksForTests("q", chunks, 2);

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].source.id, "a");
  assert.equal(ranked[1].source.id, "b");
});

test("__rerankChunksForTests: returns all chunks unranked when count <= topN (no gateway call)", async () => {
  let called = false;
  __setProviderImplForTests("openai", async () => {
    called = true;
    return okResult("[]");
  });

  const chunks = [{ content: "chunk A", source: { id: "a" } }];
  const ranked = await __rerankChunksForTests("q", chunks, 5);

  assert.equal(called, false);
  assert.equal(ranked.length, 1);
});
