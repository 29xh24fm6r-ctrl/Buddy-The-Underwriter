import "server-only";

/**
 * OpenAI fetch-only provider adapter for the AI gateway (SPEC-M1
 * AI-GATEWAY-1). No `openai` SDK per Gateway Invariant #3 — this is a new
 * adapter for the gateway's own traffic, distinct from the existing
 * src/lib/ai/openaiClient.ts (SDK-based, used by pre-gateway call sites;
 * out of scope for this spec, see guard-ai-gateway-only allowlist).
 *
 * Structured output uses Chat Completions' native json_schema response
 * format (the gateway's `structurer` role default) rather than a
 * prompt-engineered convention.
 */

import type { ProviderCallRequest, ProviderCallResult } from "./types";

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const STRUCTURED_SCHEMA_NAME = "gateway_result";

export async function callOpenAI(req: ProviderCallRequest): Promise<ProviderCallResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const messages: Array<{ role: string; content: string }> = [];
  if (req.systemInstruction) {
    messages.push({ role: "system", content: req.systemInstruction });
  }
  messages.push({ role: "user", content: req.prompt });

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  if (req.responseSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: STRUCTURED_SCHEMA_NAME,
        schema: req.responseSchema,
        strict: true,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (!text) {
    const finishReason = data?.choices?.[0]?.finish_reason;
    throw new Error(
      finishReason ? `empty response (finish_reason: ${finishReason})` : "empty response",
    );
  }

  const usage = data?.usage ?? {};
  return {
    text,
    tokensIn: Number(usage.prompt_tokens ?? 0),
    tokensOut: Number(usage.completion_tokens ?? 0),
  };
}
