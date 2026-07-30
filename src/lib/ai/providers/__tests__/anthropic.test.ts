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
