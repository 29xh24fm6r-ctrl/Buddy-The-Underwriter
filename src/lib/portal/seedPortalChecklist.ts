import "server-only";

// src/lib/portal/seedPortalChecklist.ts
//
// Seeds deal_portal_checklist_items (what /portal/[token]/checklist renders
// to the borrower) for EVERY deal, not just franchise deals. Before this,
// the only writer to this table was seedFranchiseChecklist — invoked solely
// when a franchise brand got linked — so a standard SBA 7(a)/CRE/LOC/TERM
// deal's borrower checklist stayed permanently empty and the portal UI got
// stuck showing "we're still preparing your request list."
//
// Reuses buildChecklistForLoanType (the same deterministic, loan-type-aware
// document list already used to seed the legacy deal_checklist_items table)
// as the single source of truth for "what documents does this loan type
// need," instead of inventing a fourth parallel checklist definition.
// Idempotent upsert keyed on (deal_id, code) — safe to call on every
// initializeIntake() invocation, including as a backfill for deals that
// already passed intake before this seeder existed.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildChecklistForLoanType, type LoanType } from "@/lib/deals/checklistPresets";

const GROUP_NAME = "Application Documents";

/** Filename keywords used to auto-mark an item "received" on upload (see applyReceiptToChecklist). */
const MATCH_HINTS: Record<string, string[]> = {
  PFS_CURRENT: ["personal financial statement", "sba form 413", "form 413"],
  IRS_PERSONAL_3Y: ["personal tax return", "1040", "irs 1040"],
  IRS_BUSINESS_3Y: ["business tax return", "1120", "1120s", "1065", "k-1"],
  FIN_STMT_PL_YTD: ["profit and loss", "income statement", "p&l", "p and l"],
  FIN_STMT_BS_YTD: ["balance sheet"],
  BANK_STMT_3M: ["bank statement"],
  PROPERTY_INSURANCE: ["insurance declarations", "insurance policy"],
  REAL_ESTATE_TAX_BILL: ["property tax bill", "real estate tax"],
  APPRAISAL_IF_AVAILABLE: ["appraisal"],
  RENT_ROLL: ["rent roll"],
  LEASES_TOP: ["lease agreement", "lease"],
  PROPERTY_T12: ["operating statement", "t12", "trailing twelve"],
  AR_AGING: ["accounts receivable aging", "ar aging"],
  AP_AGING: ["accounts payable aging", "ap aging"],
  BORROWING_BASE_CERT: ["borrowing base certificate"],
  INVENTORY_REPORT: ["inventory report"],
  DEBT_SCHEDULE: ["debt schedule", "schedule of liabilities"],
  USES_OF_FUNDS: ["use of funds", "uses of funds", "invoice"],
  SBA_1919: ["sba form 1919", "form 1919"],
  SBA_413: ["sba form 413", "form 413", "personal financial statement"],
  SBA_DEBT_SCHED: ["debt schedule", "schedule of liabilities"],
  SBA_912: ["sba form 912", "form 912"],
  SBA_1244: ["sba form 1244", "form 1244"],
  PROJECT_SOURCES_USES: ["sources and uses", "project budget"],
  CONTRACTOR_BIDS: ["contractor bid", "construction budget"],
  OPERATING_AGREEMENT: ["operating agreement", "articles of organization", "articles of incorporation", "bylaws"],
  EXIT_STRATEGY: ["business plan", "exit strategy"],
  PROPERTY_USE_STATEMENT: ["occupancy plan", "property use"],
  LEASE_SCHEDULE: ["lease schedule"],
  RENTAL_INCOME_PROJECTION: ["rental income projection"],
};

const KNOWN_LOAN_TYPES: LoanType[] = [
  "CRE",
  "CRE_OWNER_OCCUPIED",
  "CRE_INVESTOR",
  "CRE_OWNER_OCCUPIED_WITH_RENT",
  "LOC",
  "TERM",
  "SBA_7A",
  "SBA_504",
];

/** buildChecklistForLoanType's LoanType union is stricter than every loan_type spelling seen elsewhere (e.g. the intake wizard's "SBA"/"sba_7a"). Normalize the loose aliases; default to CRE like buildChecklistForLoanType's own default branch. */
export function normalizeLoanTypeForChecklist(loanType: string | null | undefined): LoanType {
  const upper = (loanType ?? "").toUpperCase().trim();
  if ((KNOWN_LOAN_TYPES as string[]).includes(upper)) return upper as LoanType;
  if (upper === "SBA" || upper === "SBA7A") return "SBA_7A";
  if (upper === "SBA504") return "SBA_504";
  if (upper === "C&I" || upper === "CI") return "TERM";
  return "CRE";
}

export async function seedPortalChecklist(
  sb: SupabaseClient,
  params: { dealId: string; loanType: string },
): Promise<{ seeded: boolean; count: number }> {
  const { dealId, loanType } = params;
  const rows = buildChecklistForLoanType(normalizeLoanTypeForChecklist(loanType));
  if (rows.length === 0) return { seeded: false, count: 0 };

  const checklistRows = rows.map((row, index) => ({
    deal_id: dealId,
    code: row.checklist_key,
    title: row.title,
    description: row.description ?? null,
    group_name: GROUP_NAME,
    sort_order: index,
    match_hints: MATCH_HINTS[row.checklist_key] ?? [],
    required: row.required,
  }));

  const { error } = await sb
    .from("deal_portal_checklist_items")
    .upsert(checklistRows, { onConflict: "deal_id,code" });

  if (error) {
    console.error("[seedPortalChecklist] upsert failed", error);
    return { seeded: false, count: 0 };
  }

  return { seeded: true, count: checklistRows.length };
}
