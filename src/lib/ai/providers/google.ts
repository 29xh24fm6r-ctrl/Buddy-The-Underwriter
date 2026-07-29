import "server-only";

/**
 * Google (Gemini) fetch-only provider adapter for the AI gateway
 * (SPEC-M1 AI-GATEWAY-1). Mirrors the proven request/response shape in
 * src/lib/ai/geminiClient.ts (thinkingConfig for 3.x models, maxOutputTokens
 * defaults, thought-part filtering) but scoped to the gateway's
 * ProviderCallRequest/Result contract. No SDK — Gateway Invariant #3.
 *
 * Reuses isGemini3Model (../models) and splitSSEEvents (@/lib/sse) rather
 * than redefining either — both have hard-won incident history documented
 * at their source (see geminiClient.ts and parseSSEBuffer.ts).
 */

import { isGemini3Model } from "../models";
import { splitSSEEvents } from "@/lib/sse/parseSSEBuffer";
import type { ProviderCallRequest, ProviderCallResult } from "./types";

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

function buildGenerationConfig(req: ProviderCallRequest): Record<string, unknown> {
  const config: Record<string, unknown> = {
    maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  if (req.responseSchema) {
    config.responseMimeType = "application/json";
    config.responseSchema = req.responseSchema;
  }
  if (isGemini3Model(req.model)) {
    // Gemini 3.x rejects sub-1.0 temperatures — omit entirely, use thinkingConfig instead.
    config.thinkingConfig = { thinkingLevel: "low" };
  } else {
    config.temperature = 0.1;
  }
  return config;
}

function buildRequestBody(req: ProviderCallRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: buildGenerationConfig(req),
  };
  if (req.systemInstruction) {
    body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
  }
  return body;
}

function extractText(parts: Array<{ text?: string; thought?: boolean }> | undefined): string {
  return parts?.filter((p) => !p.thought)?.map((p) => p.text ?? "")?.join("") ?? "";
}

export async function callGoogle(req: ProviderCallRequest): Promise<ProviderCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildRequestBody(req)),
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
  const text = extractText(data?.candidates?.[0]?.content?.parts);
  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(
      finishReason ? `empty response (finishReason: ${finishReason})` : "empty response",
    );
  }

  const usage = data?.usageMetadata ?? {};
  return {
    text,
    tokensIn: Number(usage.promptTokenCount ?? 0),
    tokensOut: Number(usage.candidatesTokenCount ?? 0),
  };
}

/**
 * Streaming variant — feeds the `interviewer` role (full UX lands in M5).
 * No retry: a stream that dies partway through can't safely resume (same
 * tradeoff documented in streamGeminiText's doc comment). Failover across
 * chain steps is therefore NOT attempted mid-stream by the gateway — only
 * the chain's first step is used for streaming calls.
 */
export async function* streamGoogle(req: ProviderCallRequest): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildRequestBody(req)),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const { events, rest } = splitSSEEvents(buf);
      buf = rest;
      for (const evt of events) {
        try {
          const parsed = JSON.parse(evt.data);
          const text = extractText(parsed?.candidates?.[0]?.content?.parts);
          if (text) yield text;
        } catch {
          // Malformed/partial SSE chunk — skip it, the model keeps streaming.
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
