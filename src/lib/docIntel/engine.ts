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
    "quality": {
      "legible": true,
      "complete": null,
      "signed": null,
      "notes": []
    },
    "evidence_spans":[
      {
        "attachment_id":"${args.fileId}",
        "start": 0,
        "end": 0,
        "label": "string",
        "confidence": 80
      }
    ],
    "evidence":[
      {
        "kind":"string",
        "note":"string"
      }
    ],
    "confidence": 75
  }`;

  const system =
    "You are a senior credit underwriter document analyst. " +
    "Classify the document type, detect tax year if present, extract key structured fields when possible, " +
    "and assess quality (legible/complete/signed). " +
    "CRITICAL: Return valid JSON only. " +
    "CRITICAL: Provide evidence_spans with character offsets (start/end) into the provided extracted text. " +
    "Offsets must point to a short phrase that supports doc_type and/or tax_year and/or any notable quality issue. " +
    "Return 1 to 3 evidence_spans max. If uncertain, return an empty array.";

  const user =
    `Attachment ID: ${args.fileId}\n\n` +
    `EXTRACTED_TEXT_START\n` +
    `${(args.extractedText || "").slice(0, 30000)}\n` +
    `EXTRACTED_TEXT_END\n\n` +
    `Rules:\n` +
    `- evidence_spans.start/end must be character offsets within the provided extracted text.\n` +
    `- highlight spans should be short (10–120 chars).\n` +
    `- do not fabricate text; offsets must correspond to real substrings.\n`;

  const ai = await aiJson<any>({
    scope: "doc_intel",
    action: "classify_extract_quality",
    system,
    user,
    jsonSchemaHint: schemaHint,
  });

  await recordAiEvent({
    deal_id: args.dealId,
    scope: "doc_intel",
    action: "classify_extract_quality",
    input_json: { fileId: args.fileId, textLen: (args.extractedText || "").length },
    output_json: ai.ok ? ai.result : { error: ai.error },
    confidence: ai.ok ? Number(ai.result?.confidence ?? ai.confidence ?? 50) : null,
    evidence_json: ai.ok ? { evidence_spans: ai.result?.evidence_spans ?? [], evidence: ai.result?.evidence ?? [] } : null,
    requires_human_review: true,
  });

  if (!ai.ok) throw new Error(ai.error);

  const sb = supabaseAdmin();

  const payloadEvidence = {
    evidence_spans: Array.isArray(ai.result?.evidence_spans) ? ai.result.evidence_spans.slice(0, 3) : [],
    evidence: Array.isArray(ai.result?.evidence) ? ai.result.evidence.slice(0, 10) : [],
  };

  const up = await sb.from("doc_intel_results").upsert({
    deal_id: args.dealId,
    file_id: args.fileId,
    doc_type: ai.result?.doc_type || "Unknown",
    tax_year: ai.result?.tax_year ?? null,
    extracted_json: ai.result?.extracted ?? {},
    quality_json: ai.result?.quality ?? {},
    confidence: Number(ai.result?.confidence ?? ai.confidence ?? 50),
    evidence_json: payloadEvidence,
    created_at: nowIso(),
  }, { onConflict: "deal_id,file_id" });

  if (up.error) throw up.error;

  return {
    ok: true,
    doc_type: ai.result?.doc_type || "Unknown",
    tax_year: ai.result?.tax_year ?? null,
    confidence: Number(ai.result?.confidence ?? ai.confidence ?? 50),
    evidence: payloadEvidence,
  };
}
