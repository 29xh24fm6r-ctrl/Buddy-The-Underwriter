import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PersonalIncomeFact } from "./certification/certifiedPersonalIncome";
import {
  buildCertifiedPersonalIncomeYears,
  type PersonalIncomeYear,
  type PersonalIncomeAudit,
} from "./personalIncomeSelection";

// Re-export the rendered-row + audit types from the pure selection module so existing
// importers (types.ts, classicSpreadRenderer.ts, certifiedSpreadGateCore.ts) are unchanged.
export type {
  PersonalIncomeYear,
  PersonalIncomeAudit,
  PersonalIncomeSourceTrace,
  PersonalIncomeRejectionTrace,
} from "./personalIncomeSelection";

export type PersonalIncomeSection = {
  ownerName: string | null;
  years: PersonalIncomeYear[];
  /**
   * SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-CROSS-OWNER-CERTIFICATION-1 (Phase 3): certified
   * selection metadata explaining the selected source family and the competitors that were
   * dropped. Optional so existing consumers are unaffected.
   */
  audit?: PersonalIncomeAudit;
};

/**
 * Load personal income facts from deal_financial_facts and route them through the certified
 * cross-owner selector (Phase 3). Groups by tax year; returns years in ascending order.
 *
 * If ownerEntityId is provided, filters to that owner. Otherwise considers all personal-income
 * candidates for the deal (first guarantor found).
 */
export async function loadPersonalIncome(
  dealId: string,
  bankId: string,
  ownerEntityId?: string | null,
): Promise<PersonalIncomeSection> {
  const sb = supabaseAdmin();

  // SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-CROSS-OWNER-CERTIFICATION-1 (Phase 3):
  // Load BOTH the weak deterministic PERSONAL_INCOME family AND the strong
  // PERSONAL_TAX_RETURN / DEAL-owned family so the certified selector can prefer
  // source-backed tax-return values over weak micro-facts. Scope by the personal-tax
  // canonical family (source_canonical_type=PERSONAL_TAX_RETURN) OR fact_type=PERSONAL_INCOME
  // so business (e.g. C-corp) tax returns sharing a key like TAXABLE_INCOME are NOT pulled in.
  // Lifecycle filtering (superseded / rejected / system_invalidated / null) and quality/stub
  // dropping are owned by the pure certified selector (buildCertifiedPersonalIncomeYears), which
  // also fixes the prior `.neq("resolution_status","rejected")` null-drop and lets a strong
  // fact outrank a weak deterministic micro-fact.
  let query = (sb as any)
    .from("deal_financial_facts")
    .select(
      "id, fact_key, fact_value_num, fact_period_end, owner_type, owner_entity_id, source_document_id, source_canonical_type, fact_type, confidence, provenance, is_superseded, resolution_status",
    )
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .or("fact_type.eq.PERSONAL_INCOME,source_canonical_type.eq.PERSONAL_TAX_RETURN")
    .not("fact_value_num", "is", null)
    .order("fact_period_end", { ascending: true });

  if (ownerEntityId) {
    query = query.eq("owner_entity_id", ownerEntityId);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    return { ownerName: null, years: [] };
  }

  const facts: PersonalIncomeFact[] = (data as any[]).map((r) => ({
    id: r.id ?? null,
    fact_key: r.fact_key,
    fact_value_num: r.fact_value_num !== null ? Number(r.fact_value_num) : null,
    fact_period_end: r.fact_period_end ?? null,
    owner_type: r.owner_type,
    owner_entity_id: r.owner_entity_id ?? null,
    source_document_id: r.source_document_id ?? null,
    source_canonical_type: r.source_canonical_type ?? null,
    fact_type: r.fact_type ?? null,
    confidence: r.confidence !== null && r.confidence !== undefined ? Number(r.confidence) : null,
    extractor: r.provenance?.extractor ?? null,
    is_superseded: r.is_superseded ?? null,
    resolution_status: r.resolution_status ?? null,
  }));

  const { years, audit } = buildCertifiedPersonalIncomeYears(facts, {
    ownerEntityId: ownerEntityId ?? null,
  });

  return { ownerName: null, years, audit };
}
