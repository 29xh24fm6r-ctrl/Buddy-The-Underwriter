/**
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §4 — embed.ts unit tests.
 *
 * Same test-seam pattern as gateway.test.ts (__setEmbedImplForTests /
 * __setLogGatewayCallForEmbedTests / __resetEmbedTestOverrides /
 * __resetEmbedBudgetForTests) so NPI-refusal, budget, and ledger behavior
 * can be verified without a live OpenAI call or a live Supabase connection.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { LedgerEntry } from "../ledger";

mockServerOnly();
const require = createRequire(import.meta.url);
const {
  embedText,
  __setEmbedImplForTests,
  __setLogGatewayCallForEmbedTests,
  __resetEmbedTestOverrides,
  __resetEmbedBudgetForTests,
} = require("../embed") as typeof import("../embed");
const { __setVendorApprovalForTests, __resetVendorApprovalForTests } =
  require("../vendorApproval") as typeof import("../vendorApproval");

let ledgerEntries: LedgerEntry[];

beforeEach(() => {
  ledgerEntries = [];
  __setLogGatewayCallForEmbedTests(async (entry) => {
    ledgerEntries.push(entry);
  });
  delete process.env.AI_GATEWAY_BUDGET_EMBEDDER;
});

afterEach(() => {
  __resetEmbedTestOverrides();
  __resetEmbedBudgetForTests();
  __resetVendorApprovalForTests();
  delete process.env.AI_GATEWAY_BUDGET_EMBEDDER;
});

describe("embedText: happy path", () => {
  it("returns the vector and ledgers a success row with role=embedder", async () => {
    __setEmbedImplForTests(async () => ({ vector: [0.1, 0.2], tokensIn: 12 }));
    const result = await embedText({ text: "hello", purpose: "test" });
    assert.deepEqual(result.vector, [0.1, 0.2]);
    assert.equal(result.tokensIn, 12);
    assert.equal(ledgerEntries.length, 1);
    assert.equal(ledgerEntries[0].role, "embedder");
    assert.equal(ledgerEntries[0].provider, "openai");
    assert.equal(ledgerEntries[0].outcome, "success");
  });
});

describe("embedText: NPI-refusal gate", () => {
  it("refuses an npiTagged request before any provider call", async () => {
    let called = false;
    __setVendorApprovalForTests("openai", "PENDING");
    __setEmbedImplForTests(async () => {
      called = true;
      return { vector: [1], tokensIn: 1 };
    });

    await assert.rejects(
      () => embedText({ text: "hello", purpose: "test", npiTagged: true }),
      /NPI-tagged request refused/,
    );
    assert.equal(called, false);
    assert.equal(ledgerEntries.length, 1);
    assert.equal(ledgerEntries[0].outcome, "failure");
    assert.equal(ledgerEntries[0].npiTagged, true);
  });

  it("does not gate a non-NPI request", async () => {
    __setEmbedImplForTests(async () => ({ vector: [1], tokensIn: 1 }));
    const result = await embedText({ text: "hello", purpose: "test", npiTagged: false });
    assert.deepEqual(result.vector, [1]);
  });

  it("allows an npiTagged request once openai is APPROVED", async () => {
    __setVendorApprovalForTests("openai", "APPROVED");
    __setEmbedImplForTests(async () => ({ vector: [1], tokensIn: 1 }));
    const result = await embedText({ text: "hello", purpose: "test", npiTagged: true });
    assert.deepEqual(result.vector, [1]);
  });
});

describe("embedText: daily token budget hard stop", () => {
  it("blocks further calls once the embedder budget is exceeded", async () => {
    process.env.AI_GATEWAY_BUDGET_EMBEDDER = "10";
    __setEmbedImplForTests(async () => ({ vector: [1], tokensIn: 15 }));

    const first = await embedText({ text: "hello", purpose: "test" });
    assert.deepEqual(first.vector, [1]);

    await assert.rejects(
      () => embedText({ text: "hello", purpose: "test" }),
      /daily token budget exceeded/,
    );
  });
});

describe("embedText: failure path", () => {
  it("ledgers a failure row and rethrows when the provider call fails", async () => {
    __setEmbedImplForTests(async () => {
      throw new Error("embeddings API down");
    });
    await assert.rejects(
      () => embedText({ text: "hello", purpose: "test" }),
      /embeddings API down/,
    );
    assert.equal(ledgerEntries.length, 1);
    assert.equal(ledgerEntries[0].outcome, "failure");
    assert.match(ledgerEntries[0].errorMessage ?? "", /embeddings API down/);
  });
});
