import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/openai";

export type BorrowerExtraction = {
  legalName: string | null;
  entityType: string | null;
  einMasked: string | null;
  address: string | null;
  stateOfFormation: string | null;
  sourceDocId: string | null;
  confidence: number;
};

export function maskEin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 4) return null;
  const last4 = digits.slice(-4);
  return `XX-XXX${last4}`;
}

export function inferEntityTypeFromText(text: string): string | null {
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  if (t.includes("form 1120s") || t.includes("1120-s") || t.includes("1120 s")) return "S-Corp";
  if (t.includes("form 1120")) return "Corp";
  if (t.includes("form 1065")) return "Partnership";
  if (t.includes("schedule c")) return "Sole Prop";
  if (t.includes("form 1040")) return "Individual";
  if (t.includes("limited liability company") || t.includes("llc")) return "LLC";
  if (t.includes("s corporation") || t.includes("s-corp")) return "S-Corp";
  if (t.includes("c corporation") || t.includes("c-corp")) return "Corp";
  if (t.includes("partnership")) return "Partnership";
  if (t.includes("sole proprietorship")) return "Sole Prop";
  return null;
}

function normalizeEntityType(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value || "").trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower.includes("llc")) return "LLC";
  if (lower.includes("s-corp") || lower.includes("s corporation") || lower.includes("scorp")) return "S-Corp";
  if (lower.includes("c-corp") || lower.includes("c corporation") || lower.includes("corp")) return "Corp";
  if (lower.includes("partnership")) return "Partnership";
  if (lower.includes("sole") || lower.includes("propriet")) return "Sole Prop";
  if (lower.includes("individual") || lower.includes("person")) return "Individual";
  return v;
}

export async function extractBorrowerFromDocs(args: {
  dealId: string;
  bankId: string;
}): Promise<BorrowerExtraction | null> {
  const sb = supabaseAdmin();

  const { data: docs } = await sb
    .from("deal_documents")
    .select("id, document_type, original_filename, storage_path")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .limit(50);

  const docIds = (docs ?? []).map((d: any) => String(d.id));
  if (!docIds.length) return null;

  const { data: ocrRows } = await sb
    .from("document_ocr_results")
    .select("attachment_id, extracted_text")
    .eq("deal_id", args.dealId)
    .in("attachment_id", docIds)
    .limit(50);

  const ocrByDoc = new Map<string, string>();
  for (const row of ocrRows ?? []) {
    const id = String((row as any).attachment_id || "");
    const text = String((row as any).extracted_text || "");
    if (id && text) ocrByDoc.set(id, text);
  }

  const samples = (docs ?? [])
    .map((d: any) => {
      const docId = String(d.id);
      const text = ocrByDoc.get(docId) || "";
      return {
        docId,
        documentType: d.document_type ?? null,
        filename: d.original_filename ?? d.storage_path ?? null,
        text: text.slice(0, 6000),
      };
    })
    .filter((d: any) => d.text);

  if (!samples.length) return null;

  const schemaHint = `{
    "legalName": null,
    "entityType": null,
    "ein": null,
    "address": null,
    "stateOfFormation": null,
    "sourceDocId": null,
    "confidence": 70
  }`;

  const ai = await aiJson<any>({
    scope: "intake",
    action: "extract_borrower",
    system:
      "You extract borrower identity from OCR text. Return JSON only. " +
      "Use null when unknown. Prefer legal name as it appears on tax forms.",
    user: JSON.stringify({ dealId: args.dealId, docs: samples }, null, 2),
    jsonSchemaHint: schemaHint,
  });

  const aiResult = ai.ok ? ai.result : null;
  const bestText = samples[0]?.text ?? "";

  const inferredEntity = normalizeEntityType(aiResult?.entityType) ?? inferEntityTypeFromText(bestText);
  const legalName = aiResult?.legalName ? String(aiResult.legalName).trim() : null;
  const einMasked = maskEin(aiResult?.ein);
  const address = aiResult?.address ? String(aiResult.address).trim() : null;
  const stateOfFormation = aiResult?.stateOfFormation
    ? String(aiResult.stateOfFormation).trim()
    : null;

  return {
    legalName: legalName || null,
    entityType: inferredEntity || null,
    einMasked,
    address,
    stateOfFormation,
    sourceDocId: aiResult?.sourceDocId ? String(aiResult.sourceDocId) : samples[0]?.docId ?? null,
    confidence: ai.ok ? Number(aiResult?.confidence ?? ai.confidence ?? 65) : 0,
  };
}
