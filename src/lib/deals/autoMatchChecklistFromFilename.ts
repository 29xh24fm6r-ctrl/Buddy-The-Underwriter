// src/lib/deals/autoMatchChecklistFromFilename.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

const AUTO_MATCH_CHECKLIST_VERSION = "2026-01-09-intel-only-default";

function normDocType(x: string) {
  return String(x || "")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();
}

function parseTaxYear(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  if (n < 1900 || n > 2100) return null;
  return Math.trunc(n);
}

function isPlausiblyRecentTaxYear(year: number | null) {
  if (!year) return true; // If unknown, don't block match
  const nowYear = new Date().getFullYear();
  // Keep it permissive: accept last ~6 years to avoid false negatives.
  return year >= nowYear - 6 && year <= nowYear + 1;
}

function checklistKeysFromDocIntel(docTypeRaw: string, taxYearRaw: any): string[] {
  const dt = normDocType(docTypeRaw);
  const taxYear = parseTaxYear(taxYearRaw);

  // If tax year is clearly stale, don't auto-resolve tax-return-driven checklist.
  const okYear = isPlausiblyRecentTaxYear(taxYear);

  // Canonical mapping to deal_checklist_items.checklist_key
  // Keep mapping conservative and deterministic, but tolerate natural AI doc_type strings.
  // Examples seen/expected: BusinessTaxReturn, PersonalTaxReturn, BankStatements, FinancialStatement.
  const dtLoose = dt;

  if (
    dtLoose === "PFS" ||
    dtLoose === "SBA_413" ||
    dtLoose.includes("PERSONAL_FINANCIAL") ||
    dtLoose.includes("PERSONAL_FINANCIAL_STATEMENT")
  ) {
    return ["PFS_CURRENT", "SBA_413"];
  }

  if (dtLoose.includes("BUSINESS") && dtLoose.includes("TAX")) {
    return okYear ? ["IRS_BUSINESS_3Y"] : [];
  }

  if (dtLoose.includes("PERSONAL") && dtLoose.includes("TAX")) {
    return okYear ? ["IRS_PERSONAL_3Y"] : [];
  }

  if (["IRS_1040", "K1", "IRS_PERSONAL"].includes(dt)) {
    return okYear ? ["IRS_PERSONAL_3Y"] : [];
  }

  if (["IRS_1065", "IRS_1120", "IRS_1120S", "IRS_BUSINESS"].includes(dt)) {
    return okYear ? ["IRS_BUSINESS_3Y"] : [];
  }

  if (
    dt === "FINANCIAL_STATEMENT" ||
    dt === "INCOME_STATEMENT" ||
    dt === "BALANCE_SHEET" ||
    dtLoose.includes("FINANCIAL")
  ) {
    // Only map when we know WHICH statement.
    if (dt === "INCOME_STATEMENT") return ["FIN_STMT_PL_YTD"];
    if (dt === "BALANCE_SHEET") return ["FIN_STMT_BS_YTD"];
    return [];
  }

  if (dt === "BANK_STATEMENT" || dtLoose.includes("BANK") && dtLoose.includes("STATEMENT")) {
    return ["BANK_STMT_3M"];
  }

  if (dt === "AR_AGING" || dt === "ACCOUNTS_RECEIVABLE_AGING") return ["AR_AGING"];
  if (dt === "AP_AGING" || dt === "ACCOUNTS_PAYABLE_AGING") return ["AP_AGING"];

  if (dt === "LEASE" || dt === "LEASE_AGREEMENT") return ["LEASES_TOP"];

  if (dt === "SBA_1919") return ["SBA_1919"];
  if (dt === "SBA_912") return ["SBA_912"];
  if (dt === "SBA_1244") return ["SBA_1244"];
  if (dt === "SBA_DEBT_SCHED" || dt === "DEBT_SCHEDULE") return ["SBA_DEBT_SCHED"];

  return [];
}

/**
 * Auto-match and update checklist items based on uploaded filename.
 * This bridges banker uploads to checklist auto-completion.
 * 
 * Matching logic:
 * - "business tax" or "1120" or "1065" → IRS_BUSINESS_3Y
 * - "personal tax" or "1040" → IRS_PERSONAL_3Y
 * - "personal financial" or "pfs" → PFS_CURRENT
 * - "rent roll" → RENT_ROLL
 * - "bank statement" → BANK_STMT_3M
 * - "profit and loss" / "income statement" → FIN_STMT_PL_YTD
 * - "balance sheet" → FIN_STMT_BS_YTD
 * - etc.
 */

