import OpenAI from "openai";
import type { TraceIds } from "./openaiResilience";

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  return new OpenAI({
    apiKey,
    maxRetries: 0,   // Buddy owns retries via withOpenAIResilience
    timeout: 45_000, // 45s per attempt (30-60s spec)
  });
}

/**
 * Per-request headers for OpenAI API calls.
 *
 * - X-Client-Request-Id: unique per attempt (for OpenAI support lookup)
 * - X-Buddy-Trace-Id: stable per logical operation (same across retries)
 */
export function openaiRequestHeaders(ids: TraceIds) {
  return {
    "X-Client-Request-Id": ids.attemptId,
    "X-Buddy-Trace-Id": ids.traceId,
  };
}

export function getModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-2024-08-06";
}

export function getTemp() {
  const v = Number(process.env.OPENAI_TEMPERATURE ?? "0.2");
  return Number.isFinite(v) ? v : 0.2;
}

export function getMaxOutputTokens() {
  const v = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? "4096");
  return Number.isFinite(v) ? v : 4096;
}
