import "server-only";

/**
 * Anthropic (Claude) fetch-only provider adapter for the AI gateway
 * (SPEC-M1 AI-GATEWAY-1). Net-new vendor — no @anthropic-ai/sdk per
 * Gateway Invariant #3; talks directly to the Messages API.
 *
 * Structured output: Anthropic has no native JSON-schema response mode, so
 * a responseSchema request is implemented via forced tool-use (a single
 * tool whose input_schema is the caller's schema, tool_choice forced) —
 * the documented Anthropic pattern for guaranteed-shape JSON.
 */

import type { ProviderCallRequest, ProviderCallResult } from "./types";

const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const STRUCTURED_TOOL_NAME = "emit_result";

export async function callAnthropic(req: ProviderCallRequest): Promise<ProviderCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  // SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §2: this adapter doesn't implement
  // multimodal input — throw loudly rather than silently sending a
  // text-only request and dropping the caller's image/PDF.
  if (req.inlineData?.length) {
    throw new Error("callAnthropic: inlineData is not supported by this provider adapter");
  }

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages: [{ role: "user", content: req.prompt }],
  };
  if (req.systemInstruction) {
    body.system = req.systemInstruction;
  }
  if (req.temperature !== undefined) {
    body.temperature = req.temperature;
  }
  if (req.responseSchema) {
    body.tools = [
      {
        name: STRUCTURED_TOOL_NAME,
        description: "Emit the structured result in the required schema.",
        input_schema: req.responseSchema,
      },
    ];
    body.tool_choice = { type: "tool", name: STRUCTURED_TOOL_NAME };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const blocks = (data?.content ?? []) as Array<{
    type?: string;
    text?: string;
    name?: string;
    input?: unknown;
  }>;

  let text = "";
  if (req.responseSchema) {
    const toolBlock = blocks.find(
      (b) => b.type === "tool_use" && b.name === STRUCTURED_TOOL_NAME,
    );
    if (!toolBlock) {
      throw new Error("no tool_use block in structured response");
    }
    text = JSON.stringify(toolBlock.input ?? {});
  } else {
    text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  }

  if (!text) {
    const stopReason = data?.stop_reason;
    throw new Error(stopReason ? `empty response (stop_reason: ${stopReason})` : "empty response");
  }

  const usage = data?.usage ?? {};
  return {
    text,
    tokensIn: Number(usage.input_tokens ?? 0),
    tokensOut: Number(usage.output_tokens ?? 0),
  };
}
