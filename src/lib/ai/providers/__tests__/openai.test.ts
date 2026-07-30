/**
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 — providers/openai.ts unit tests.
 *
 * §2: callOpenAI throws (never silently drops) when given inlineData.
 * §4: embedOpenAI's request/response shape.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { callOpenAI, embedOpenAI } = require("../openai") as typeof import("../openai");

type FetchImpl = (input: any, init?: any) => Promise<Response>;
type CapturedCall = { url: string; init: any };

function installFetch(impl: FetchImpl): { restore: () => void; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push({ url: String(input), init });
    return impl(input, init);
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, calls };
}

function okResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("callOpenAI: §2 multimodal input guard", () => {
  it("throws rather than silently dropping inlineData", async () => {
    await assert.rejects(
      () =>
        callOpenAI({
          model: "gpt-4o-mini",
          prompt: "hi",
          timeoutMs: 5000,
          inlineData: [{ mimeType: "image/png", data: "base64==" }],
        }),
      /inlineData is not supported/,
    );
  });
});

describe("embedOpenAI: §4 embeddings", () => {
  it("posts to the embeddings endpoint and returns the vector + token count", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 7, total_tokens: 7 },
      }),
    );
    try {
      const result = await embedOpenAI({
        model: "text-embedding-3-small",
        input: "some text",
        dimensions: 1536,
        timeoutMs: 5000,
      });
      assert.deepEqual(result.vector, [0.1, 0.2, 0.3]);
      assert.equal(result.tokensIn, 7);
      assert.match(calls[0].url, /\/v1\/embeddings$/);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.model, "text-embedding-3-small");
      assert.equal(body.input, "some text");
      assert.equal(body.dimensions, 1536);
    } finally {
      restore();
    }
  });

  it("throws on an empty embedding response", async () => {
    const { restore } = installFetch(async () => okResponse({ data: [] }));
    try {
      await assert.rejects(
        () =>
          embedOpenAI({ model: "text-embedding-3-small", input: "x", timeoutMs: 5000 }),
        /empty embedding response/,
      );
    } finally {
      restore();
    }
  });
});
