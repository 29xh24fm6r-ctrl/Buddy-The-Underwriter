// Server-only upsert for management/principal profiles.
//
// N rows per deal. Identified by id when present; otherwise creates a new
// row scoped to the deal's bank.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import type { DealManagementProfile } from "./types";

export type UpsertManagementProfileArgs = {
  dealId: string;
  profileId?: string;
  patch: Partial<
    Pick<
      DealManagementProfile,
      | "person_name"
      | "title"
      | "ownership_pct"
      | "years_experience"
      | "industry_experience"
      | "prior_business_experience"
      | "resume_summary"
      | "credit_relevance"
    >
  >;
  source?: DealManagementProfile["source"];
  confidence?: number | null;
};

export type UpsertManagementProfileResult =
  | { ok: true; profile: DealManagementProfile }
  | {
      ok: false;
      reason:
        | "tenant_mismatch"
        | "persist_failed"
        | "missing_person_name"
        | "not_found";
      error?: string;
    };

export async function upsertManagementProfile(
  args: UpsertManagementProfileArgs,
): Promise<UpsertManagementProfileResult> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;

  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.patch)) {
    if (typeof v !== "undefined") patch[k] = v === "" ? null : v;
  }
  if (typeof args.source !== "undefined") patch.source = args.source;
  if (typeof args.confidence !== "undefined") patch.confidence = args.confidence;

  if (args.profileId) {
    const { data: existing } = await (sb as any)
      .from("deal_management_profiles")
      .select("id, deal_id, bank_id")
      .eq("id", args.profileId)
      .maybeSingle();
    if (
      !existing ||
      (existing as { deal_id: string }).deal_id !== args.dealId ||
      (existing as { bank_id: string }).bank_id !== bankId
    ) {
      return { ok: false, reason: "not_found" };
    }

    const { data, error } = await (sb as any)
      .from("deal_management_profiles")
      .update({ ...patch, updated_at: now })
      .eq("id", args.profileId)
      .select("*")
      .single();
    if (error || !data) {
      return { ok: false, reason: "persist_failed", error: error?.message };
    }
    return { ok: true, profile: data as DealManagementProfile };
  }

  // INSERT path requires person_name (NOT NULL).
  const personName =
    typeof args.patch.person_name === "string"
      ? args.patch.person_name.trim()
      : "";
  if (personName.length === 0) {
    return { ok: false, reason: "missing_person_name" };
  }

  const { data, error } = await (sb as any)
    .from("deal_management_profiles")
    .insert({
      deal_id: args.dealId,
      bank_id: bankId,
      ...patch,
      person_name: personName,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, reason: "persist_failed", error: error?.message };
  }
  return { ok: true, profile: data as DealManagementProfile };
}

export async function deleteManagementProfile(args: {
  dealId: string;
  profileId: string;
}): Promise<{ ok: true } | { ok: false; reason: "tenant_mismatch" | "not_found"; error?: string }> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;

  const sb = supabaseAdmin();
  const { error, count } = await (sb as any)
    .from("deal_management_profiles")
    .delete({ count: "exact" })
    .eq("id", args.profileId)
    .eq("deal_id", args.dealId)
    .eq("bank_id", bankId);
  if (error) {
    return { ok: false, reason: "not_found", error: error.message };
  }
  if ((count ?? 0) === 0) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true };
}
