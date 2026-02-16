import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mapGatekeeperDocTypeToEffectiveDocType } from "@/lib/gatekeeper/routing";
import { attachDocumentToSlot } from "./attachDocumentToSlot";
import type { GatekeeperDocType } from "@/lib/gatekeeper/types";

// ---------------------------------------------------------------------------
// Slot Auto-Fill — match gatekeeper-classified docs to empty slots
// ---------------------------------------------------------------------------

/**
 * Effective-type → slot required_doc_type mapping.
 *
 * Most map 1:1. FINANCIAL_STATEMENT is special: gatekeeper doesn't
 * distinguish IS vs BS, so we try both slot types (first empty wins).
 */
function effectiveTypeToSlotDocTypes(effectiveType: string): string[] {
  switch (effectiveType) {
    case "BUSINESS_TAX_RETURN":
      return ["BUSINESS_TAX_RETURN"];
    case "PERSONAL_TAX_RETURN":
      return ["PERSONAL_TAX_RETURN"];
    case "PERSONAL_FINANCIAL_STATEMENT":
      return ["PERSONAL_FINANCIAL_STATEMENT"];
    case "FINANCIAL_STATEMENT":
      // Gatekeeper lumps IS + BS; try both slot types
      return ["BALANCE_SHEET", "INCOME_STATEMENT"];
    default:
      return [];
  }
}

export type AutoMatchResult = {
  matched: boolean;
  slotId?: string;
};

/**
 * Auto-match a gatekeeper-classified document to an empty slot.
 *
 * Rules:
 * - Only matches `status = 'empty'` slots (never replaces existing attachments)
 * - Year-based slots (BTR, PTR) require exact tax_year match
 * - Non-year slots (PFS) match on doc type alone
 * - W2/K1/FORM_1099 map to PERSONAL_TAX_RETURN slots via effective type
 * - FINANCIAL_STATEMENT tries BALANCE_SHEET then INCOME_STATEMENT (first empty)
 * - NEEDS_REVIEW docs (UNKNOWN, errors) are never auto-matched
 * - Fire-and-forget: failure never blocks the pipeline
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
    return { matched: false };
  }

  const effectiveType =
    mapGatekeeperDocTypeToEffectiveDocType(gatekeeperDocType);
  const slotDocTypes = effectiveTypeToSlotDocTypes(effectiveType);

  if (slotDocTypes.length === 0) {
    return { matched: false };
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
    return { matched: false };
  }

  // Find best match: prefer exact year match, then null-year slots
  const yearBased =
    effectiveType === "BUSINESS_TAX_RETURN" ||
    effectiveType === "PERSONAL_TAX_RETURN";

  let bestSlot: (typeof emptySlots)[0] | null = null;

  if (yearBased && gatekeeperTaxYear != null) {
    // Exact year match required
    bestSlot =
      emptySlots.find(
        (s: any) => s.required_tax_year === gatekeeperTaxYear,
      ) ?? null;
  } else {
    // Non-year slot: first empty match by sort_order (already ordered)
    bestSlot = emptySlots[0] ?? null;
  }

  if (!bestSlot) {
    return { matched: false };
  }

  const result = await attachDocumentToSlot({
    dealId,
    bankId,
    slotId: bestSlot.id,
    documentId,
    attachedByRole: "system",
  });

  if (result.ok) {
    console.log("[autoMatchDocToSlot] auto-filled slot", {
      dealId,
      documentId,
      slotId: bestSlot.id,
      gatekeeperDocType,
      gatekeeperTaxYear,
    });
    return { matched: true, slotId: bestSlot.id };
  }

  return { matched: false };
}
