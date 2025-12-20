// src/lib/ai/openai.ts
import "server-only";

type Json = any;

export type AiJsonResult<T = Json> = {
  ok: true;
  result: T;
  confidence: number; // 0-100
  evidence?: any[];
  requires_human_review: boolean;
} | {
  ok: false;
  error: string;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

export async function aiJson<T = Json>(args: {
  scope: string;
  action: string;
  system: string;
  user: string;
  jsonSchemaHint: string;
}): Promise<AiJsonResult<T>> {
  // NOTE: Replace with your actual OpenAI SDK usage in your repo.
  // This stub is intentionally "safe compile" and forces a deterministic fallback.
  // Cursor: wire to official OpenAI responses API in your existing AI layer.

  try {
    // If no API key, return deterministic fallback instead of crashing builds.
    if (!process.env.OPENAI_API_KEY) {
      return {
        ok: true,
        result: JSON.parse(args.jsonSchemaHint.includes("{") ? args.jsonSchemaHint.match(/\{[\s\S]*\}/)?.[0] || "{}" : "{}"),
        confidence: 10,
        evidence: [{ note: "OPENAI_API_KEY missing; returned fallback schema-shaped object." }],
        requires_human_review: true,
      } as any;
    }

    // -----------------------------
    // Cursor: Replace below with real call
    // -----------------------------
    // For now, return a safe empty result.
    return {
      ok: true,
      result: {} as T,
      confidence: 25,
      evidence: [{ note: "AI call stub: replace with real OpenAI client call." }],
      requires_human_review: true,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "AI error" };
  }
}
