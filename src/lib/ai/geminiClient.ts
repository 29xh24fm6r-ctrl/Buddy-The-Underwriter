import "server-only";

/**
 * Gemini JSON client — now routed through the AI gateway (SPEC-M1.1).
 *
 * Matches the pattern established by
 * src/lib/financialSpreads/extractors/gemini/geminiClient.ts: hard timeout,
 * one retry, JSON-fence cleanup, never-throw envelope.
 *
 * Used by the borrower concierge route and (in Sprint 1) the brokerage
 * concierge route. Two callers, one helper.
 *
 * The retry-with-backoff loop below is a genuinely different reliability
 * strategy than the gateway's own provider-failover chain (same model/
 * provider, retried, vs failing over to a different provider) — kept here
 * rather than folded into runRole(), which only tries each chain step
 * once. All the incident-driven config (maxOutputTokens, thinkingLevel,
 * temperature-omission for Gemini 3.x) is preserved via runRole()'s
 * per-call override fields (modelOverride/maxOutputTokens/thinkingLevel/
 * temperature) rather than lost.
 */

import { runRole, runRoleStream } from "./gateway";

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
  if (!process.env.GEMINI_API_KEY) {
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
 *
 * SPEC-M1.1: migrated onto the AI gateway (runRoleStream, interviewer
 * role — the role roleConfig.ts's own doc comment already designates for
 * this exact concierge use case). maxOutputTokens/thinkingLevel defaults
 * are preserved via per-call overrides; the blockReason-detection-throws-
 * distinctly behavior (#730's fix) is now a permanent, built-in gateway
 * feature (providers/google.ts's streamGoogle), not reimplemented here.
 *
 * TRADE-OFF (disclosed, not silent): the verbose zero-text DIAGNOSTIC log
 * (#730's raw event/chunk/byte counters) is not reproduced — runRoleStream
 * yields clean text only, not the raw parsed SSE event, so per-event
 * introspection at this level of detail isn't available without a larger
 * gateway interface change. The correctness-relevant behavior (config
 * defaults, thought-part filtering, blockReason→throw) is fully preserved;
 * only the extra debug-log granularity for the zero-text edge case is
 * reduced.
 */
export async function* streamGeminiText(
  opts: GeminiStreamOptions,
): AsyncGenerator<string> {
  let sawVisibleText = false;
  try {
    for await (const chunk of runRoleStream("interviewer", {
      purpose: opts.logTag,
      prompt: opts.prompt,
      modelOverride: opts.model,
      maxOutputTokens: opts.maxOutputTokens ?? 16384,
      thinkingLevel: opts.thinkingLevel ?? "low",
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })) {
      sawVisibleText = true;
      yield chunk;
    }
    if (!sawVisibleText) {
      console.warn(
        `[gemini-stream:${opts.logTag}] stream completed with zero visible text`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[gemini-stream:${opts.logTag}] failed: ${msg}`);
    throw e;
  }
}

async function callOnce<T>(args: {
  model: string;
  prompt: string;
  logTag: string;
  timeoutMs: number;
  systemInstruction?: string;
  maxOutputTokens?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
}): Promise<T> {
  // SPEC-M1.1: migrated onto the AI gateway (generator role).
  // jsonMode requests responseMimeType: "application/json" without a
  // responseSchema — Gemini's constrained decoder treats a bare
  // { type: "object" } schema (no properties) as "zero properties
  // allowed," returning {} on every call. Schema-less JSON mode lets
  // the prompt govern the shape while still guaranteeing valid JSON.
  const result = await runRole("generator", {
    modelOverride: args.model,
    purpose: args.logTag,
    prompt: args.prompt,
    systemInstruction: args.systemInstruction,
    maxOutputTokens: args.maxOutputTokens ?? 16384,
    thinkingLevel: args.thinkingLevel ?? "low",
    timeoutMs: args.timeoutMs,
    jsonMode: true,
  });

  // Gemini occasionally wraps JSON in ```json fences even with responseMimeType.
  const clean = result.text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean) as T;
}
