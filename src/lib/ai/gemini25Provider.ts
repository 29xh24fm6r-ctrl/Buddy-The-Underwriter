/**
 * Gemini 2.5 Pro implementation of the AIProvider interface.
 *
 * Mirrors OpenAIProvider's behavior:
 * - generateRisk: risk grade, pricing explanation, factor analysis with citations
 * - generateMemo: structured credit memo sections with citations
 * - chatAboutDeal: credit committee Q&A with citations
 *
 * Uses gemini-2.5-pro via the generateContent endpoint with JSON mode.
 * No temperature support on Gemini 2.5 Pro thinking models — omit temperature.
 */

import "server-only";
import { z } from "zod";
import { RiskOutputSchema, MemoOutputSchema, CommitteeAnswerSchema } from "./schemas";
import type { AIProvider, RiskInput, RiskOutput, MemoInput, MemoOutput, CommitteeAnswer } from "./provider";
import { GEMINI_PRO } from "./models";

const GEMINI_25_PRO_MODEL = GEMINI_PRO;

function gemini25Url(apiKey: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_25_PRO_MODEL}:generateContent?key=${apiKey}`;
}

function evidenceRulesBlock() {
  return [
    "CITATION RULES (HARD):",
    "- You MUST ONLY cite EvidenceRef objects that are present in EVIDENCE_CATALOG.",
    "- If you cannot support a claim with the provided evidence catalog, omit the claim or mark it unsupported.",
    "- NEVER invent document IDs, page numbers, bbox coordinates, or excerpts.",
  ].join("\n");
}

async function geminiStructured<T>(args: {
  system: string;
  payload: unknown;
  schema: z.ZodType<T>;
  schemaName: string;
}): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const prompt =
    `${args.system}\n\n` +
    `Return ONLY valid JSON. No markdown. No backticks.\n` +
    `Match this schema name: ${args.schemaName}\n\n` +
    `INPUT:\n${JSON.stringify(args.payload, null, 2)}`;

  const resp = await fetch(gemini25Url(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        // Note: Gemini 2.5 Pro thinking models do not support temperature < 1
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`gemini25_error_${resp.status}: ${errText.slice(0, 200)}`);
  }

  const json = await resp.json();
  const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Parse + validate
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Try to extract first JSON object
    const start = text.indexOf("{");
    if (start === -1) throw new Error("gemini25_no_json_in_response");
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) { end = i; break; }
    }
    if (end === -1) throw new Error("gemini25_unbalanced_json");
    parsed = JSON.parse(text.slice(start, end + 1));
  }

  return args.schema.parse(parsed);
}

export class Gemini25Provider implements AIProvider {
  async generateRisk(input: RiskInput): Promise<RiskOutput> {
    const evidenceCatalog = (input.evidenceIndex ?? []).map((d, i) => ({
      kind: d.kind,
      sourceId: d.docId,
      label: d.label,
      index: i,
    }));

    return geminiStructured({
      schemaName: "RiskOutput",
      schema: RiskOutputSchema,
      system: [
        "You are Buddy, an underwriting copilot that produces explainable risk and pricing.",
        "Return ONLY valid JSON that matches the RiskOutput schema.",
        evidenceRulesBlock(),
        "",
        "OUTPUT STYLE:",
        "- grade: a bond-style grade string (e.g. 'B+', 'BB-', 'A').",
        "- baseRateBps and riskPremiumBps: integer basis points.",
        "- factors: concise underwriting-native labels, contribution roughly +/- normalized, confidence 0..1.",
        "- pricingExplain: list pricing adders with rationale and evidence if available.",
      ].join("\n"),
      payload: {
        DEAL: { dealId: input.dealId, dealSnapshot: input.dealSnapshot },
        EVIDENCE_CATALOG: evidenceCatalog,
        INSTRUCTIONS:
          "Generate explainable risk + pricing. Cite only from EVIDENCE_CATALOG by creating EvidenceRef objects.",
      },
    });
  }

  async generateMemo(input: MemoInput): Promise<MemoOutput> {
    return geminiStructured({
      schemaName: "MemoOutput",
      schema: MemoOutputSchema,
      system: [
        "You are Buddy, generating a credit memo from deal facts and an explainable risk run.",
        "Return ONLY valid JSON that matches the MemoOutput schema.",
        evidenceRulesBlock(),
        "",
        "MEMO RULES:",
        "- Write in a professional credit memo tone.",
        "- Keep paragraphs short; avoid fluff.",
        "- Put citations in citations[] per section; only cite evidence you were given.",
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

  async chatAboutDeal(input: {
    dealId: string;
    question: string;
    dealSnapshot: Record<string, any>;
    risk: RiskOutput | null;
    memo: string | null;
  }): Promise<CommitteeAnswer> {
    const catalog: unknown[] = [];
    if (input.risk) {
      catalog.push(...input.risk.factors.flatMap((f) => f.evidence ?? []));
      catalog.push(...input.risk.pricingExplain.flatMap((p) => p.evidence ?? []));
    }

    return geminiStructured({
      schemaName: "CommitteeAnswer",
      schema: CommitteeAnswerSchema,
      system: [
        "You are Buddy in Credit Committee Mode.",
        "Answer questions concisely and precisely; show your work with citations.",
        "Return ONLY valid JSON that matches the CommitteeAnswer schema.",
        evidenceRulesBlock(),
        "",
        "COMMITTEE RULES:",
        "- If asked 'why' or 'show evidence', cite the relevant evidence.",
        "- If you don't have the needed evidence, say what is missing and provide no invented citations.",
      ].join("\n"),
      payload: {
        DEAL: { dealId: input.dealId, dealSnapshot: input.dealSnapshot },
        QUESTION: input.question,
        RISK: input.risk,
        MEMO_TEXT: input.memo,
        EVIDENCE_CATALOG: catalog,
        INSTRUCTIONS:
          "Answer the question and cite only from EVIDENCE_CATALOG. If not possible, say what's missing.",
      },
    });
  }
}
