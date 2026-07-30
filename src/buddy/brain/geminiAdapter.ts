// src/buddy/brain/geminiAdapter.ts
import "server-only";

import type { BuddyContextPack } from "@/buddy/brain/types";
import { GEMINI_FLASH } from "@/lib/ai/models";
import { classifySdkError } from "@/lib/extraction/sdkResponseGuard";
import { runRole } from "@/lib/ai/gateway";

// SPEC-M1.1: routed through the AI gateway (runRole, "generator" role,
// authMode: "vertex" — this caller specifically needs Vertex/WIF auth, not
// the API-key REST path). No responseSchema is set, matching the original's
// config (no responseMimeType/JSON mode) — the manual JSON.parse-with-
// fallback below is unchanged. The 10s Promise.race timeout is now the
// gateway's own timeoutMs (AbortController-based, providers/google.ts);
// the "gemini_timeout" literal error text it used to throw was never
// pattern-matched by this file's own catch (which always returns a generic
// fallback resultJson regardless of error text).
export async function geminiShadowAnalyze(ctx: BuddyContextPack) {
  const model = process.env.GEMINI_MODEL ?? GEMINI_FLASH;

  const prompt = [
    "You are Buddy Shadow Brain. Return STRICT JSON only. No markdown.",
    "Task: derive structured subcontext to help a voice assistant without blocking.",
    "Rules:",
    "- Do not invent facts. Use only ctx fields.",
    "- Output must be valid JSON object with keys: intent, missing, notes, confidence.",
    "",
    `ctx=${JSON.stringify(ctx)}`,
  ].join("\n");

  const started = Date.now();

  try {
    const result = await runRole("generator", {
      purpose: "buddy_shadow_brain",
      prompt,
      modelOverride: model,
      authMode: "vertex",
      temperature: 0.2,
      timeoutMs: 10_000,
    });

    const latencyMs = Date.now() - started;
    let parsed: any = null;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = { intent: "unknown", missing: null, notes: "non-json response", confidence: 0.1 };
    }

    return { model: result.model, latencyMs, resultJson: parsed };
  } catch (err: unknown) {
    const latencyMs = Date.now() - started;
    const classification = classifySdkError(err);
    if (classification.isHtmlResponse) {
      console.error("[geminiShadowAnalyze] SDK_HTML_RESPONSE", {
        model,
        rawSnippet: classification.rawSnippet,
        latencyMs,
      });
    }
    return {
      model,
      latencyMs,
      resultJson: { intent: "unknown", missing: null, notes: "error", confidence: 0 },
    };
  }
}
