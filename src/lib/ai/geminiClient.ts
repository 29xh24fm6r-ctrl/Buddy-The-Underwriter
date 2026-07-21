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
import { splitSSEEvents } from "@/lib/sse/parseSSEBuffer";

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
  /**
   * SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1 (same root cause, applied here too —
   * see streamGeminiText's doc comment below for the full incident writeup).
   * Override only if the default budgets below are wrong for a given caller.
   */
  maxOutputTokens?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
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
        maxOutputTokens: opts.maxOutputTokens,
        thinkingLevel: opts.thinkingLevel,
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

export type GeminiStreamOptions = {
  model: string;
  prompt: string;
  logTag: string;
  timeoutMs?: number;
  /** See doc comment below — override only if the default is wrong for a caller. */
  maxOutputTokens?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
};

/**
 * Streams raw text deltas from Gemini's SSE endpoint (no JSON-mode — callers
 * that need structured output embed their own delimiter convention in the
 * prompt and parse it out of the accumulated text). No retry: a stream that
 * dies partway through can't be safely retried without re-sending whatever
 * was already flushed to the caller, so callers should treat a mid-stream
 * failure as "use what arrived, then fall back."
 *
 * One hard timeout for the whole stream (not per-chunk) — a model that's
 * merely slow to start is indistinguishable from one that's stalled from the
 * caller's perspective, and both should give up at the same wall-clock cap.
 *
 * INCIDENT (found in production live audit, 2026-07-20): this function never
 * set `maxOutputTokens` or `thinkingConfig`. Gemini 3.x models think by
 * default, and thinking tokens are drawn from the SAME output budget as the
 * visible answer. With no maxOutputTokens set, the SDK/API default budget
 * can be consumed entirely by invisible reasoning tokens before a single
 * answer token is emitted — the call returns HTTP 200, the stream completes
 * cleanly with finishReason MAX_TOKENS, and zero text is ever yielded. No
 * exception is thrown anywhere in this path, so it fails 100% silently: the
 * borrower-facing concierge route only sees "the model produced no reply
 * text" and falls back to a generic "didn't quite catch that" message on
 * every single turn. This exact failure mode was already diagnosed and
 * fixed once in this codebase (SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1, see
 * src/lib/financialSpreads/extractors/gemini/geminiClient.ts) but that fix
 * was never applied to this shared client, which is what the borrower
 * concierge (text + voice) and the bank-side concierge all actually call.
 * Fixed here so every caller gets it at once.
 */
export async function* streamGeminiText(
  opts: GeminiStreamOptions,
): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const generationConfig: Record<string, unknown> = {
    // Conversational reply + fact-JSON tail is short-form — 4096 leaves
    // comfortable headroom without inviting runaway thinking-token spend.
    maxOutputTokens: opts.maxOutputTokens ?? 4096,
  };
  if (isGemini3Model(opts.model)) {
    // "low" mirrors the extraction client's choice: enough reasoning to
    // track multi-turn borrower context, not so much it eats the budget.
    generationConfig.thinkingConfig = {
      thinkingLevel: opts.thinkingLevel ?? "low",
    };
  } else {
    generationConfig.temperature = 0.1;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig,
      }),
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
          // thinkingConfig can still surface thought-marked parts even
          // without include_thoughts requested — filter them out so
          // reasoning text never leaks into the borrower's chat. See
          // naics-suggest/route.ts for the same guard on the non-streaming
          // path.
          const parts = parsed?.candidates?.[0]?.content?.parts as
            | Array<{ text?: string; thought?: boolean }>
            | undefined;
          const text = parts
            ?.filter((p) => !p.thought)
            ?.map((p) => p.text ?? "")
            ?.join("");
          if (typeof text === "string" && text) yield text;
        } catch {
          // Malformed/partial SSE chunk — skip it, the model keeps streaming.
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[gemini-stream:${opts.logTag}] failed: ${msg}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callOnce<T>(args: {
  apiKey: string;
  model: string;
  prompt: string;
  logTag: string;
  timeoutMs: number;
  systemInstruction?: string;
  maxOutputTokens?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
}): Promise<T> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent?key=${args.apiKey}`;

  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    // See streamGeminiText's doc comment: without this, Gemini 3.x's
    // default thinking budget can consume the entire output allowance
    // before any answer text is emitted (HTTP 200, finishReason MAX_TOKENS,
    // zero text — no exception thrown anywhere in this path).
    maxOutputTokens: args.maxOutputTokens ?? 4096,
  };
  if (isGemini3Model(args.model)) {
    generationConfig.thinkingConfig = {
      thinkingLevel: args.thinkingLevel ?? "low",
    };
  } else {
    // Gemini 3.x rejects sub-1.0 temperatures — omit entirely for that family.
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
  // Filter out thought-marked parts (see streamGeminiText's doc comment) —
  // otherwise a thought part landing at parts[0] would be mistaken for the
  // answer.
  const parts = data?.candidates?.[0]?.content?.parts as
    | Array<{ text?: string; thought?: boolean }>
    | undefined;
  const text: string =
    parts
      ?.filter((p) => !p.thought)
      ?.map((p) => p.text ?? "")
      ?.join("") ?? "";
  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(
      finishReason ? `empty response (finishReason: ${finishReason})` : "empty response",
    );
  }

  // Gemini occasionally wraps JSON in ```json fences even with responseMimeType.
  const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean) as T;
}
