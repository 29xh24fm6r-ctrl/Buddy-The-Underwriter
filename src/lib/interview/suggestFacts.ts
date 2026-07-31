// src/lib/interview/suggestFacts.ts
//
// SPEC-M1.1 — migrated onto the AI gateway. Uses the "structurer" role for
// its OpenAI-only chain (no Google fallback — matches the original
// provider-exclusive behavior) and its native json_schema structured
// output mode (gateway's callOpenAI already wraps whatever schema object
// is passed with `strict: true`, same as buildJsonSchema() below used to).
import { ALLOWED_FACT_KEYS } from "@/lib/interview/factKeys";
import { OPENAI_MINI } from "@/lib/ai/models";
import { runRole } from "@/lib/ai/gateway";

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function buildJsonSchema() {
  return {
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
  const model = process.env.OPENAI_FACT_SUGGEST_MODEL || OPENAI_MINI;

  const result = await runRole("structurer", {
    modelOverride: model,
    temperature: 0.1,
    maxOutputTokens: 600,
    purpose: "suggest_facts",
    systemInstruction: [
      "You extract candidate underwriting facts from a borrower utterance.",
      "Return ONLY facts explicitly stated in the text. No guessing.",
      "If a fact is ambiguous, do not include it.",
      "Prefer fewer, higher-quality suggestions.",
      "Use allowed field_key enum only.",
      "field_value should be JSON-typed (number/string/object/array) and match the statement.",
      "value_text can be a human-readable rendering if helpful.",
      "rationale must cite the exact portion (quote or tight paraphrase) supporting the fact.",
    ].join("\n"),
    prompt: `Borrower said:\n\n${turnText}`,
    responseSchema: buildJsonSchema(),
  });

  const textOut = result.text;

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
