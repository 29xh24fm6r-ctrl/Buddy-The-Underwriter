// Server-only upsert for the banker-certified borrower story.
//
// One row per deal (UNIQUE deal_id). Writes are gated by tenant — the
// caller must have already passed ensureDealBankAccess.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { scheduleReadinessRefresh } from "@/lib/deals/readiness/refreshDealReadiness";
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
    >
  >;
  source?: DealBorrowerStory["source"];
  confidence?: number | null;
};

export type UpsertBorrowerStoryResult =
  | { ok: true; story: DealBorrowerStory }
  | { ok: false; reason: "tenant_mismatch" | "persist_failed"; error?: string };

export async function upsertBorrowerStory(
  args: UpsertBorrowerStoryArgs,
): Promise<UpsertBorrowerStoryResult> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;

  const sb = supabaseAdmin();

  const { data: existing } = await (sb as any)
    .from("deal_borrower_story")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("bank_id", bankId)
    .maybeSingle();

  const now = new Date().toISOString();

  // Strip undefined keys so they don't overwrite existing values.
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.patch)) {
    if (typeof v !== "undefined") patch[k] = v === "" ? null : v;
  }
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
    return { ok: true, story: data as DealBorrowerStory };
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
  return { ok: true, story: data as DealBorrowerStory };
}
