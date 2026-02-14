import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Phase 15 — Slot Attachment Validation
// ---------------------------------------------------------------------------

export type ValidateSlotParams = {
  documentId: string;
  classifiedDocType: string;
  classifiedTaxYear: number | null;
};

export type ValidateSlotResult = {
  validated: boolean;
  slotId: string;
  reason?: string;
};

/**
 * Canonical doc type mapping for validation.
 * The AI classifier may return a different name than the slot's required_doc_type.
 * This maps known equivalences.
 */
const DOC_TYPE_EQUIVALENCES: Record<string, string[]> = {
  BUSINESS_TAX_RETURN: ["BUSINESS_TAX_RETURN", "IRS_BUSINESS"],
  PERSONAL_TAX_RETURN: ["PERSONAL_TAX_RETURN", "IRS_PERSONAL"],
  PERSONAL_FINANCIAL_STATEMENT: ["PERSONAL_FINANCIAL_STATEMENT", "PFS"],
  INCOME_STATEMENT: ["INCOME_STATEMENT", "T12"],
  BALANCE_SHEET: ["BALANCE_SHEET"],
  RENT_ROLL: ["RENT_ROLL"],
  SCHEDULE_K1: ["SCHEDULE_K1", "K1"],
  // Phase 15B — SBA + acquisition doc types
  SBA_1919: ["SBA_1919", "SBA_FORM_1919"],
  SBA_413: ["SBA_413", "SBA_FORM_413", "PERSONAL_FINANCIAL_STATEMENT", "PFS"],
  DEBT_SCHEDULE: ["DEBT_SCHEDULE", "SBA_DEBT_SCHED", "SBA_DEBT_SCHEDULE"],
  BUSINESS_PLAN: ["BUSINESS_PLAN"],
  FINANCIAL_PROJECTIONS: ["FINANCIAL_PROJECTIONS", "PROJECTIONS"],
  RESUME: ["RESUME"],
  PURCHASE_AGREEMENT: ["PURCHASE_AGREEMENT", "LOI", "LETTER_OF_INTENT"],
  ENTITY_DOCS: ["ENTITY_DOCS", "OPERATING_AGREEMENT", "ARTICLES_OF_ORGANIZATION"],
};

function docTypesMatch(
  slotDocType: string,
  classifiedDocType: string,
): boolean {
  const slotNorm = slotDocType.toUpperCase().trim();
  const classNorm = classifiedDocType.toUpperCase().trim();

  if (slotNorm === classNorm) return true;

  const equivalences = DOC_TYPE_EQUIVALENCES[slotNorm];
  if (equivalences && equivalences.includes(classNorm)) return true;

  return false;
}

/**
 * Validate a slot attachment after AI classification.
 *
 * If the document has no slot (free-form upload), returns null.
 * If it has a slot, compares classified type + year against slot requirements.
 * Updates slot status to 'validated' or 'rejected'.
 */
export async function validateSlotAttachmentIfAny(
  params: ValidateSlotParams,
): Promise<ValidateSlotResult | null> {
  const { documentId, classifiedDocType, classifiedTaxYear } = params;
  const sb = supabaseAdmin();

  // 1. Look up slot_id from deal_documents
  const { data: doc } = await sb
    .from("deal_documents")
    .select("slot_id")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc?.slot_id) return null;

  const slotId = doc.slot_id as string;

  // 2. Fetch slot requirements
  const { data: slot } = await sb
    .from("deal_document_slots")
    .select("required_doc_type, required_tax_year")
    .eq("id", slotId)
    .maybeSingle();

  if (!slot) return null;

  // 3. Validate doc type
  const typeMatch = docTypesMatch(slot.required_doc_type, classifiedDocType);

  // 4. Validate tax year (only if slot requires a specific year)
  let yearMatch = true;
  if (slot.required_tax_year != null) {
    yearMatch = classifiedTaxYear === slot.required_tax_year;
  }

  // 5. Update slot status
  const validated = typeMatch && yearMatch;

  if (validated) {
    await sb
      .from("deal_document_slots")
      .update({ status: "validated", validation_reason: null } as any)
      .eq("id", slotId);

    return { validated: true, slotId };
  }

  // Build rejection reason
  const reasons: string[] = [];
  if (!typeMatch) {
    reasons.push(
      `Expected ${slot.required_doc_type}, got ${classifiedDocType}`,
    );
  }
  if (!yearMatch) {
    reasons.push(
      `Expected year ${slot.required_tax_year}, got ${classifiedTaxYear ?? "unknown"}`,
    );
  }
  const reason = reasons.join("; ");

  await sb
    .from("deal_document_slots")
    .update({ status: "rejected", validation_reason: reason } as any)
    .eq("id", slotId);

  console.warn("[validateSlotAttachment] rejected", {
    documentId,
    slotId,
    reason,
  });

  return { validated: false, slotId, reason };
}
