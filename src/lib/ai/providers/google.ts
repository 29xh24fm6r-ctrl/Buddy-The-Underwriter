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
 *
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 additions (all opt-in via request
 * fields, default path unchanged):
 *   §1 authMode: "vertex" — routes through the Vertex REST endpoint using a
 *      bearer token from getVertexAccessToken() (gcpAdcBootstrap.ts) instead
 *      of GEMINI_API_KEY. Still no SDK import here.
 *   §2 inlineData — appends image/PDF content parts (mirrors
 *      runGeminiOcrJob.ts's part construction).
 *   §3 useSearchGrounding — sets tools: [{ google_search: {} }] and threads
 *      candidate.groundingMetadata into the result (mirrors
 *      buddyIntelligenceEngine.ts's existing citation-threading parse).
 */

import { isGemini3Model } from "../models";
import { splitSSEEvents } from "@/lib/sse/parseSSEBuffer";
import { getVertexAccessToken, getProjectId } from "@/lib/gcpAdcBootstrap";
import { getVertexLocation } from "../vertexLocation";
import type { ProviderCallRequest, ProviderCallResult } from "./types";

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

function buildGenerationConfig(req: ProviderCallRequest): Record<string, unknown> {
  const config: Record<string, unknown> = {
    maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  if (req.responseSchema) {
    config.responseMimeType = "application/json";
    config.responseSchema = req.responseSchema;
  } else if (req.jsonMode) {
    config.responseMimeType = "application/json";
  }
  if (isGemini3Model(req.model)) {
    // Gemini 3.x rejects sub-1.0 temperatures — omit entirely, use thinkingConfig instead.
    config.thinkingConfig = { thinkingLevel: req.thinkingLevel ?? "low" };
    if (req.mediaResolution) {
      config.mediaResolution = req.mediaResolution;
    }
  } else {
    config.temperature = req.temperature ?? 0.1;
  }
  return config;
}

function buildRequestBody(req: ProviderCallRequest): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [{ text: req.prompt }];
  for (const inline of req.inlineData ?? []) {
    parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: buildGenerationConfig(req),
  };
  if (req.systemInstruction) {
    body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
  }
  if (req.useSearchGrounding) {
    body.tools = [{ google_search: {} }];
  }
  return body;
}

// Test-only seam: substitute the Vertex token resolver so tests never hit
// real GCP auth resolution (google-auth-library's default ADC lookup
// throws outside a real GCP/Vercel environment). Same escape-hatch
// pattern as gateway.ts's providerImpl/logCallImpl.
let vertexAccessTokenImpl: () => Promise<string> = getVertexAccessToken;

export function __setVertexAccessTokenForTests(impl: () => Promise<string>): void {
  vertexAccessTokenImpl = impl;
}

export function __resetVertexAccessTokenForTests(): void {
  vertexAccessTokenImpl = getVertexAccessToken;
}

async function resolveEndpointAndAuth(
  req: ProviderCallRequest,
  streaming: boolean,
): Promise<{ url: string; headers: Record<string, string> }> {
  if (req.authMode === "vertex") {
    const project = getProjectId();
    if (!project) {
      throw new Error(
        "Vertex authMode requires a Google Cloud project id (GOOGLE_CLOUD_PROJECT / GOOGLE_PROJECT_ID / GCS_PROJECT_ID / GCP_PROJECT_ID)",
      );
    }
    const location = getVertexLocation();
    const token = await vertexAccessTokenImpl();
    const method = streaming ? "streamGenerateContent" : "generateContent";
    const query = streaming ? "?alt=sse" : "";
    return {
      url:
        `https://${location}-aiplatform.googleapis.com/v1/projects/${project}` +
        `/locations/${location}/publishers/google/models/${req.model}:${method}${query}`,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  const method = streaming ? "streamGenerateContent" : "generateContent";
  const query = streaming ? "?alt=sse" : "";
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:${method}${query}`,
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
  };
}

function extractText(parts: Array<{ text?: string; thought?: boolean }> | undefined): string {
  return parts?.filter((p) => !p.thought)?.map((p) => p.text ?? "")?.join("") ?? "";
}

export async function callGoogle(req: ProviderCallRequest): Promise<ProviderCallResult> {
  const { url, headers } = await resolveEndpointAndAuth(req, false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
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
  const candidate = data?.candidates?.[0];
  // SPEC-M1.1: a prompt-safety block is a distinct, actionable failure mode
  // from "empty response" — promoted here from streamGoogle (which already
  // had this check) so non-streaming callers (e.g.
  // buddyIntelligenceEngine.ts) can also distinguish it via the thrown
  // message rather than have it collapse into a generic empty-response.
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked the prompt: ${blockReason}`);
  }
  const text = extractText(candidate?.content?.parts);
  if (!text) {
    const finishReason = candidate?.finishReason;
    throw new Error(
      finishReason ? `empty response (finishReason: ${finishReason})` : "empty response",
    );
  }

  const usage = data?.usageMetadata ?? {};
  return {
    text,
    tokensIn: Number(usage.promptTokenCount ?? 0),
    tokensOut: Number(usage.candidatesTokenCount ?? 0),
    ...(req.useSearchGrounding && candidate?.groundingMetadata
      ? { groundingMetadata: candidate.groundingMetadata }
      : {}),
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
  const { url, headers } = await resolveEndpointAndAuth(req, true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
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
        let parsed: any;
        try {
          parsed = JSON.parse(evt.data);
        } catch {
          // Malformed/partial SSE chunk — skip it, the model keeps streaming.
          continue;
        }
        // SPEC-M1.1: a prompt-safety block is a distinct, actionable failure
        // mode from "empty response" (e.g. MAX_TOKENS) — surface it as a
        // thrown error (outside the malformed-JSON catch above) so callers
        // can log/handle it separately rather than folding it into a
        // generic "no reply text" fallback path. Promoted from
        // geminiClient.ts's streamGeminiText, which originally detected
        // this itself; now every gateway streaming caller gets it.
        const blockReason = parsed?.promptFeedback?.blockReason;
        if (blockReason) {
          throw new Error(`Gemini blocked the prompt: ${blockReason}`);
        }
        const text = extractText(parsed?.candidates?.[0]?.content?.parts);
        if (text) yield text;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
