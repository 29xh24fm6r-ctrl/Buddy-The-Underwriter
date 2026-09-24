import "server-only";

// src/lib/franchise/seedFranchiseChecklist.ts
// Called whenever a franchise brand is linked to a deal. Makes the
// franchise-specific document requirements actually visible to the
// borrower and the bank, instead of only living in feasibility scoring.
//
// Writes to two independent systems:
//  - deal_portal_checklist_items: what /portal/[token]/checklist renders
//    to the borrower (grouped by group_name).
//  - deal_conditions: the banker-facing Conditions-to-Close list.
// Both are idempotent writes keyed off a stable code, so re-linking the
// same or a different brand does not create duplicates.

import type { SupabaseClient } from "@supabase/supabase-js";

type FranchiseDocSpec = {
  checklistCode: string;
  conditionSourceKey: string;
  title: string;
  description: string;
  matchHints: string[];
};

const FRANCHISE_DOC_SPECS: FranchiseDocSpec[] = [
  {
    checklistCode: "FRANCHISE_DISCLOSURE_DOCUMENT",
    conditionSourceKey: "franchise_fdd",
    title: "Franchise Disclosure Document (FDD)",
    description: "The most recent FDD issued by the franchisor, including all amendments.",
    matchHints: ["franchise disclosure document", "fdd"],
  },
  {
    checklistCode: "FRANCHISE_AGREEMENT",
    conditionSourceKey: "franchise_agreement",
    title: "Franchise Agreement",
    description: "The signed or to-be-signed franchise agreement with the franchisor.",
    matchHints: ["franchise agreement"],
  },
  {
    checklistCode: "SBA_FRANCHISE_ADDENDUM",
    conditionSourceKey: "franchise_addendum",
    title: "SBA Franchise Addendum",
    description: "Completed SBA addendum to the franchise agreement (SBA Form 2462), required for franchise financing.",
    matchHints: ["franchise addendum", "sba addendum", "form 2462"],
  },
];

const CHECKLIST_GROUP = "Franchise Documents";

/** PostgREST cannot infer the partial (deal_id,source,source_key) index for
 * an upsert without its predicate. Update only this tenant's existing row,
 * insert when absent, and recover a concurrent insert's unique violation.
 * Never reset status, verified documents, or other lender review evidence. */
async function saveCondition(sb: SupabaseClient, row: Record<string, any>): Promise<boolean> {
  const update = () => sb.from("deal_conditions").update(row)
    .eq("deal_id", row.deal_id).eq("bank_id", row.bank_id)
    .eq("source", row.source).eq("source_key", row.source_key)
    .select("id").maybeSingle();
  const existing = await update();
  if (existing.error) return false;
  if (existing.data) return true;
  const inserted = await sb.from("deal_conditions").insert(row).select("id").single();
  if (!inserted.error) return Boolean(inserted.data);
  if (inserted.error.code !== "23505") return false;
  const raced = await update();
  return !raced.error && Boolean(raced.data);
}

export async function seedFranchiseChecklist(
  sb: SupabaseClient,
  params: { dealId: string; bankId: string; brandName: string },
): Promise<{ ok: boolean }> {
  const { dealId, bankId, brandName } = params;
  try {
    const deal = await sb.from("deals").select("id").eq("id", dealId).eq("bank_id", bankId).maybeSingle();
    if (deal.error || !deal.data) return { ok: false };
    const checklistRows = FRANCHISE_DOC_SPECS.map((spec, index) => ({
      deal_id: dealId,
      code: spec.checklistCode,
      title: spec.title,
      description: `${spec.description} Required because this deal is financing a ${brandName} franchise.`,
      group_name: CHECKLIST_GROUP,
      sort_order: 100 + index,
      match_hints: spec.matchHints,
      required: true,
    }));
    const checklist = await sb.from("deal_portal_checklist_items")
      .upsert(checklistRows, { onConflict: "deal_id,code" });
    if (checklist.error) return { ok: false };
    const results = await Promise.all(FRANCHISE_DOC_SPECS.map(spec => saveCondition(sb, {
      deal_id: dealId,
      bank_id: bankId,
      title: spec.title,
      description: `${spec.description} Required because this deal is financing a ${brandName} franchise.`,
      category: "legal",
      source: "system",
      source_key: spec.conditionSourceKey,
      required_docs: [{ key: spec.checklistCode, label: spec.title, optional: false }],
    })));
    return { ok: results.every(Boolean) };
  } catch (error) {
    console.error("[seedFranchiseChecklist] requirements unavailable", error);
    return { ok: false };
  }
}
