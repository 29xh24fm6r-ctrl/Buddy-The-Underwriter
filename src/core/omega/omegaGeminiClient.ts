import "server-only";

/**
 * Shared Gemini client for Omega advisory generation.
 * Same REST pattern as narrativeEngine.ts and sbaPackageNarrative.ts.
 * Never writes to canonical tables.
 */

const GEMINI_MODEL = "gemini-2.0-flash";

const GEMINI_API_URL = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

export async function callOmegaGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[omegaGeminiClient] GEMINI_API_KEY not set");
    return "";
  }

  const resp = await fetch(GEMINI_API_URL(apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`omega_gemini_${resp.status}: ${errText.slice(0, 300)}`);
  }

  const json = await resp.json();
  return (
    json?.candidates?.[0]?.content?.parts
      ?.filter((p: { thought?: boolean }) => !p.thought)
      ?.map((p: { text?: string }) => p.text ?? "")
      ?.join("") ?? ""
  );
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
