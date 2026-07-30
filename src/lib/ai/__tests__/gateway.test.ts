/**
 * SPEC-M1 AI-GATEWAY-1 — gateway.ts unit tests.
 *
 * Uses the test-only seams exported by gateway.ts
 * (__setProviderImplForTests / __setLogGatewayCallForTests /
 * __resetGatewayTestOverrides / __resetGatewayBudgetForTests) so failover,
 * NPI-refusal, and budget behavior can be verified without live network
 * calls or a live Supabase connection — same escape-hatch pattern as
 * OpenAICircuitBreaker._reset() in openaiResilience.ts.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { LedgerEntry } from "../ledger";
import type { ProviderCallResult } from "../providers/types";

// gateway.ts (transitively) has `import "server-only"` — patch the CJS
// resolver before requiring it, same pattern as geminiClient.test.ts.
mockServerOnly();
const require = createRequire(import.meta.url);
const {
  runRole,
  runRoleStream,
  __setProviderImplForTests,
  __setLogGatewayCallForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../gateway") as typeof import("../gateway");

let ledgerEntries: LedgerEntry[];

beforeEach(() => {
  ledgerEntries = [];
  __setLogGatewayCallForTests(async (entry) => {
    ledgerEntries.push(entry);
  });
  delete process.env.AI_GATEWAY_BUDGET_GENERATOR;
  delete process.env.AI_GATEWAY_CHAIN_GENERATOR;
});

afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
  delete process.env.AI_GATEWAY_BUDGET_GENERATOR;
  delete process.env.AI_GATEWAY_CHAIN_GENERATOR;
});

function okResult(text: string): ProviderCallResult {
  return { text, tokensIn: 10, tokensOut: 20 };
}

describe("runRole: role resolution + failover", () => {
  it("uses the primary provider when it succeeds", async () => {
    __setProviderImplForTests("google", async () => okResult("hello from google"));
    __setProviderImplForTests("openai", async () => {
      throw new Error("should not be called");
    });

    const result = await runRole("generator", { prompt: "hi", purpose: "test" });

    assert.equal(result.provider, "google");
    assert.equal(result.text, "hello from google");
    assert.equal(result.attempts, 1);
    assert.equal(ledgerEntries.length, 1);
    assert.equal(ledgerEntries[0].outcome, "success");
    assert.equal(ledgerEntries[0].provider, "google");
  });

  it("advances the chain on a 500-style failure and both attempts are ledgered", async () => {
    __setProviderImplForTests("google", async () => {
      throw new Error("HTTP 500: internal error");
    });
    __setProviderImplForTests("openai", async () => okResult("recovered via openai"));

    const result = await runRole("generator", { prompt: "hi", purpose: "test" });

    assert.equal(result.provider, "openai");
    assert.equal(result.text, "recovered via openai");
    assert.equal(result.attempts, 2);

    assert.equal(ledgerEntries.length, 2);
    assert.equal(ledgerEntries[0].provider, "google");
    assert.equal(ledgerEntries[0].outcome, "failure");
    assert.match(ledgerEntries[0].errorMessage ?? "", /HTTP 500/);
    assert.equal(ledgerEntries[1].provider, "openai");
    assert.equal(ledgerEntries[1].outcome, "success");
  });

  it("throws the last error when every chain step fails, all attempts ledgered", async () => {
    __setProviderImplForTests("google", async () => {
      throw new Error("google down");
    });
    __setProviderImplForTests("openai", async () => {
      throw new Error("openai down too");
    });

    await assert.rejects(
      () => runRole("generator", { prompt: "hi", purpose: "test" }),
      /openai down too/,
    );
    assert.equal(ledgerEntries.length, 2);
    assert.ok(ledgerEntries.every((e) => e.outcome === "failure"));
  });
});

describe("runRole: NPI-refusal gate", () => {
  it("refuses an npiTagged request to a PENDING provider before any network call", async () => {
    let called = false;
    __setProviderImplForTests("anthropic", async () => {
      called = true;
      return okResult("should never happen");
    });

    await assert.rejects(
      () => runRole("verifier", { prompt: "hi", purpose: "test", npiTagged: true }),
      /NPI-tagged request refused/,
    );
    assert.equal(called, false, "provider must never be invoked for a refused NPI request");
    assert.equal(ledgerEntries.length, 1);
    assert.equal(ledgerEntries[0].outcome, "failure");
    assert.equal(ledgerEntries[0].npiTagged, true);
    assert.match(ledgerEntries[0].errorMessage ?? "", /not APPROVED/);
  });

  it("does not gate a non-NPI request to the same PENDING provider", async () => {
    __setProviderImplForTests("anthropic", async () => okResult("fine, no NPI here"));

    const result = await runRole("verifier", { prompt: "hi", purpose: "test", npiTagged: false });
    assert.equal(result.text, "fine, no NPI here");
  });
});

describe("runRole: daily token budget hard stop", () => {
  it("blocks further calls once a role's budget is exceeded", async () => {
    process.env.AI_GATEWAY_BUDGET_GENERATOR = "10";
    __setProviderImplForTests("google", async () => ({ text: "big", tokensIn: 5, tokensOut: 10 }));

    // First call: budget starts at 0, under the 10-token cap — allowed through
    // even though it will push usage to 15 (checked BEFORE, not after).
    const first = await runRole("generator", { prompt: "hi", purpose: "test" });
    assert.equal(first.text, "big");

    // Second call: usage (15) now exceeds the 10-token budget — hard stop.
    await assert.rejects(
      () => runRole("generator", { prompt: "hi", purpose: "test" }),
      /daily token budget exceeded/,
    );
  });
});

describe("runRole: SPEC-GATEWAY-CAPABILITY-EXPANSION-1 field passthrough", () => {
  it("passes inlineData and useSearchGrounding from the request into the provider call", async () => {
    let captured: any = null;
    __setProviderImplForTests("google", async (req) => {
      captured = req;
      return okResult("ok");
    });

    await runRole("generator", {
      prompt: "hi",
      purpose: "test",
      inlineData: [{ mimeType: "application/pdf", data: "base64==" }],
      useSearchGrounding: true,
    });

    assert.deepEqual(captured.inlineData, [{ mimeType: "application/pdf", data: "base64==" }]);
    assert.equal(captured.useSearchGrounding, true);
  });

  it("SPEC-M1.1: skips a non-google fallback step entirely when inlineData is present, surfacing google's real error", async () => {
    let openaiCalled = false;
    __setProviderImplForTests("google", async () => {
      throw new Error('{"code":404,"status":"NOT_FOUND"}');
    });
    __setProviderImplForTests("openai", async () => {
      openaiCalled = true;
      throw new Error("should never be called — inlineData is google-only");
    });

    await assert.rejects(
      () =>
        runRole("generator", {
          prompt: "hi",
          purpose: "test",
          inlineData: [{ mimeType: "application/pdf", data: "base64==" }],
        }),
      /"code":404/,
    );
    assert.equal(openaiCalled, false, "openai must not be attempted for an inlineData request");
    assert.equal(ledgerEntries.length, 1, "the skipped openai step must not be ledgered");
  });

  it("passes a chain step's authMode into the provider call", async () => {
    process.env.AI_GATEWAY_CHAIN_GENERATOR = "google:gemini-3.1-flash-lite";
    let captured: any = null;
    __setProviderImplForTests("google", async (req) => {
      captured = req;
      return okResult("ok");
    });

    await runRole("generator", { prompt: "hi", purpose: "test" });

    // roleConfig's env-override parser doesn't set authMode (no ":authMode"
    // segment in the env string) — confirms the default (api-key) path is
    // what threads through absent an explicit chain-step override.
    assert.equal(captured.authMode, undefined);
    delete process.env.AI_GATEWAY_CHAIN_GENERATOR;
  });

  it("SPEC-M1.1: a request-level authMode override wins over the chain step's default", async () => {
    let captured: any = null;
    __setProviderImplForTests("google", async (req) => {
      captured = req;
      return okResult("ok");
    });

    await runRole("generator", { prompt: "hi", purpose: "test", authMode: "vertex" });

    assert.equal(captured.authMode, "vertex");
  });

  it("surfaces groundingMetadata from the provider result on the RunRoleResult", async () => {
    __setProviderImplForTests("google", async () => ({
      text: "grounded",
      tokensIn: 1,
      tokensOut: 1,
      groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com" } }] },
    }));

    const result = await runRole("generator", {
      prompt: "hi",
      purpose: "test",
      useSearchGrounding: true,
    });
    assert.deepEqual((result.groundingMetadata as any).groundingChunks, [
      { web: { uri: "https://example.com" } },
    ]);
  });

  it("does not add a groundingMetadata key when the provider result has none", async () => {
    __setProviderImplForTests("google", async () => okResult("plain"));
    const result = await runRole("generator", { prompt: "hi", purpose: "test" });
    assert.equal("groundingMetadata" in result, false);
  });

  it("modelOverride replaces the chain step's model for the call and the ledger/result", async () => {
    let captured: any = null;
    __setProviderImplForTests("openai", async (req) => {
      captured = req;
      return okResult("ok");
    });

    const result = await runRole("structurer", {
      prompt: "hi",
      purpose: "test",
      modelOverride: "o1-preview",
    });

    assert.equal(captured.model, "o1-preview");
    assert.equal(result.model, "o1-preview");
    assert.equal(ledgerEntries[0].model, "o1-preview");
  });

  it("uses the chain step's configured model when modelOverride is absent", async () => {
    let captured: any = null;
    __setProviderImplForTests("openai", async (req) => {
      captured = req;
      return okResult("ok");
    });

    await runRole("structurer", { prompt: "hi", purpose: "test" });
    assert.equal(captured.model, "gpt-4o-2024-08-06");
  });

  it("does NOT apply modelOverride to a fallback step on a different provider", async () => {
    // SPEC-M1.1 regression: a Gemini-specific modelOverride on the
    // "generator" role (google-primary, openai-fallback) must not leak
    // into the openai fallback call when google fails over — that would
    // hand an OpenAI adapter a Gemini model string.
    let capturedOpenai: any = null;
    __setProviderImplForTests("google", async () => {
      throw new Error("google down");
    });
    __setProviderImplForTests("openai", async (req) => {
      capturedOpenai = req;
      return okResult("recovered via openai");
    });

    const result = await runRole("generator", {
      prompt: "hi",
      purpose: "test",
      modelOverride: "gemini-2.5-pro",
    });

    assert.equal(result.provider, "openai");
    assert.equal(capturedOpenai.model, "gpt-4o-2024-08-06");
    assert.notEqual(capturedOpenai.model, "gemini-2.5-pro");
  });
});

describe("runRoleStream", () => {
  it("throws for a non-google provider (out of scope for SPEC-M1)", async () => {
    process.env.AI_GATEWAY_CHAIN_INTERVIEWER = "openai:gpt-4o-mini";
    // roleConfig re-reads env per call; no override needed beyond the env var above.
    const gen = runRoleStream("interviewer", { prompt: "hi", purpose: "test" });
    await assert.rejects(() => gen.next(), /not implemented for provider "openai"/);
    delete process.env.AI_GATEWAY_CHAIN_INTERVIEWER;
  });
});
