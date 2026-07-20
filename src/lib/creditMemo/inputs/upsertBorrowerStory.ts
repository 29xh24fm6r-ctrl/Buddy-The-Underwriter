// Server-only upsert for the banker-certified borrower story.
//
// One row per deal (UNIQUE deal_id). Writes are gated by tenant — the
// caller must have already passed ensureDealBankAccess.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { scheduleReadinessRefresh } from "@/lib/deals/readiness/refreshDealReadiness";
import { buildMemoPeopleFromRows, sanitizeBorrowerStoryPatch } from "@/lib/creditMemo/trust/memoNarrativeTrust";
import type { NarrativeTrustWarning } from "@/lib/creditMemo/trust/memoNarrativeTrust";
import type { DealBorrowerStory } from "./types";

export type UpsertBorrowerStoryArgs = {
  dealId: string;
  // Partial — banker may save fields incrementally. Fields omitted are left
  // unchanged on existing rows; on INSERT they default to null.
  patch: Partial<
    Pick<
      DealBorrowerStory,
      | "business_description"
      | "revenue_model"
      | "products_services"
      | "customers"
      | "customer_concentration"
      | "competitive_position"
      | "growth_strategy"
      | "seasonality"
      | "key_risks"
      | "banker_notes"
      // SPEC-MEMO-INPUTS-INDUSTRY-CLASSIFICATION-FIELD-1
      | "industry_classification"
      | "naics_code"
      | "naics_description"
      // SPEC-NAICS-TOOL-MEMO-INPUTS-INTEGRATION-1
      | "naics_source"
      | "naics_confidence"
      // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
      | "legal_name"
      | "dba"
      | "website"
      | "hq_city"
      | "hq_state"
      | "banker_identity_summary"
      | "credit_elsewhere_documented"
      | "credit_elsewhere_finding"
      | "credit_elsewhere_narrative"
    >
  >;
  source?: DealBorrowerStory["source"];
  confidence?: number | null;
  /**
   * Optional pre-resolved bank scope. When supplied, skips ensureDealBankAccess
   * and uses this value directly. INTERNAL ONLY — caller must have already
   * verified tenant access. NEVER expose this parameter via an API route or
   * accept it from request body / query params / headers. Doing so creates
   * a tenant-isolation bypass.
   */
  trustedBankId?: string;
};

export type UpsertBorrowerStoryResult =
  | { ok: true; story: DealBorrowerStory; narrativeTrustWarnings?: NarrativeTrustWarning[] }
  | { ok: false; reason: "tenant_mismatch" | "persist_failed"; error?: string };

export async function upsertBorrowerStory(
  args: UpsertBorrowerStoryArgs,
): Promise<UpsertBorrowerStoryResult> {
  let bankId: string;
  if (args.trustedBankId) {
    bankId = args.trustedBankId;
  } else {
    const access = await ensureDealBankAccess(args.dealId);
    if (!access.ok) {
      return { ok: false, reason: "tenant_mismatch", error: access.error };
    }
    bankId = access.bankId;
  }

  const sb = supabaseAdmin();

  // Load known people for narrative trust sanitization
  const [existingRes, ownersRes, mgmtRes] = await Promise.all([
    (sb as any)
      .from("deal_borrower_story")
      .select("*")
      .eq("deal_id", args.dealId)
      .eq("bank_id", bankId)
      .maybeSingle(),
    (sb as any)
      .from("ownership_entities")
      .select("display_name, name, ownership_pct")
      .eq("deal_id", args.dealId)
      .limit(10),
    (sb as any)
      .from("deal_management_profiles")
      .select("person_name, ownership_pct")
      .eq("deal_id", args.dealId)
      .eq("bank_id", bankId)
      .limit(20),
  ]);

  const existing = existingRes.data;
  const people = buildMemoPeopleFromRows({
    ownerEntities: (ownersRes.data ?? []) as Array<{ display_name?: string | null; name?: string | null; ownership_pct?: number | null }>,
    managementProfiles: (mgmtRes.data ?? []) as Array<{ person_name?: string | null; ownership_pct?: number | null }>,
  });

  const now = new Date().toISOString();

  // Strip undefined keys so they don't overwrite existing values.
  const rawPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.patch)) {
    if (typeof v !== "undefined") rawPatch[k] = v === "" ? null : v;
  }

  // Sanitize narrative text fields before persistence
  const { patch: sanitizedPatch, warnings: narrativeTrustWarnings } =
    sanitizeBorrowerStoryPatch(rawPatch, people);
  const patch = sanitizedPatch;
  if (typeof args.source !== "undefined") patch.source = args.source;
  if (typeof args.confidence !== "undefined") patch.confidence = args.confidence;

  const row = {
    deal_id: args.dealId,
    bank_id: bankId,
    ...patch,
    updated_at: now,
  };

  if (existing) {
    const { data, error } = await (sb as any)
      .from("deal_borrower_story")
      .update(row)
      .eq("id", (existing as { id: string }).id)
      .select("*")
      .single();
    if (error || !data) {
      return { ok: false, reason: "persist_failed", error: error?.message };
    }
    scheduleReadinessRefresh({
      dealId: args.dealId,
      trigger: "borrower_story_updated",
    });
    return { ok: true, story: data as DealBorrowerStory, narrativeTrustWarnings };
  }

  const { data, error } = await (sb as any)
    .from("deal_borrower_story")
    .insert({ ...row, created_at: now })
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, reason: "persist_failed", error: error?.message };
  }
  scheduleReadinessRefresh({
    dealId: args.dealId,
    trigger: "borrower_story_updated",
  });
  return { ok: true, story: data as DealBorrowerStory, narrativeTrustWarnings };
}
