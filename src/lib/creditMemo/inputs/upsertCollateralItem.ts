// Server-only upsert for normalized collateral items.
//
// Augments the pre-existing deal_collateral_items rows with the columns
// the memo input layer needs (market/appraised value, advance_rate, owner,
// valuation evidence, source document, confidence + review flag).
// Identified by id when present.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import type { DealCollateralItem } from "./types";

const REVIEW_CONFIDENCE_THRESHOLD = 0.85;

export type UpsertCollateralItemArgs = {
  dealId: string;
  itemId?: string;
  patch: Partial<
    Pick<
      DealCollateralItem,
      | "collateral_type"
      | "description"
      | "owner_name"
      | "market_value"
      | "appraised_value"
      | "discounted_value"
      | "advance_rate"
      | "lien_position"
      | "valuation_date"
      | "valuation_source"
      | "source_document_id"
      | "confidence"
    >
  >;
  // Banker can override the auto-computed review flag.
  requiresReviewOverride?: boolean;
};

export type UpsertCollateralItemResult =
  | { ok: true; item: DealCollateralItem }
  | {
      ok: false;
      reason:
        | "tenant_mismatch"
        | "persist_failed"
        | "missing_required_fields"
        | "not_found";
      error?: string;
    };

export async function upsertCollateralItem(
  args: UpsertCollateralItemArgs,
): Promise<UpsertCollateralItemResult> {
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

  // Derive requires_review from confidence unless caller overrode.
  const confidence =
    typeof args.patch.confidence === "number" ? args.patch.confidence : null;
  if (typeof args.requiresReviewOverride === "boolean") {
    patch.requires_review = args.requiresReviewOverride;
  } else if (confidence !== null) {
    patch.requires_review = confidence < REVIEW_CONFIDENCE_THRESHOLD;
  }

  if (args.itemId) {
    const { data: existing } = await (sb as any)
      .from("deal_collateral_items")
      .select("id, deal_id, bank_id")
      .eq("id", args.itemId)
      .maybeSingle();
    if (!existing || (existing as { deal_id: string }).deal_id !== args.dealId) {
      return { ok: false, reason: "not_found" };
    }
    const existingBankId = (existing as { bank_id: string | null }).bank_id;
    if (existingBankId !== null && existingBankId !== bankId) {
      return { ok: false, reason: "tenant_mismatch" };
    }

    const { data, error } = await (sb as any)
      .from("deal_collateral_items")
      .update({ ...patch, bank_id: bankId, updated_at: now })
      .eq("id", args.itemId)
      .select("*")
      .single();
    if (error || !data) {
      return { ok: false, reason: "persist_failed", error: error?.message };
    }
    return { ok: true, item: normalize(data) };
  }

  const collateralType =
    typeof args.patch.collateral_type === "string"
      ? args.patch.collateral_type.trim()
      : "";
  const description =
    typeof args.patch.description === "string"
      ? args.patch.description.trim()
      : "";
  if (collateralType.length === 0 || description.length === 0) {
    return { ok: false, reason: "missing_required_fields" };
  }

  const { data, error } = await (sb as any)
    .from("deal_collateral_items")
    .insert({
      deal_id: args.dealId,
      bank_id: bankId,
      collateral_type: collateralType,
      description,
      ...patch,
      // Mirror legacy columns so the deal builder UI keeps working.
      item_type: collateralType,
      estimated_value:
        args.patch.appraised_value ?? args.patch.market_value ?? null,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, reason: "persist_failed", error: error?.message };
  }
  return { ok: true, item: normalize(data) };
}

function normalize(row: any): DealCollateralItem {
  return {
    id: row.id,
    deal_id: row.deal_id,
    bank_id: row.bank_id ?? null,
    collateral_type: row.collateral_type ?? row.item_type ?? null,
    description: row.description ?? null,
    owner_name: row.owner_name ?? null,
    market_value: numberOrNull(row.market_value),
    appraised_value: numberOrNull(row.appraised_value ?? row.estimated_value),
    discounted_value: numberOrNull(row.discounted_value),
    advance_rate: numberOrNull(row.advance_rate),
    lien_position:
      typeof row.lien_position === "string"
        ? row.lien_position
        : typeof row.lien_position === "number"
        ? String(row.lien_position)
        : null,
    valuation_date: row.valuation_date ?? row.appraisal_date ?? null,
    valuation_source: row.valuation_source ?? null,
    source_document_id: row.source_document_id ?? null,
    confidence: numberOrNull(row.confidence),
    requires_review: row.requires_review === true,
  };
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
