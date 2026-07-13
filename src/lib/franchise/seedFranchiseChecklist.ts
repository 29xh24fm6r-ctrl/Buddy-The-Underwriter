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
// Both are idempotent upserts keyed off a stable code, so re-linking the
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

export async function seedFranchiseChecklist(
  sb: SupabaseClient,
  params: { dealId: string; bankId: string; brandName: string },
): Promise<void> {
  const { dealId, bankId, brandName } = params;

  try {
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

    const { error: checklistErr } = await sb
      .from("deal_portal_checklist_items")
      .upsert(checklistRows, { onConflict: "deal_id,code" });

    if (checklistErr) {
      console.error("[seedFranchiseChecklist] checklist upsert failed", checklistErr);
    }
  } catch (error) {
    console.error("[seedFranchiseChecklist] checklist upsert threw", error);
  }

  try {
    const conditionRows = FRANCHISE_DOC_SPECS.map((spec) => ({
      deal_id: dealId,
      bank_id: bankId,
      title: spec.title,
      description: `${spec.description} Required because this deal is financing a ${brandName} franchise.`,
      category: "legal" as const,
      source: "system" as const,
      source_key: spec.conditionSourceKey,
      required_docs: [{ key: spec.checklistCode, label: spec.title, optional: false }],
    }));

    const { error: conditionsErr } = await sb
      .from("deal_conditions")
      .upsert(conditionRows, { onConflict: "deal_id,source,source_key" });

    if (conditionsErr) {
      console.error("[seedFranchiseChecklist] deal_conditions upsert failed", conditionsErr);
    }
  } catch (error) {
    console.error("[seedFranchiseChecklist] deal_conditions upsert threw", error);
  }
}
