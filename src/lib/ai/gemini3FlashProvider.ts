/**
 * Gemini 3 Flash implementation of the AIProvider interface.
 *
 * Replaces OpenAIProvider for generateRisk and generateMemo.
 * Uses gemini-3-flash-preview via the Gemini generateContent endpoint with JSON mode.
 *
 * Key behavioral differences from gemini-2.0-flash:
 * - Dynamic thinking enabled by default (uses thinking_level param, not temperature)
 * - thinking_level="medium" is the default here: balances depth vs latency for credit reasoning
 * - Thought signatures are auto-handled for single-turn calls (no multi-turn history needed)
 * - No temperature param — omit it entirely to avoid API errors
 */

import "server-only";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  RiskOutputSchema,
  MemoOutputSchema,
  CommitteeAnswerSchema,
} from "./schemas";
import type {
  AIProvider,
  RiskInput,
  RiskOutput,
  MemoInput,
  MemoOutput,
  CommitteeAnswer,
} from "./provider";

export const GEMINI_3_FLASH_MODEL = "gemini-3-flash-preview";

function gemini3FlashUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_3_FLASH_MODEL}:generateContent?key=${apiKey}`;
}

function evidenceRulesBlock(): string {
  return [
    "CITATION RULES (HARD):",
    "- You MUST ONLY cite EvidenceRef objects that exist in EVIDENCE_CATALOG.",
    "- Match by kind + sourceId. Never invent document IDs, page numbers, bbox, or excerpts.",
    "- If you cannot support a claim with the provided evidence catalog, omit the claim or mark it unsupported.",
  ].join("\n");
}

async function gemini3Structured<T>(args: {
  system: string;
  payload: unknown;
  schema: z.ZodType<T>;
  schemaName: string;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
}): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const thinkingLevel = args.thinkingLevel ?? "minimal";

  // Generate the JSON schema so Gemini knows exact field names and types.
  // $refStrategy: "none" inlines all definitions — no $ref wrapping.
  const jsonSchema = zodToJsonSchema(args.schema as any, { $refStrategy: "none" });
  const { $schema: _unused, ...cleanSchema } = jsonSchema as any;

  const prompt =
    `${args.system}\n\n` +
    `Return ONLY valid JSON. No markdown. No backticks. No commentary.\n\n` +
    `INPUT:\n${JSON.stringify(args.payload, null, 2)}`;

  const resp = await fetch(gemini3FlashUrl(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: cleanSchema,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel },
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`gemini3flash_error_${resp.status}: ${errText.slice(0, 300)}`);
  }

  const json = await resp.json();
  // Strip thought signature parts — only keep non-thought text parts
  const text: string = json?.candidates?.[0]?.content?.parts
    ?.filter((p: { thought?: boolean }) => !p.thought)
    ?.map((p: { text?: string }) => p.text ?? "")
    ?.join("") ?? "";

  // Parse + validate
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Extract first balanced {...} object from text
    const start = text.indexOf("{");
    if (start === -1) throw new Error("gemini3flash_no_json_in_response");
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) { end = i; break; }
    }
    if (end === -1) throw new Error("gemini3flash_unbalanced_json");
    parsed = JSON.parse(text.slice(start, end + 1));
  }

  // Gemini responseSchema sometimes JSON-encodes nested array items as strings.
  // Recursively unwrap any string values that are valid JSON objects/arrays
  // before Zod validation.
  function unwrapJsonStrings(val: unknown): unknown {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          return unwrapJsonStrings(JSON.parse(trimmed));
        } catch {
          return val;
        }
      }
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(unwrapJsonStrings);
    }
    if (val !== null && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = unwrapJsonStrings(v);
      }
      return out;
    }
    return val;
  }

  return args.schema.parse(unwrapJsonStrings(parsed));
}

export class Gemini3FlashProvider implements AIProvider {
  async generateRisk(input: RiskInput): Promise<RiskOutput> {
    const evidenceCatalog = (input.evidenceIndex ?? []).map((d, i) => ({
      kind: d.kind,
      sourceId: d.docId,
      label: d.label,
      index: i,
    }));

    return gemini3Structured({
      schemaName: "RiskOutput",
      schema: RiskOutputSchema,
      thinkingLevel: "minimal",
      system: [
        "You are Buddy, an underwriting copilot that produces explainable risk and pricing.",
        "Return ONLY valid JSON that matches the RiskOutput schema.",
        evidenceRulesBlock(),
        "",
        "OUTPUT STYLE:",
        "- grade: bond-style grade string (e.g. 'B+', 'BB-', 'A').",
        "- baseRateBps and riskPremiumBps: integer basis points.",
        "- factors: concise underwriting-native labels, contribution roughly +/- normalized, confidence 0..1.",
        "- pricingExplain: named adders with rationale and evidence if available.",
      ].join("\n"),
      payload: {
        DEAL: { dealId: input.dealId, dealSnapshot: input.dealSnapshot },
        EVIDENCE_CATALOG: evidenceCatalog,
        INSTRUCTIONS:
          "Generate explainable risk + pricing. Cite only from EVIDENCE_CATALOG.",
      },
    });
  }

  async generateMemo(input: MemoInput): Promise<MemoOutput> {
    return gemini3Structured({
      schemaName: "MemoOutput",
      schema: MemoOutputSchema,
      thinkingLevel: "minimal",
      system: [
        "You are Buddy, generating a credit memo from deal facts and an explainable risk run.",
        "Return ONLY valid JSON that matches the MemoOutput schema.",
        evidenceRulesBlock(),
        "",
        "MEMO RULES:",
        "- Professional credit memo tone. Short paragraphs. No fluff.",
        "- Put citations in citations[] per section. Only cite evidence you were given.",
        "- If evidence is insufficient for a section, keep it high-level and leave citations empty.",
      ].join("\n"),
      payload: {
        DEAL: { dealId: input.dealId, dealSnapshot: input.dealSnapshot },
        RISK: input.risk,
        EVIDENCE_CATALOG: [
          ...input.risk.factors.flatMap((f) => f.evidence ?? []),
          ...input.risk.pricingExplain.flatMap((p) => p.evidence ?? []),
        ],
        INSTRUCTIONS:
          "Generate a memo with sections and citations. Cite only from EVIDENCE_CATALOG.",
      },
    });
  }

  async chatAboutDeal(_input: {
    dealId: string;
    question: string;
    dealSnapshot: Record<string, any>;
    risk: RiskOutput | null;
    memo: string | null;
  }): Promise<CommitteeAnswer> {
    // chatAboutDeal remains on OpenAI for now — evaluated separately in Phase 26
    throw new Error(
      "Gemini3FlashProvider.chatAboutDeal: not implemented — route to OpenAIProvider"
    );
  }
}
