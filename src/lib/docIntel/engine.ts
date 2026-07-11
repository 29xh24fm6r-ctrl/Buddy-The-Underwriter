// src/lib/docIntel/engine.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/openai";
import { recordAiEvent } from "@/lib/ai/audit";

function nowIso() { return new Date().toISOString(); }

function normalizeForSpanCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Validate an LLM-reported evidence span against the real source text.
 *
 * The prompt tells Gemini "offsets must correspond to real substrings" but
 * nothing previously enforced that — a hallucinated span (out-of-bounds
 * offsets, or offsets whose text doesn't match the claimed label) would be
 * persisted to doc_intel_results as trusted evidence. This checks:
 *   1. start/end are integers with 0 <= start < end <= sourceText.length
 *   2. the substring at [start, end) is non-empty
 *   3. if a label was supplied, the substring is consistent with it
 *      (whitespace/case-normalized, substring-tolerant in either direction
 *      to allow for the LLM quoting a slightly longer/shorter phrase)
 */
function validateEvidenceSpan(
  span: { start?: unknown; end?: unknown; label?: unknown },
  sourceText: string,
): { verified: boolean; reason: string | null } {
  const start = Number(span?.start);
  const end = Number(span?.end);

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return { verified: false, reason: "non_integer_offsets" };
  }
  if (start < 0 || end <= start || end > sourceText.length) {
    return { verified: false, reason: "offsets_out_of_bounds" };
  }

  const actualText = sourceText.slice(start, end);
  if (!actualText.trim()) {
    return { verified: false, reason: "empty_span_text" };
  }

  const label = typeof span?.label === "string" ? span.label : "";
  if (label.trim()) {
    const normActual = normalizeForSpanCompare(actualText);
    const normLabel = normalizeForSpanCompare(label);
    if (
      normLabel.length > 0 &&
      !normActual.includes(normLabel) &&
      !normLabel.includes(normActual)
    ) {
      return { verified: false, reason: "label_text_mismatch" };
    }
  }

  return { verified: true, reason: null };
}

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

  // CRITICAL: verify every evidence span actually anchors to real source
  // text before it's persisted as trusted evidence. The prompt asks Gemini
  // not to fabricate offsets, but nothing enforced that — a hallucinated
  // span would otherwise be written to doc_intel_results unchecked.
  const sourceText = args.extractedText || "";
  const rawSpans: any[] = Array.isArray(ai.result?.evidence_spans)
    ? ai.result.evidence_spans.slice(0, 3)
    : [];
  const verifiedSpans = rawSpans.map((span) => {
    const { verified, reason } = validateEvidenceSpan(span, sourceText);
    return {
      ...span,
      evidence_verified: verified,
      ...(verified ? {} : { verification_failure_reason: reason }),
    };
  });

  const payloadEvidence = {
    evidence_spans: verifiedSpans,
    evidence: Array.isArray(ai.result?.evidence) ? ai.result.evidence.slice(0, 10) : [],
  };

  // If spans were offered but none of them survived verification, the
  // model's citations are not trustworthy — don't let the LLM-reported
  // confidence stand unchallenged.
  const anyUnverified = rawSpans.length > 0 && verifiedSpans.every((s) => !s.evidence_verified);
  const rawConfidence = Number(ai.result?.confidence ?? ai.confidence ?? 50);
  const confidence = anyUnverified ? Math.min(rawConfidence, 50) : rawConfidence;

  const up = await sb.from("doc_intel_results").upsert({
    deal_id: args.dealId,
    file_id: args.fileId,
    doc_type: ai.result?.doc_type || "Unknown",
    tax_year: ai.result?.tax_year ?? null,
    extracted_json: ai.result?.extracted ?? {},
    quality_json: ai.result?.quality ?? {},
    confidence,
    evidence_json: payloadEvidence,
    created_at: nowIso(),
  }, { onConflict: "deal_id,file_id" });

  if (up.error) throw up.error;

  return {
    ok: true,
    doc_type: ai.result?.doc_type || "Unknown",
    tax_year: ai.result?.tax_year ?? null,
    confidence,
    evidence: payloadEvidence,
  };
}
