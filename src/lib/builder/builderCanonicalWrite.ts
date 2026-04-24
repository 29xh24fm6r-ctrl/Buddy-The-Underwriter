import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuilderSectionKey, DealSectionData, PartiesSectionData, StorySectionData } from "./builderTypes";
import { sanitizeEntityName } from "@/lib/ownership/sanitizeEntityName";

/**
 * Write-through from builder sections to canonical tables.
 * Best-effort — never throws. All errors are logged.
 */
export async function writeBuilderCanonical(
  dealId: string,
  sectionKey: BuilderSectionKey,
  data: Record<string, unknown>,
  sb: SupabaseClient,
): Promise<void> {
  try {
    switch (sectionKey) {
      case "deal":
        await writeDealCanonical(dealId, data as Partial<DealSectionData>, sb);
        break;
      case "business":
        await writeBusinessCanonical(dealId, data, sb);
        break;
      case "parties":
        await writePartiesCanonical(dealId, data as Partial<PartiesSectionData>, sb);
        break;
      case "story":
        await writeStoryCanonical(dealId, data as Partial<StorySectionData>, sb);
        break;
      default:
        break;
    }
  } catch (err: any) {
    console.error("[builderCanonicalWrite] error", {
      dealId,
      sectionKey,
      code: err?.code,
      details: err?.details,
      hint: err?.hint,
    });
  }
}

