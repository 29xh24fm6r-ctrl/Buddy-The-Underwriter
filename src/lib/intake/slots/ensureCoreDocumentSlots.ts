import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Phase 15 — Core Document Slot Bootstrapper
// ---------------------------------------------------------------------------

export type CoreSlotDefinition = {
  slot_key: string;
  slot_group: string;
  required_doc_type: string;
  required_tax_year: number | null;
  required: boolean;
  sort_order: number;
};

import { computeTaxYears } from "./taxYears";
// Re-export for external consumers
export { computeTaxYears };

/**
 * Build the baseline slot definitions for a deal.
 * Returns 11 slots: 3 BTR + 3 PTR + 1 PFS + 1 IS + 1 BS
 */
export function buildCoreSlotDefinitions(now?: Date): CoreSlotDefinition[] {
  const taxYears = computeTaxYears(now);
  const slots: CoreSlotDefinition[] = [];
  let sortOrder = 0;

  // Business Tax Returns (3 years)
  for (const year of taxYears) {
    slots.push({
      slot_key: `BUSINESS_TAX_RETURN_${year}`,
      slot_group: "BUSINESS_TAX_RETURN",
      required_doc_type: "BUSINESS_TAX_RETURN",
      required_tax_year: year,
      required: true,
      sort_order: sortOrder++,
    });
  }

  // Personal Tax Returns (3 years, no owner at baseline)
  for (const year of taxYears) {
    slots.push({
      slot_key: `PERSONAL_TAX_RETURN_${year}`,
      slot_group: "PERSONAL_TAX_RETURN",
      required_doc_type: "PERSONAL_TAX_RETURN",
      required_tax_year: year,
      required: true,
      sort_order: sortOrder++,
    });
  }

  // PFS
  slots.push({
    slot_key: "PFS_CURRENT",
    slot_group: "PFS",
    required_doc_type: "PERSONAL_FINANCIAL_STATEMENT",
    required_tax_year: null,
    required: true,
    sort_order: sortOrder++,
  });

  // YTD Income Statement
  slots.push({
    slot_key: "INCOME_STATEMENT_YTD",
    slot_group: "INCOME_STATEMENT",
    required_doc_type: "INCOME_STATEMENT",
    required_tax_year: null,
    required: true,
    sort_order: sortOrder++,
  });

  // Current Balance Sheet
  slots.push({
    slot_key: "BALANCE_SHEET_CURRENT",
    slot_group: "BALANCE_SHEET",
    required_doc_type: "BALANCE_SHEET",
    required_tax_year: null,
    required: true,
    sort_order: sortOrder++,
  });

  return slots;
}

/**
 * Ensure document slots exist for a deal.
 *
 * Phase 15B: Delegates to the scenario-driven orchestrator which reads
 * deal_intake_scenario and dispatches to the appropriate slot policy.
 * Falls back to conventional (baseline 11 slots) when no scenario exists.
 *
 * Idempotent — uses UPSERT on (deal_id, slot_key).
 */
export async function ensureCoreDocumentSlots(params: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: boolean; slotsCreated: number; error?: string }> {
  const { ensureDeterministicSlotsForScenario } = await import(
    "./ensureDeterministicSlots"
  );
  const result = await ensureDeterministicSlotsForScenario(params);
  return {
    ok: result.ok,
    slotsCreated: result.slotsUpserted,
    error: result.error,
  };
}
