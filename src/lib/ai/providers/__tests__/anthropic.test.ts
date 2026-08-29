/**
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §2 — providers/anthropic.ts: throws
 * (never silently drops) when given inlineData, which this adapter does
 * not implement.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { callAnthropic } = require("../anthropic") as typeof import("../anthropic");

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
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("callAnthropic: §2 multimodal input guard", () => {
  it("throws rather than silently dropping inlineData", async () => {
    await assert.rejects(
      () =>
        callAnthropic({
          model: "claude-sonnet-5",
          prompt: "hi",
          timeoutMs: 5000,
          inlineData: [{ mimeType: "image/png", data: "base64==" }],
        }),
      /inlineData is not supported/,
    );
  });
});


describe("callAnthropic: terminal completion proof", () => {
  it("accepts text only when the provider reports end_turn", async () => {
    const { restore } = installFetch(async () =>
      okResponse({
        content: [{ type: "text", text: "complete" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    );
    try {
      const result = await callAnthropic({
        model: "claude-sonnet-5",
        prompt: "answer",
        timeoutMs: 5000,
      });
      assert.deepEqual(result, { text: "complete", tokensIn: 5, tokensOut: 3 });
    } finally {
      restore();
    }
  });

  for (const stopReason of [
    "max_tokens",
    "model_context_window_exceeded",
    "pause_turn",
    "refusal",
    "tool_use",
  ]) {
    it(`rejects nonterminal text with stop_reason ${stopReason}`, async () => {
      const { restore } = installFetch(async () =>
        okResponse({
          content: [{ type: "text", text: "partial" }],
          stop_reason: stopReason,
        }),
      );
      try {
        await assert.rejects(
          () =>
            callAnthropic({
              model: "claude-sonnet-5",
              prompt: "answer",
              timeoutMs: 5000,
            }),
          new RegExp(`incomplete response .*stop_reason: ${stopReason}`),
        );
      } finally {
        restore();
      }
    });
  }

  it("rejects text whose stop reason is missing", async () => {
    const { restore } = installFetch(async () =>
      okResponse({ content: [{ type: "text", text: "unproven" }] }),
    );
    try {
      await assert.rejects(
        () =>
          callAnthropic({
            model: "claude-sonnet-5",
            prompt: "answer",
            timeoutMs: 5000,
          }),
        /stop_reason missing/,
      );
    } finally {
      restore();
    }
  });

  it("accepts forced structured output only with tool_use completion proof", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({
        content: [{ type: "tool_use", name: "emit_result", input: { ok: true } }],
        stop_reason: "tool_use",
      }),
    );
    try {
      const result = await callAnthropic({
        model: "claude-sonnet-5",
        prompt: "answer",
        timeoutMs: 5000,
        responseSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
      });
      assert.equal(result.text, "{\"ok\":true}");
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.tool_choice, { type: "tool", name: "emit_result" });
    } finally {
      restore();
    }
  });

  it("rejects a structured block without returned input", async () => {
    const { restore } = installFetch(async () =>
      okResponse({
        content: [{ type: "tool_use", name: "emit_result" }],
        stop_reason: "tool_use",
      }),
    );
    try {
      await assert.rejects(
        () =>
          callAnthropic({
            model: "claude-sonnet-5",
            prompt: "answer",
            timeoutMs: 5000,
            responseSchema: { type: "object" },
          }),
        /no complete tool_use block/,
      );
    } finally {
      restore();
    }
  });

  it("rejects structured output without a tool_use stop reason", async () => {
    const { restore } = installFetch(async () =>
      okResponse({
        content: [{ type: "tool_use", name: "emit_result", input: { ok: true } }],
        stop_reason: "max_tokens",
      }),
    );
    try {
      await assert.rejects(
        () =>
          callAnthropic({
            model: "claude-sonnet-5",
            prompt: "answer",
            timeoutMs: 5000,
            responseSchema: { type: "object" },
          }),
        /stop_reason: max_tokens/,
      );
    } finally {
      restore();
    }
  });
});
