import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { getLatestIndexRates, __resetIndexRatesCacheForTests } =
  require("../indexRates") as typeof import("../indexRates");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../ai/gateway") as typeof import("../../ai/gateway");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

const VALID_JSON = JSON.stringify({
  SOFR: { rate: 5.31, asOf: "2026-07-29" },
  UST_5Y: { rate: 4.12, asOf: "2026-07-29" },
  PRIME: { rate: 7.5, asOf: "2026-07-29" },
});

beforeEach(() => {
  __resetIndexRatesCacheForTests();
  __setProviderImplForTests("openai", async () => {
    throw new Error("openai fallback not configured in this test");
  });
});

after(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

test("happy path: threads useSearchGrounding through and parses all three rates", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req: any) => {
    captured = req;
    return okResult(VALID_JSON);
  });

  const rates = await getLatestIndexRates();

  assert.equal(captured.useSearchGrounding, true);
  assert.equal(rates.SOFR.ratePct, 5.31);
  assert.equal(rates.UST_5Y.ratePct, 4.12);
  assert.equal(rates.PRIME.ratePct, 7.5);
  assert.equal(rates.SOFR.source, "nyfed");
});

test("strips markdown JSON fences before parsing", async () => {
  __setProviderImplForTests("google", async () => okResult("```json\n" + VALID_JSON + "\n```"));
  const rates = await getLatestIndexRates();
  assert.equal(rates.PRIME.ratePct, 7.5);
});

test("gateway failure (both chain steps down): rejects, does not throw a swallowed error", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error("HTTP 500: boom");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("HTTP 500: boom (openai fallback also down)");
  });
  await assert.rejects(() => getLatestIndexRates(), /HTTP 500/);
});
