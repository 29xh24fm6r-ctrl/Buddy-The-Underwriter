/**
 * SPEC S7 4 (ARC-00 Phase 5, "pulled forward from S5") — SBA lender
 * package assembly: walks all generated items in a package run into a
 * single lender-ready PDF, ordered by a fixed tab structure. Originally a
 * 10-tab structure; now 11 with the addition of the Note/Authorization
 * closing documents (tab 1) — every other tab shifted down by one.
 *
 * Documented assumption: no official SBA tab specification exists
 * anywhere in this codebase or the arc's spec docs to verify the exact
 * tab breakdown against — this is a standard SBA-lender submission
 * package convention (closing documents → loan application → personal
 * financials → personal history → tax verification → fee disclosure →
 * standby agreements → guarantees → compliance → closing acknowledgments
 * → supporting docs), not a value pulled from an authoritative source.
 * Flagged in the Drift Log; whoever owns the actual lender relationship
 * should confirm the real tab order a receiving CDC/PLP lender expects.
 */

export type TenTabMapping = { tab: number; label: string; templateCodes: string[] };

export const TEN_TAB_STRUCTURE: TenTabMapping[] = [
  { tab: 1, label: "Closing Documents", templateCodes: ["SBA_NOTE", "SBA_AUTHORIZATION"] },
  { tab: 2, label: "Loan Application", templateCodes: ["SBA_1919", "SBA_1244"] },
  { tab: 3, label: "Personal Financial Statement", templateCodes: ["SBA_413"] },
  { tab: 4, label: "Personal History", templateCodes: ["SBA_912"] },
  { tab: 5, label: "Tax Verification", templateCodes: ["IRS_4506C"] },
  { tab: 6, label: "Fee Disclosure", templateCodes: ["SBA_159"] },
  { tab: 7, label: "Standby Creditor Agreements", templateCodes: ["SBA_155"] },
  { tab: 8, label: "Guarantees", templateCodes: ["SBA_148", "SBA_148L"] },
  { tab: 9, label: "Compliance", templateCodes: ["SBA_601"] },
  { tab: 10, label: "Closing Acknowledgments", templateCodes: ["SBA_722"] },
  { tab: 11, label: "Supporting Documents", templateCodes: [] }, // catch-all for anything not mapped above
];

export function tabForTemplateCode(templateCode: string): TenTabMapping {
  return TEN_TAB_STRUCTURE.find((t) => t.templateCodes.includes(templateCode)) ?? TEN_TAB_STRUCTURE[TEN_TAB_STRUCTURE.length - 1];
}

export type PackageRunItemForAssembly = {
  id: string;
  template_code: string;
  title: string;
  status: string;
  output_storage_path: string | null;
};

export type TabbedItem = { tab: number; label: string; item: PackageRunItemForAssembly };

/**
 * Pure sort — groups generated items (status='generated', non-null
 * output_storage_path) by tab, in tab order, then by sort_order within
 * the tab (source array order, since sba_package_run_items is already
 * queried ordered by sort_order by the caller).
 */
export function orderItemsByTab(items: PackageRunItemForAssembly[]): TabbedItem[] {
  return items
    .filter((it) => it.status === "generated" && it.output_storage_path)
    .map((item) => {
      const mapping = tabForTemplateCode(item.template_code);
      return { tab: mapping.tab, label: mapping.label, item };
    })
    .sort((a, b) => a.tab - b.tab);
}
