import { zodToJsonSchema } from "zod-to-json-schema";
import { getOpenAI, getModel, getTemp, getMaxOutputTokens } from "./openaiClient";
import type { AIProvider, RiskInput, RiskOutput, MemoInput, MemoOutput, CommitteeAnswer } from "./provider";
import { 
  RiskOutputSchema, 
  MemoOutputSchema, 
  CommitteeAnswerSchema,
  type RiskOutputT,
  type MemoOutputT,
  type CommitteeAnswerT,
} from "./schemas";

function jsonSchemaFor(name: string, schema: any) {
  // zod-to-json-schema returns a full JSON schema doc; OpenAI wants the schema object itself
  const js = zodToJsonSchema(schema, name);
  return js;
}

function evidenceRulesBlock() {
  return [
    "CITATION RULES (HARD):",
    "- You MUST ONLY cite EvidenceRef objects that are present in EVIDENCE_CATALOG (matching kind+sourceId and preferably page/bbox).",
    "- If you cannot support a claim with the provided evidence catalog, you must either (a) omit the claim, or (b) explicitly say it's unsupported and provide zero citations for that claim/section.",
    "- NEVER invent document IDs, page numbers, bbox coordinates, or excerpts.",
  ].join("\n");
}

function riskSystemPrompt() {
  return [
    "You are Buddy, an underwriting copilot that produces explainable risk and pricing.",
    "Return ONLY valid JSON that matches the provided schema.",
    evidenceRulesBlock(),
    "",
    "OUTPUT STYLE:",
    "- Factors: keep labels crisp and underwriting-native.",
    "- contribution: roughly normalized +/- values; confidence 0..1.",
    "- pricingExplain: list pricing adders with rationale and evidence if available.",
  ].join("\n");
}

function memoSystemPrompt() {
  return [
    "You are Buddy, generating a credit memo from deal facts and an explainable risk run.",
    "Return ONLY valid JSON that matches the provided schema.",
    evidenceRulesBlock(),
    "",
    "MEMO RULES:",
    "- Write in a professional credit memo tone.",
    "- Keep paragraphs short; avoid fluff.",
    "- Put citations in citations[] per section; only cite evidence you were given.",
    "- If evidence is insufficient for a section, keep it high-level and leave citations empty.",
  ].join("\n");
}

function committeeSystemPrompt() {
  return [
    "You are Buddy in Credit Committee Mode.",
    "Answer questions concisely and precisely; show your work with citations.",
    "Return ONLY valid JSON that matches the provided schema.",
    evidenceRulesBlock(),
    "",
    "COMMITTEE RULES:",
    "- If asked 'why' or 'show evidence', cite the relevant evidence.",
    "- If you don't have the needed evidence, say what is missing and provide no invented citations.",
  ].join("\n");
}

async function runStructured<T>(
  schemaName: string,
  schemaZod: any,
  system: string,
  userPayload: any
): Promise<T> {
  const client = getOpenAI();

  const jsonSchema = jsonSchemaFor(schemaName, schemaZod);

  const completion = await client.chat.completions.create({
    model: getModel(),
    temperature: getTemp(),
    max_tokens: getMaxOutputTokens(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(userPayload, null, 2) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        schema: jsonSchema,
        strict: true,
      },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned empty content");

  const parsed = JSON.parse(raw);
  const validated = schemaZod.parse(parsed);
  return validated as T;
}

export class OpenAIProvider implements AIProvider {
  async generateRisk(input: RiskInput): Promise<RiskOutput> {
    const evidenceCatalog = (input.evidenceIndex ?? []).map((d, i) => ({
      kind: d.kind,
      sourceId: d.docId,
      label: d.label,
      // NOTE: no page/bbox here; model may only cite what exists in catalog.
      // If you later add extracted spans/pages, include them here as EvidenceRef objects.
      index: i,
    }));

    const payload = {
      DEAL: { dealId: input.dealId, dealSnapshot: input.dealSnapshot },
      EVIDENCE_CATALOG: evidenceCatalog,
      INSTRUCTIONS:
        "Generate explainable risk + pricing. Cite only from EVIDENCE_CATALOG by creating EvidenceRef objects.",
    };

    return await runStructured<RiskOutput>(
      "RiskOutput",
      RiskOutputSchema,
      riskSystemPrompt(),
      payload
    );
  }

  async generateMemo(input: MemoInput): Promise<MemoOutput> {
    const payload = {
      DEAL: { dealId: input.dealId, dealSnapshot: input.dealSnapshot },
      RISK: input.risk,
      // Evidence catalog derived from risk factors + pricingExplain evidence
      // NOTE: these were already constrained previously; reusing is safe.
      EVIDENCE_CATALOG: [
        ...input.risk.factors.flatMap((f) => f.evidence ?? []),
        ...input.risk.pricingExplain.flatMap((p) => p.evidence ?? []),
      ],
      INSTRUCTIONS:
        "Generate a memo with sections and citations. Cite only from EVIDENCE_CATALOG.",
    };

    return await runStructured<MemoOutput>(
      "MemoOutput",
      MemoOutputSchema,
      memoSystemPrompt(),
      payload
    );
  }

  async chatAboutDeal(input: {
    dealId: string;
    question: string;
    dealSnapshot: Record<string, any>;
    risk: RiskOutput | null;
    memo: string | null;
  }) {
    const catalog: any[] = [];
    if (input.risk) {
      catalog.push(...input.risk.factors.flatMap((f) => f.evidence ?? []));
      catalog.push(...input.risk.pricingExplain.flatMap((p) => p.evidence ?? []));
    }

    const payload = {
      DEAL: { dealId: input.dealId, dealSnapshot: input.dealSnapshot },
      QUESTION: input.question,
      RISK: input.risk,
      MEMO_TEXT: input.memo,
      EVIDENCE_CATALOG: catalog,
      INSTRUCTIONS:
        "Answer the question and cite only from EVIDENCE_CATALOG. If not possible, say what's missing.",
    };

    return await runStructured<CommitteeAnswerT>(
      "CommitteeAnswer",
      CommitteeAnswerSchema,
      committeeSystemPrompt(),
      payload
    );
  }
}
