// src/lib/interview/suggestFacts.ts
import { ALLOWED_FACT_KEYS } from "@/lib/interview/factKeys";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function buildJsonSchema() {
  return {
    name: "fact_suggestions",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        suggestions: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              field_key: { type: "string", enum: ALLOWED_FACT_KEYS },
              field_value: {},
              value_text: { type: ["string", "null"] },
              confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
              rationale: { type: "string", maxLength: 300 },
            },
            required: ["field_key", "field_value", "rationale"],
          },
        },
      },
      required: ["suggestions"],
    },
    strict: true,
  } as const;
}

export type SuggestedFact = {
  field_key: string;
  field_value: any;
  value_text: string | null;
  confidence: number | null;
  rationale: string;
};

export async function suggestFactsFromBorrowerText(turnText: string): Promise<SuggestedFact[]> {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_FACT_SUGGEST_MODEL || "gpt-4o-mini";

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You extract candidate underwriting facts from a borrower utterance.",
          "Return ONLY facts explicitly stated in the text. No guessing.",
          "If a fact is ambiguous, do not include it.",
          "Prefer fewer, higher-quality suggestions.",
          "Use allowed field_key enum only.",
          "field_value should be JSON-typed (number/string/object/array) and match the statement.",
          "value_text can be a human-readable rendering if helpful.",
          "rationale must cite the exact portion (quote or tight paraphrase) supporting the fact.",
        ].join("\n"),
      },
      { role: "user", content: `Borrower said:\n\n${turnText}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: buildJsonSchema(),
    },
    max_tokens: 600,
    temperature: 0.1,
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`openai_chat_failed:${r.status}:${t}`);
  }

  const data: any = await r.json();

  const textOut = data?.choices?.[0]?.message?.content || "";

  const parsed = typeof textOut === "string" ? safeJsonParse(textOut) : null;
  const suggestions = parsed?.suggestions;

  if (!Array.isArray(suggestions)) return [];

  return suggestions
    .filter((s: any) => s && s.field_key && typeof s.rationale === "string")
    .slice(0, 8)
    .map((s: any) => ({
      field_key: String(s.field_key),
      field_value: s.field_value,
      value_text: s.value_text ?? null,
      confidence: typeof s.confidence === "number" ? s.confidence : null,
      rationale: String(s.rationale),
    }));
}