const FILENAME_PATTERNS: Array<{ pattern: RegExp; keys: string[] }> = [
  {
    pattern: /(business.*tax|1120|1065|schedule\s*c.*business)/i,
    keys: ["IRS_BUSINESS_3Y"],
  },
  {
    // Common shorthand for business tax return.
    pattern: /(\bbtr\b|business\s*tax\s*return)/i,
    keys: ["IRS_BUSINESS_3Y"],
  },
  {
    pattern: /(personal.*tax|1040(?!.*sch.*c))/i,
    keys: ["IRS_PERSONAL_3Y"],
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
    keys: ["FIN_STMT_PL_YTD"],
  },
  {
    // Common financial statement filenames that often omit "YTD".
    pattern:
      /(balance\s*sheet|trial\s*balance|income\s*statement|\bp\s*&\s*l\b|profit\s*and\s*loss|statement\s*of\s*financial\s*position)/i,
    keys: ["FIN_STMT_PL_YTD", "FIN_STMT_BS_YTD"],
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
  /**
   * If true, allow filename-based heuristics as a last resort.
   * Default is false because borrower filenames are unreliable.
   */
  allowFilenameFallback?: boolean;
}): Promise<{ matched: string[]; updated: number }> {
  const sb = supabaseAdmin();
  const allowFilenameFallback = params.allowFilenameFallback === true;

  // Safe, one-time marker so Vercel logs can confirm the deployed version.
  const g = globalThis as unknown as { __buddyAutoMatchChecklistVersion?: string };
  if (g.__buddyAutoMatchChecklistVersion !== AUTO_MATCH_CHECKLIST_VERSION) {
    g.__buddyAutoMatchChecklistVersion = AUTO_MATCH_CHECKLIST_VERSION;
    console.log("[auto-match] version", {
      version: AUTO_MATCH_CHECKLIST_VERSION,
    });
  }

  // 0) Prefer doc_intel (OCR/classification) when available for this file.
  // This makes matching resilient to arbitrary filenames.
  if (params.fileId) {
    try {
      const { data: intel } = await sb
        .from("doc_intel_results")
        .select("doc_type,tax_year,confidence")
        .eq("deal_id", params.dealId)
        .eq("file_id", params.fileId)
        .maybeSingle();

      const docType = intel?.doc_type ? String(intel.doc_type) : "";
      const confidence = typeof intel?.confidence === "number" ? intel!.confidence : null;

      // Only trust doc_intel when it has a real doc type and decent confidence.
      if (
        docType &&
        normDocType(docType) !== "UNKNOWN" &&
        (confidence == null || confidence >= 60)
      ) {
        const intelKeys = checklistKeysFromDocIntel(docType, intel?.tax_year);
        if (intelKeys.length > 0) {
          // Proceed to update checklist items below using intelKeys.
          // We still return matched keys; caller can optionally stamp deal_documents.checklist_key.
          const matchedKeys = intelKeys;

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

          const toUpdate = items.filter(
            (item) => item.status === "missing" || item.status == null,
          );

          if (toUpdate.length === 0) {
            return { matched: matchedKeys, updated: 0 };
          }

          const ids = toUpdate.map((item) => item.id).filter(Boolean);
          const nowIso = new Date().toISOString();

          const { error: updateError } = await sb
            .from("deal_checklist_items")
            .update({
              status: "received",
              received_at: nowIso,
              received_file_id: params.fileId || null,
            })
            .eq("deal_id", params.dealId)
            .in("id", ids);

          if (updateError) {
            console.error("Error updating checklist items:", {
              version: AUTO_MATCH_CHECKLIST_VERSION,
              dealId: params.dealId,
              idsCount: ids.length,
              updateError,
            });
            return { matched: matchedKeys, updated: 0 };
          }

          return { matched: matchedKeys, updated: toUpdate.length };
        }
      }

      // If we have a fileId but doc_intel is missing/low-confidence, do not guess.
      // Caller should run AI Doc Recognition (OCR/classify) or assign manually.
      if (!allowFilenameFallback) {
        return { matched: [], updated: 0 };
      }
    } catch (e) {
      if (!allowFilenameFallback) {
        console.warn("doc_intel lookup failed; skipping filename fallback:", e);
        return { matched: [], updated: 0 };
      }

      // Non-fatal: optionally fall back to filename heuristics
      console.warn("doc_intel lookup failed (non-fatal):", e);
    }
  }

  // If we don't have a fileId (or doc_intel wasn't trusted) and fallback is disabled,
  // do not attempt to classify based on filename.
  if (!allowFilenameFallback) {
    return { matched: [], updated: 0 };
  }

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

  // Update items that are currently "missing" (or null right after seeding)
  const toUpdate = items.filter(
    (item) => item.status === "missing" || item.status == null,
  );
  if (toUpdate.length === 0) {
    return { matched: matchedKeys, updated: 0 };
  }

  const ids = toUpdate.map((item) => item.id).filter(Boolean);
  const nowIso = new Date().toISOString();

  const { error: updateError } = await sb
    .from("deal_checklist_items")
    .update({
      status: "received",
      received_at: nowIso,
      received_file_id: params.fileId || null,
    })
    .eq("deal_id", params.dealId)
    .in("id", ids);

  if (updateError) {
    console.error("Error updating checklist items:", {
      version: AUTO_MATCH_CHECKLIST_VERSION,
      dealId: params.dealId,
      idsCount: ids.length,
      updateError,
    });
    return { matched: matchedKeys, updated: 0 };
  }

  return { matched: matchedKeys, updated: toUpdate.length };
}
