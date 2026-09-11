import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

require.cache[require.resolve("server-only")] = {
  id: require.resolve("server-only"),
  filename: require.resolve("server-only"),
  loaded: true,
  exports: {},
  children: [],
  paths: [],
} as unknown as NodeModule;

const {
  __resetGatewayTestOverrides,
  __setLogGatewayCallForTests,
  __setProviderImplForTests,
} = require("@/lib/ai/gateway") as typeof import("@/lib/ai/gateway");
const { rerankChunks } = require("../committee") as typeof import("../committee");

afterEach(() => __resetGatewayTestOverrides());

test("committee reranking is attributed and ledgered at the provider boundary", async () => {
  const ledger: Array<Record<string, unknown>> = [];
  __setProviderImplForTests("openai", async () => ({
    text: JSON.stringify({ selected_chunk_ids: ["chunk-1"] }),
    tokensIn: 21,
    tokensOut: 7,
  }));
  __setLogGatewayCallForTests(async (entry) => {
    ledger.push(entry as unknown as Record<string, unknown>);
    return true;
  });

  const result = await rerankChunks("What supports repayment?", [{
    chunk_id: "chunk-1",
    content: "Cash flow supports repayment.",
    similarity: 0.9,
    upload_id: "upload-1",
    page_start: 1,
    page_end: 1,
  }], "00000000-0000-0000-0000-000000000001");

  assert.deepEqual(result.selected_chunk_ids, ["chunk-1"]);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].purpose, "committee_rerank");
  assert.equal(ledger[0].provider, "openai");
  assert.equal(ledger[0].dealId, "00000000-0000-0000-0000-000000000001");
  assert.equal(ledger[0].npiTagged, true);
  assert.equal(ledger[0].tokensIn, 21);
  assert.equal(ledger[0].tokensOut, 7);
});