/** deal section → deals.loan_amount */
async function writeDealCanonical(
  dealId: string,
  data: Partial<DealSectionData>,
  sb: SupabaseClient,
): Promise<void> {
  if (data.requested_amount != null && data.requested_amount > 0) {
    const { error } = await sb
      .from("deals")
      .update({ loan_amount: data.requested_amount })
      .eq("id", dealId);
    if (error) {
      console.error("[builderCanonicalWrite] deals.loan_amount update failed", {
        dealId,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
  }

  // Also upsert loan_request record so hasLoanRequest blocker clears
  if (data.loan_type || data.loan_purpose || data.requested_amount) {
    // Get bank_id for the deal (required column)
    const { data: dealRow } = await sb.from("deals").select("bank_id").eq("id", dealId).maybeSingle();
    const bankId = dealRow?.bank_id ?? null;

    // Builder uses lowercase loan_type keys; deal_loan_requests.product_type requires uppercase
    const PRODUCT_TYPE_MAP: Record<string, string> = {
      equipment: 'EQUIPMENT',
      term_loan: 'TERM_SECURED',
      line_of_credit: 'LINE_OF_CREDIT',
      sba_7a: 'SBA_7A',
      sba_504: 'SBA_504',
      cre_mortgage: 'CRE_TERM',
      ci_loan: 'C_AND_I_TERM',
      construction: 'CONSTRUCTION',
      vehicle: 'VEHICLE',
      other: 'OTHER',
    };

    const mappedProductType = data.loan_type
      ? (PRODUCT_TYPE_MAP[data.loan_type as string] ?? (data.loan_type as string).toUpperCase())
      : null;

    const { error } = await sb.from("deal_loan_requests").upsert({
      deal_id: dealId,
      bank_id: bankId,
      request_number: 1,                          // canonical first request
      product_type: mappedProductType,
      loan_purpose: data.loan_purpose ?? null,
      requested_amount: data.requested_amount ?? null,
      source: "banker",
      status: "draft",
    }, { onConflict: "deal_id,request_number" });
    if (error) {
      console.error("[builderCanonicalWrite] deal_loan_requests upsert failed", {
        dealId,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
  }
}

/** business section → deals.name (if not already set) */
async function writeBusinessCanonical(
  dealId: string,
  data: Record<string, unknown>,
  sb: SupabaseClient,
): Promise<void> {
  const legalName = data.legal_entity_name;
  if (typeof legalName !== "string" || !legalName.trim()) return;

  const { data: existing } = await sb
    .from("deals")
    .select("name")
    .eq("id", dealId)
    .maybeSingle();

  if (!existing?.name) {
    const { error } = await sb
      .from("deals")
      .update({ name: legalName.trim() })
      .eq("id", dealId);
    if (error) {
      console.error("[builderCanonicalWrite] deals.name update failed", {
        dealId,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
  }
}

/** parties section → ensureOwnerEntity for each owner */
async function writePartiesCanonical(
  dealId: string,
  data: Partial<PartiesSectionData>,
  sb: SupabaseClient,
): Promise<void> {
  const owners = data.owners ?? [];
  for (const owner of owners) {
    if (!owner.full_legal_name?.trim()) continue;
    await ensureOwnerEntity(sb, dealId, owner.full_legal_name.trim());
  }
}

/**
 * Ensure an ownership_entities row exists for this deal and name.
 * Uses display_name as the conflict target — idempotent.
 * Same pattern as Phase 49 extractFactsFromDocument.
 */
async function ensureOwnerEntity(
  sb: SupabaseClient,
  dealId: string,
  displayName: string,
  entityType: "individual" | "entity" = "individual",
): Promise<string | null> {
  const cleanName = sanitizeEntityName(displayName);
  if (!cleanName) return null;

  try {
    const { data: existing } = await sb
      .from("ownership_entities")
      .select("id")
      .eq("deal_id", dealId)
      .eq("display_name", cleanName)
      .maybeSingle();
    if (existing?.id) return String(existing.id);

    const { data: created } = await sb
      .from("ownership_entities")
      .insert({ deal_id: dealId, display_name: cleanName, entity_type: entityType })
      .select("id")
      .maybeSingle();
    return created?.id ? String(created.id) : null;
  } catch {
    return null;
  }
}

/** Story section → deal_memo_overrides (sequential select-then-update/insert, merge) */
async function writeStoryCanonical(
  dealId: string,
  data: Partial<StorySectionData>,
  sb: SupabaseClient,
): Promise<void> {
  // Map builder story field keys → memo override keys
  const fieldMap: Record<string, string> = {
    loan_purpose_narrative: "use_of_proceeds",
    management_qualifications: "principal_background",
    competitive_position: "competitive_position",
    known_weaknesses: "key_weaknesses",
    deal_strengths: "key_strengths",
    committee_notes: "committee_notes",
  };

  // Build the new overrides from non-empty story fields
  const newOverrides: Record<string, string> = {};
  for (const [builderKey, memoKey] of Object.entries(fieldMap)) {
    const val = data[builderKey as keyof StorySectionData];
    if (typeof val === "string" && val.trim()) {
      newOverrides[memoKey] = val.trim();
    }
  }

  if (Object.keys(newOverrides).length === 0) return;

  // Get bank_id from deal
  const { data: dealRow } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .maybeSingle();

  const bankId = dealRow?.bank_id;
  if (!bankId) return;

  // Sequential select-then-update/insert (never replace full JSONB)
  const { data: existing } = await sb
    .from("deal_memo_overrides")
    .select("id, overrides")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();

  const currentOverrides =
    (existing as Record<string, unknown> | null)?.overrides as Record<string, unknown> ?? {};
  const merged = { ...currentOverrides, ...newOverrides };

  if ((existing as Record<string, unknown> | null)?.id) {
    const { error } = await sb
      .from("deal_memo_overrides")
      .update({ overrides: merged, updated_at: new Date().toISOString() })
      .eq("id", (existing as any).id);
    if (error) {
      console.error("[builderCanonicalWrite] deal_memo_overrides update failed", {
        dealId,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
  } else {
    const { error } = await sb
      .from("deal_memo_overrides")
      .insert({ deal_id: dealId, bank_id: bankId, overrides: merged });
    if (error) {
      console.error("[builderCanonicalWrite] deal_memo_overrides insert failed", {
        dealId,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
  }
}
