export type SpreadRowKind = "source" | "total" | "derived" | "ratio" | "section_header";

export function classifyRowKind(row: {
  key: string;
  formula?: string | null;
  section?: string | null;
}): SpreadRowKind {
  const k = row.key.toUpperCase();

  // Total rows — MMAS subtotals and bottom-line figures
  if (k.startsWith("TOTAL_") || k === "NOI" || k === "NET_WORTH" || k === "PFS_NET_WORTH" ||
      k.includes("GLOBAL_CASH_FLOW") || k === "GCF_TOTAL_OBLIGATIONS" || k === "GCF_CASH_AVAILABLE" ||
      k === "GROSS_PROFIT" || k === "NET_OPERATING_PROFIT" || k === "NET_INCOME" || k === "NET_PROFIT" ||
      k === "EBITDA" || k === "EBIT") {
    return "total";
  }

  // Ratio rows — includes R_ prefixed keys, standard ratio patterns, and MMAS activity metrics
  if (k.startsWith("R_") || k.includes("RATIO") || k.includes("MARGIN") || k.includes("DSCR") ||
      k.includes("LTV") || k.includes("PCT") || k.includes("COVERAGE") ||
      k === "ROA" || k === "ROE" || k === "AR_DAYS" || k === "INTEREST_COVERAGE") {
    return "ratio";
  }

  // Derived / formula rows
  if (row.formula) {
    return "derived";
  }

  return "source";
}
