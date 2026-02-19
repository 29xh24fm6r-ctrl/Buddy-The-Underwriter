import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mapGatekeeperDocTypeToEffectiveDocType } from "@/lib/gatekeeper/routing";
import { attachDocumentToSlot } from "./attachDocumentToSlot";
import type { GatekeeperDocType } from "@/lib/gatekeeper/types";

// ---------------------------------------------------------------------------
// Slot Auto-Fill — match classified docs to empty upload-group slots (UI-only)
//
// Architectural contract:
//   - Writes only to slot/upload-group tables (deal_document_slots attachments)
//   - Fire-and-forget — never blocks OCR/classify/extract/spreads
//   - Must NOT mutate deal_documents.canonical_type / routing_class
//   - Must NOT affect effectiveDocType or spreads/extract decisions
// ---------------------------------------------------------------------------

/**
 * Effective-type → slot required_doc_type mapping.
 *
 * Most map 1:1. FINANCIAL_STATEMENT is special: gatekeeper doesn't
 * distinguish IS vs BS, so we try both slot types (first empty wins).
 * The classifier may produce INCOME_STATEMENT or BALANCE_SHEET directly.
 */
function effectiveTypeToSlotDocTypes(effectiveType: string): string[] {
  switch (effectiveType) {
    case "IRS_BUSINESS":              // classifier raw type
    case "BUSINESS_TAX_RETURN":       // canonical type
      return ["BUSINESS_TAX_RETURN"];

    case "IRS_PERSONAL":              // classifier raw type
    case "PERSONAL_TAX_RETURN":       // canonical type
      return ["PERSONAL_TAX_RETURN"];

    case "PFS":                       // classifier raw type
    case "PERSONAL_FINANCIAL_STATEMENT": // canonical type
      return ["PERSONAL_FINANCIAL_STATEMENT"];

    case "T12":                       // legacy classifier → normalize to IS
    case "INCOME_STATEMENT":
      return ["INCOME_STATEMENT"];

    case "BALANCE_SHEET":
      return ["BALANCE_SHEET"];

    case "FINANCIAL_STATEMENT":       // gatekeeper umbrella → try both
      return ["BALANCE_SHEET", "INCOME_STATEMENT"];

    default:
      return [];
  }
}

export type AutoMatchResult = {
  matched: boolean;
  slotId?: string;
  reason?: string;
};

/**
 * @deprecated Replaced by Matching Engine v1 (src/lib/intake/matching/runMatch.ts).
 * Kept for rollback. Use runMatchForDocument() for new code.
 *
 * Core auto-match function — accepts effectiveDocType directly.
 *
 * Used by both the gatekeeper path (via wrapper) and the classify path
 * (processArtifact). Finds the best matching empty slot and attaches the doc.
 *
 * Rules:
 * - Only matches `status = 'empty'` slots (never replaces existing attachments)
 * - Year-based slots (BTR, PTR) require exact tax_year match
 * - Non-year slots (PFS, IS, BS) match on doc type alone
 * - FINANCIAL_STATEMENT tries BALANCE_SHEET then INCOME_STATEMENT (first empty)
 * - Fire-and-forget: failure never blocks the pipeline
 */
export async function autoMatchByEffectiveType(params: {
  dealId: string;
  bankId: string;
  documentId: string;
  effectiveDocType: string;
  taxYear: number | null;
}): Promise<AutoMatchResult> {
  const { dealId, bankId, documentId, effectiveDocType, taxYear } = params;

  const slotDocTypes = effectiveTypeToSlotDocTypes(effectiveDocType);

  if (slotDocTypes.length === 0) {
    return { matched: false, reason: "no_slot_types" };
  }

  const sb = supabaseAdmin();

  // Fetch empty slots for this deal matching the required doc types
  const { data: emptySlots } = await (sb as any)
    .from("deal_document_slots")
    .select("id, required_doc_type, required_tax_year, sort_order")
    .eq("deal_id", dealId)
    .eq("status", "empty")
    .in("required_doc_type", slotDocTypes)
    .order("sort_order", { ascending: true });

  if (!emptySlots || emptySlots.length === 0) {
    return { matched: false, reason: "no_empty_slots" };
  }

  // Find best match: prefer exact year match, then null-year slots
  const yearBased =
    effectiveDocType === "BUSINESS_TAX_RETURN" ||
    effectiveDocType === "IRS_BUSINESS" ||
    effectiveDocType === "PERSONAL_TAX_RETURN" ||
    effectiveDocType === "IRS_PERSONAL";

  let bestSlot: (typeof emptySlots)[0] | null = null;

  if (yearBased && taxYear != null) {
    // Exact year match required
    bestSlot =
      emptySlots.find(
        (s: any) => s.required_tax_year === taxYear,
      ) ?? null;
  } else {
    // Non-year slot: first empty match by sort_order (already ordered)
    bestSlot = emptySlots[0] ?? null;
  }

  if (!bestSlot) {
    return { matched: false, reason: "no_year_match" };
  }

  const result = await attachDocumentToSlot({
    dealId,
    bankId,
    slotId: bestSlot.id,
    documentId,
    attachedByRole: "system",
  });

  if (result.ok) {
    console.log("[autoMatchByEffectiveType] auto-filled slot", {
      dealId,
      documentId,
      slotId: bestSlot.id,
      effectiveDocType,
      taxYear,
    });
    return { matched: true, slotId: bestSlot.id };
  }

  return { matched: false, reason: "attach_failed" };
}

/**
 * Gatekeeper-path wrapper — converts gatekeeperDocType to effectiveDocType
 * and delegates to autoMatchByEffectiveType.
 *
 * Used by runGatekeeper.ts (step 6b) after stampDocument.
 */
export async function autoMatchDocToSlot(params: {
  dealId: string;
  bankId: string;
  documentId: string;
  gatekeeperDocType: GatekeeperDocType;
  gatekeeperTaxYear: number | null;
}): Promise<AutoMatchResult> {
  const { dealId, bankId, documentId, gatekeeperDocType, gatekeeperTaxYear } =
    params;

  // Skip UNKNOWN — nothing to match
  if (gatekeeperDocType === "UNKNOWN") {
    return { matched: false, reason: "unknown_type" };
  }

  const effectiveType =
    mapGatekeeperDocTypeToEffectiveDocType(gatekeeperDocType);

  return autoMatchByEffectiveType({
    dealId,
    bankId,
    documentId,
    effectiveDocType: effectiveType,
    taxYear: gatekeeperTaxYear,
  });
}
