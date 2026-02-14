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

/** Tax-return slot types eligible for year auto-adjustment. */
const TAX_RETURN_SLOT_DOC_TYPES = new Set([
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
]);

function isTaxReturnSlotDocType(docType: string): boolean {
  return TAX_RETURN_SLOT_DOC_TYPES.has(docType.toUpperCase().trim());
}

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

  // 2. Fetch slot requirements (include deal_id for sibling query)
  const { data: slot } = await sb
    .from("deal_document_slots")
    .select("deal_id, required_doc_type, required_tax_year")
    .eq("id", slotId)
    .maybeSingle();

  if (!slot) return null;

  const dealId = slot.deal_id as string;

  // 3. Validate doc type
  const typeMatch = docTypesMatch(slot.required_doc_type, classifiedDocType);

  // 4. Year handling: auto-adjust for tax-return slots only
  let yearAdjusted = false;
  if (
    typeMatch &&
    slot.required_tax_year != null &&
    classifiedTaxYear != null &&
    classifiedTaxYear !== slot.required_tax_year &&
    isTaxReturnSlotDocType(slot.required_doc_type)
  ) {
    yearAdjusted = true;
  }

  // 5. Update slot status
  if (typeMatch) {
    // Type matches → validate (auto-adjust year if needed)
    const updates: Record<string, any> = {
      status: "validated",
      validation_reason: null,
    };

    if (yearAdjusted) {
      updates.required_tax_year = classifiedTaxYear;

      let reasonText = `Year auto-adjusted from ${slot.required_tax_year} to ${classifiedTaxYear}`;

      // Detect duplicate year among sibling slots of same doc type
      const { data: siblings } = await sb
        .from("deal_document_slots")
        .select("id")
        .eq("deal_id", dealId)
        .eq("required_doc_type", slot.required_doc_type)
        .eq("required_tax_year", classifiedTaxYear)
        .neq("id", slotId);

      if (siblings && siblings.length > 0) {
        reasonText += " (duplicate year)";
      }

      updates.validation_reason = reasonText;

      console.log("[validateSlotAttachment] year auto-adjusted", {
        documentId,
        slotId,
        dealId,
        from: slot.required_tax_year,
        to: classifiedTaxYear,
        duplicateYear: siblings && siblings.length > 0,
      });
    }

    await sb
      .from("deal_document_slots")
      .update(updates)
      .eq("id", slotId);

    return { validated: true, slotId };
  }

  // Type mismatch → reject
  const reason = `Expected ${slot.required_doc_type}, got ${classifiedDocType}`;

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
