// src/lib/docIntel/engine.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/openai";
import { recordAiEvent } from "@/lib/ai/audit";

function nowIso() { return new Date().toISOString(); }

export async function analyzeDocument(args: {
  dealId: string;
  fileId: string;
  extractedText: string; // from OCR
}) {
  const schemaHint = `{
    "doc_type":"string",
    "tax_year": null,
    "extracted": {},
    "quality": {"legible":true,"complete":true,"signed":null,"all_pages_present":null},
    "confidence": 50,
    "evidence": [{"kind":"text_span","note":"short"}]
  }`;

  const ai = await aiJson<any>({
    scope: "doc_intel",
    action: "classify_extract_quality",
    system:
      "You are a senior loan documentation analyst. Classify document type, detect tax year if applicable, extract key fields, and assess quality. Do not invent. Use null when unknown.",
    user: `OCR_TEXT:\n${args.extractedText.slice(0, 12000)}\nReturn JSON exactly matching schema.`,
    jsonSchemaHint: schemaHint,
  });

  await recordAiEvent({
    deal_id: args.dealId,
    scope: "doc_intel",
    action: "classify_extract_quality",
    input_json: { dealId: args.dealId, fileId: args.fileId, textLen: args.extractedText.length },
    output_json: ai.ok ? ai.result : { error: ai.error },
    confidence: ai.ok ? ai.result?.confidence ?? ai.confidence : null,
    evidence_json: ai.ok ? ai.result?.evidence ?? null : null,
    requires_human_review: true,
  });

  if (!ai.ok) throw new Error(ai.error);

  const sb = supabaseAdmin();
  const up = await sb.from("doc_intel_results").upsert({
    deal_id: args.dealId,
    file_id: args.fileId,
    doc_type: ai.result?.doc_type || "Unknown",
    tax_year: ai.result?.tax_year ?? null,
    extracted_json: ai.result?.extracted ?? {},
    quality_json: ai.result?.quality ?? {},
    confidence: Number(ai.result?.confidence ?? ai.confidence ?? 50),
    evidence_json: ai.result?.evidence ?? null,
    created_at: nowIso(),
  }, { onConflict: "deal_id,file_id" });
  if (up.error) throw up.error;

  return ai.result;
}
