// src/lib/deals/autoMatchChecklistFromFilename.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Auto-match and update checklist items based on uploaded filename.
 * This bridges banker uploads to checklist auto-completion.
 * 
 * Matching logic:
 * - "business tax" or "1120" or "1065" → IRS_BUSINESS_2Y
 * - "personal tax" or "1040" → IRS_PERSONAL_2Y
 * - "personal financial" or "pfs" → PFS_CURRENT
 * - "rent roll" → RENT_ROLL
 * - "bank statement" → BANK_STMT_3M
 * - "ytd" or "year to date" → FIN_STMT_YTD
 * - etc.
 */

const FILENAME_PATTERNS: Array<{ pattern: RegExp; keys: string[] }> = [
  {
    pattern: /(business.*tax|1120|1065|schedule\s*c.*business)/i,
    keys: ["IRS_BUSINESS_2Y"],
  },
  {
    pattern: /(personal.*tax|1040(?!.*sch.*c))/i,
    keys: ["IRS_PERSONAL_2Y"],
  },
  {
    pattern: /(personal.*financial|pfs|statement.*financial.*personal)/i,
    keys: ["PFS_CURRENT"],
  },
  {
    pattern: /(rent.*roll|rental.*income.*schedule)/i,
    keys: ["RENT_ROLL"],
  },
  {
    pattern: /(bank.*statement|checking.*statement|savings.*statement)/i,
    keys: ["BANK_STMT_3M"],
  },
  {
    pattern: /(ytd|year.*to.*date|interim.*financial)/i,
    keys: ["FIN_STMT_YTD"],
  },
  {
    pattern: /(lease|leases|lease.*agreement)/i,
    keys: ["LEASES_TOP"],
  },
  {
    pattern: /(operating.*statement|property.*income)/i,
    keys: ["PROPERTY_T12"],
  },
  {
    pattern: /(insurance|property.*insurance)/i,
    keys: ["PROPERTY_INSURANCE"],
  },
  {
    pattern: /(ar.*aging|receivable.*aging|accounts.*receivable)/i,
    keys: ["AR_AGING"],
  },
  {
    pattern: /(ap.*aging|payable.*aging|accounts.*payable)/i,
    keys: ["AP_AGING"],
  },
  {
    pattern: /(sba.*1919|form.*1919)/i,
    keys: ["SBA_1919"],
  },
  {
    pattern: /(sba.*413|form.*413)/i,
    keys: ["SBA_413"],
  },
  {
    pattern: /(sba.*1244|form.*1244)/i,
    keys: ["SBA_1244"],
  },
  {
    pattern: /(debt.*schedule|liabilities|outstanding.*debt)/i,
    keys: ["DEBT_SCHEDULE", "SBA_DEBT_SCHED"],
  },
  {
    pattern: /(appraisal|valuation)/i,
    keys: ["APPRAISAL_IF_AVAILABLE"],
  },
];

export async function autoMatchChecklistFromFilename(params: {
  dealId: string;
  filename: string;
  fileId?: string;
}): Promise<{ matched: string[]; updated: number }> {
  const sb = supabaseAdmin();

  // Find matching checklist keys
  const matchedKeys: string[] = [];
  for (const { pattern, keys } of FILENAME_PATTERNS) {
    if (pattern.test(params.filename)) {
      matchedKeys.push(...keys);
    }
  }

  if (matchedKeys.length === 0) {
    return { matched: [], updated: 0 };
  }

  // Get existing checklist items for this deal
  const { data: items, error } = await sb
    .from("deal_checklist_items")
    .select("id, checklist_key, status")
    .eq("deal_id", params.dealId)
    .in("checklist_key", matchedKeys);

  if (error) {
    console.error("Error fetching checklist items:", error);
    return { matched: matchedKeys, updated: 0 };
  }

  if (!items || items.length === 0) {
    return { matched: matchedKeys, updated: 0 };
  }

  // Update items that are currently "missing"
  const toUpdate = items.filter((item) => item.status === "missing");
  if (toUpdate.length === 0) {
    return { matched: matchedKeys, updated: 0 };
  }

  const updates = toUpdate.map((item) => ({
    id: item.id,
    status: "received",
    received_at: new Date().toISOString(),
    received_file_id: params.fileId || null,
  }));

  const { error: updateError } = await sb
    .from("deal_checklist_items")
    .upsert(updates, { onConflict: "id" });

  if (updateError) {
    console.error("Error updating checklist items:", updateError);
    return { matched: matchedKeys, updated: 0 };
  }

  return { matched: matchedKeys, updated: toUpdate.length };
}
