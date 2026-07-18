import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuilderSectionKey, DealSectionData, PartiesSectionData, StorySectionData } from "./builderTypes";
import { sanitizeEntityName } from "@/lib/ownership/sanitizeEntityName";

export type BuilderCanonicalWriteResult = {
  ownerEntityIds?: Array<{ id: string; ownership_entity_id: string }>;
};

/**
 * Write-through from builder sections to canonical tables.
 * Best-effort — never throws. All errors are logged.
 */
export async function writeBuilderCanonical(
  dealId: string,
  sectionKey: BuilderSectionKey,
  data: Record<string, unknown>,
  sb: SupabaseClient,
): Promise<BuilderCanonicalWriteResult> {
  try {
    switch (sectionKey) {
      case "deal":
        await writeDealCanonical(dealId, data as Partial<DealSectionData>, sb);
        break;
      case "business":
        await writeBusinessCanonical(dealId, data, sb);
        break;
      case "parties": {
        const result = await writePartiesCanonical(dealId, data as Partial<PartiesSectionData>, sb);
        return { ownerEntityIds: result.ownerEntityIds };
      }
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
  return {};
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

/** business section → deals.name (if not already set) + deals.operating_company_* (direct overwrite) */
async function writeBusinessCanonical(
  dealId: string,
  data: Record<string, unknown>,
  sb: SupabaseClient,
): Promise<void> {
  const legalName = data.legal_entity_name;
  if (typeof legalName === "string" && legalName.trim()) {
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

  await writeOperatingCompanyCanonical(dealId, data, sb);
}

/**
 * SBA 504 dual-entity structure — business.is_eligible_passive_company +
 * the operating_company_* fields live on deals, not borrowers (a 1:1
 * relationship with the deal, not a new table). Deliberate overwrite,
 * same reasoning as writePartiesCanonical: this is direct banker input,
 * not a probabilistic merge, so the form's current value wins — but only
 * for keys actually present in this PATCH, so an unset field here never
 * blanks out a value populated elsewhere.
 */
async function writeOperatingCompanyCanonical(
  dealId: string,
  data: Record<string, unknown>,
  sb: SupabaseClient,
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (data.is_eligible_passive_company !== undefined) update.is_eligible_passive_company = Boolean(data.is_eligible_passive_company);
  if (data.operating_company_legal_name !== undefined) update.operating_company_legal_name = data.operating_company_legal_name || null;
  if (data.operating_company_address !== undefined) update.operating_company_address = data.operating_company_address || null;
  if (data.operating_company_dba !== undefined) update.operating_company_dba = data.operating_company_dba || null;
  if (data.operating_company_legal_structure !== undefined) update.operating_company_legal_structure = data.operating_company_legal_structure || null;
  if (data.operating_company_tax_id !== undefined) update.operating_company_tax_id = data.operating_company_tax_id || null;
  if (data.operating_company_duns_number !== undefined) update.operating_company_duns_number = data.operating_company_duns_number || null;
  if (data.operating_company_contact_name !== undefined) update.operating_company_contact_name = data.operating_company_contact_name || null;
  if (data.operating_company_email !== undefined) update.operating_company_email = data.operating_company_email || null;
  if (data.operating_company_phone !== undefined) update.operating_company_phone = data.operating_company_phone || null;
  if (data.operating_company_website !== undefined) update.operating_company_website = data.operating_company_website || null;

  if (Object.keys(update).length === 0) return;
  const { error } = await sb.from("deals").update(update).eq("id", dealId);
  if (error) {
    console.error("[builderCanonicalWrite] deals.operating_company_* update failed", {
      dealId,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
  }
}

/**
 * parties section → ensureOwnerEntity + sync every structured field onto
 * that row (title/ownership_pct/dob/ssn_last4/home address). Previously
 * this only ensured the row existed by name — a banker filling out
 * OwnerDrawer by hand (the manual builder path, as opposed to
 * conversational/voice intake's propagateBorrowerFacts.ts, which already
 * writes these columns) had everything past the owner's name silently
 * stop at the deal_builder_sections JSON blob and never reach
 * ownership_entities — the table every SBA form renderer queries
 * directly. Returns the client-id -> ownership_entity_id mapping so the
 * builder UI can learn the real ID (needed to call the full-SSN vault
 * endpoint, which requires it).
 *
 * Deliberate overwrite, not fill-if-null: this is a human directly
 * editing the record (unlike voice-extraction's probabilistic merge), so
 * the form's current value wins — but only for keys the owner object
 * actually carries, so an unset field here never blanks out a value
 * populated by the other intake path.
 */
async function writePartiesCanonical(
  dealId: string,
  data: Partial<PartiesSectionData>,
  sb: SupabaseClient,
): Promise<{ ownerEntityIds: Array<{ id: string; ownership_entity_id: string }> }> {
  const owners = data.owners ?? [];
  const ownerEntityIds: Array<{ id: string; ownership_entity_id: string }> = [];

  for (const owner of owners) {
    if (!owner.full_legal_name?.trim()) continue;
    const ownershipEntityId = await ensureOwnerEntity(sb, dealId, owner.full_legal_name.trim());
    if (!ownershipEntityId) continue;
    ownerEntityIds.push({ id: owner.id, ownership_entity_id: ownershipEntityId });

    const update: Record<string, unknown> = {};
    if (owner.title !== undefined) update.title = owner.title || null;
    if (owner.ownership_pct !== undefined) update.ownership_pct = owner.ownership_pct ?? null;
    if (owner.dob !== undefined) update.date_of_birth = owner.dob || null;
    if (owner.ssn_last4 !== undefined) update.tax_id_last4 = owner.ssn_last4 || null;
    if (owner.home_address !== undefined) update.home_address_street = owner.home_address || null;
    if (owner.home_city !== undefined) update.home_address_city = owner.home_city || null;
    if (owner.home_state !== undefined) update.home_address_state = owner.home_state || null;
    if (owner.home_zip !== undefined) update.home_address_zip = owner.home_zip || null;

    if (Object.keys(update).length === 0) continue;
    const { error } = await sb.from("ownership_entities").update(update).eq("id", ownershipEntityId);
    if (error) {
      console.error("[builderCanonicalWrite] ownership_entities field sync failed", {
        dealId,
        ownershipEntityId,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }
  }

  return { ownerEntityIds };
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
