import "server-only";

/**
 * Shared Gemini client for Omega advisory generation.
 * SPEC-M1.1 — migrated onto the AI gateway (generator role). The 5
 * downstream generators (Communication/Explanation/Recommendations/
 * RiskNarrative/Scenarios) each define their own prompt + expected JSON
 * shape and parse the returned text themselves via safeParseJSON below —
 * this shared client stays schema-agnostic (jsonMode without a schema,
 * same "ask for JSON via prompt, parse leniently" contract as before).
 * Never writes to canonical tables.
 */

import { runRole } from "@/lib/ai/gateway";

export async function callOmegaGemini(prompt: string): Promise<string> {
  try {
    const result = await runRole("generator", {
      purpose: "omega_advisory",
      prompt,
      maxOutputTokens: 4096,
      jsonMode: true,
    });
    return result.text;
  } catch (e) {
    console.warn("[omegaGeminiClient] gateway call failed", e instanceof Error ? e.message : e);
    return "";
  }
}

export function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    // Try to extract JSON from text
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}
