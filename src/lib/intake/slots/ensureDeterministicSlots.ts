import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { IntakeScenario, BusinessStage } from "./types";
import { generateSlotsForScenario } from "./policies";

// ---------------------------------------------------------------------------
// Phase 15B — Deterministic Slot Orchestrator
// ---------------------------------------------------------------------------

/**
 * Load the intake scenario for a deal.
 * Returns null if no scenario exists (legacy/conventional deal).
 */
export async function loadIntakeScenario(
  dealId: string,
): Promise<IntakeScenario | null> {
  const sb = supabaseAdmin();
  const { data } = await (sb as any)
    .from("deal_intake_scenario")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!data) return null;

  return {
    product_type: data.product_type,
    borrower_business_stage: (data.borrower_business_stage ?? "EXISTING") as BusinessStage,
    has_business_tax_returns: data.has_business_tax_returns ?? true,
    has_financial_statements: data.has_financial_statements ?? true,
    has_projections: data.has_projections ?? false,
    entity_age_months: data.entity_age_months ?? null,
  };
}

/** Default scenario for conventional deals without explicit scenario data. */
export const CONVENTIONAL_FALLBACK: IntakeScenario = {
  product_type: "CONVENTIONAL",
  borrower_business_stage: "EXISTING",
  has_business_tax_returns: true,
  has_financial_statements: true,
  has_projections: false,
  entity_age_months: null,
};

/**
 * Ensure deterministic document slots for a deal based on its intake scenario.
 *
 * If no scenario exists, falls back to the conventional (Phase 15 baseline) policy.
 * Idempotent — uses UPSERT on (deal_id, slot_key).
 *
 * Stale-slot pruning: removes slots whose slot_key is NOT in the new policy set,
 * but ONLY if the slot has status 'empty' (no doc attached yet).
 */
export async function ensureDeterministicSlotsForScenario(params: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: boolean; slotsUpserted: number; error?: string }> {
  const { dealId, bankId } = params;
  const sb = supabaseAdmin();

  const scenario = await loadIntakeScenario(dealId);
  const effectiveScenario = scenario ?? CONVENTIONAL_FALLBACK;

  const definitions = generateSlotsForScenario(effectiveScenario);

  if (definitions.length === 0) {
    console.error("[ensureDeterministicSlots] policy returned 0 slots", {
      dealId,
      scenario: effectiveScenario,
    });
    return { ok: false, slotsUpserted: 0, error: "policy_returned_zero_slots" };
  }

  const rows = definitions.map((def) => ({
    deal_id: dealId,
    bank_id: bankId,
    slot_key: def.slot_key,
    slot_group: def.slot_group,
    required: def.required,
    required_doc_type: def.required_doc_type,
    required_tax_year: def.required_tax_year,
    owner_id: null,
    owner_display_name: null,
    status: "empty",
    sort_order: def.sort_order,
    slot_mode: def.slot_mode,
    interactive_kind: def.interactive_kind,
    help_title: def.help_title ?? null,
    help_reason: def.help_reason ?? null,
    help_examples: def.help_examples ?? null,
    help_alternatives: def.help_alternatives ?? null,
  }));

  const { data, error } = await (sb as any)
    .from("deal_document_slots")
    .upsert(rows, { onConflict: "deal_id,slot_key", ignoreDuplicates: false })
    .select("id");

  if (error) {
    console.error("[ensureDeterministicSlots] upsert failed", {
      dealId,
      error: error.message,
    });
    return { ok: false, slotsUpserted: 0, error: error.message };
  }

  // Prune stale empty slots (key not in new policy + status === "empty")
  const activeKeys = new Set(definitions.map((d) => d.slot_key));

  const { data: existingSlots } = await (sb as any)
    .from("deal_document_slots")
    .select("id, slot_key, status")
    .eq("deal_id", dealId);

  const staleIds = (existingSlots ?? [])
    .filter((s: any) => !activeKeys.has(s.slot_key) && s.status === "empty")
    .map((s: any) => s.id);

  if (staleIds.length > 0) {
    await (sb as any)
      .from("deal_document_slots")
      .delete()
      .in("id", staleIds);
  }

  console.log("[ensureDeterministicSlots] slots ensured", {
    dealId,
    upserted: data?.length ?? 0,
    pruned: staleIds.length,
    product: effectiveScenario.product_type,
    stage: effectiveScenario.borrower_business_stage,
  });

  return { ok: true, slotsUpserted: data?.length ?? 0 };
}
