import "server-only";

/**
 * Gemini JSON client — REST path to generativelanguage.googleapis.com.
 *
 * Matches the pattern established by
 * src/lib/financialSpreads/extractors/gemini/geminiClient.ts: hard timeout,
 * one retry, JSON-fence cleanup, never-throw envelope.
 *
 * Used by the borrower concierge route and (in Sprint 1) the brokerage
 * concierge route. Two callers, one helper.
 *
 * Reuses `isGemini3Model` from the registry — do not redefine.
 */

import { isGemini3Model } from "./models";

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_RETRIES = 1;

export type GeminiCallOptions = {
  model: string;
  prompt: string;
  logTag: string;
  /**
   * Optional first-class system instruction. Gemini REST routes this to the
   * top-level `systemInstruction` field, which takes priority over a
   * prefix-in-prompt approach for multi-turn behavior stability.
   */
  systemInstruction?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type GeminiCallResult<T> = {
  ok: boolean;
  result: T | null;
  latencyMs: number;
  attempts: number;
  error?: string;
};

export async function callGeminiJSON<T>(
  opts: GeminiCallOptions,
): Promise<GeminiCallResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      result: null,
      latencyMs: 0,
      attempts: 0,
      error: "GEMINI_API_KEY missing",
    };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  const start = Date.now();
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await callOnce<T>({
        apiKey,
        model: opts.model,
        prompt: opts.prompt,
        logTag: opts.logTag,
        timeoutMs,
        systemInstruction: opts.systemInstruction,
      });
      return {
        ok: true,
        result,
        latencyMs: Date.now() - start,
        attempts: attempt,
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const isLastAttempt = attempt === maxRetries + 1;
      if (isLastAttempt) {
        console.warn(
          `[gemini:${opts.logTag}] failed after ${attempt} attempt(s): ${lastError}`,
        );
        return {
          ok: false,
          result: null,
          latencyMs: Date.now() - start,
          attempts: attempt,
          error: lastError,
        };
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  return {
    ok: false,
    result: null,
    latencyMs: Date.now() - start,
    attempts: maxRetries + 1,
    error: lastError,
  };
}

async function callOnce<T>(args: {
  apiKey: string;
  model: string;
  prompt: string;
  logTag: string;
  timeoutMs: number;
  systemInstruction?: string;
}): Promise<T> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent?key=${args.apiKey}`;

  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
  };
  // Gemini 3.x rejects sub-1.0 temperatures — omit entirely for that family.
  if (!isGemini3Model(args.model)) {
    generationConfig.temperature = 0.1;
  }

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: args.prompt }] }],
    generationConfig,
  };
  if (args.systemInstruction) {
    body.systemInstruction = { parts: [{ text: args.systemInstruction }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  const text: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("empty response");

  // Gemini occasionally wraps JSON in ```json fences even with responseMimeType.
  const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean) as T;
}
