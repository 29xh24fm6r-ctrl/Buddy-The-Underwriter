import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Legacy Claude AI extractor — DEPRECATED
//
// This function is ONLY used by the legacy LLM-based extractors
// (incomeStatementExtractor.ts, balanceSheetExtractor.ts, etc.)
// which are gated behind DETERMINISTIC_EXTRACTORS_ENABLED=false.
//
// Once deterministic extractors are fully validated, this file and all
// legacy *Extractor.ts files should be deleted.
//
// DO NOT import this from any deterministic extractor.
// ---------------------------------------------------------------------------

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const MAX_OCR_CHARS = 25_000;

/**
 * @deprecated Use deterministic extractors in `./deterministic/` instead.
 * Set DETERMINISTIC_EXTRACTORS_ENABLED=true to use the new pipeline.
 * This function will be removed once deterministic extractors are validated.
 */
export async function callClaudeForExtraction(args: {
  systemPrompt: string;
  ocrText: string;
  maxTokens?: number;
}): Promise<Record<string, unknown>> {
  const anthropic = new Anthropic();

  const truncated =
    args.ocrText.length > MAX_OCR_CHARS
      ? args.ocrText.slice(0, MAX_OCR_CHARS) + "\n\n[... truncated ...]"
      : args.ocrText;

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: args.maxTokens ?? 4096,
    messages: [
      {
        role: "user",
        content: `${args.systemPrompt}\n\nDocument content:\n---\n${truncated}\n---\n\nRespond with JSON only.`,
      },
    ],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in Claude response");
  }

  return JSON.parse(jsonMatch[0]);
}
