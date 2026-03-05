export type SpreadRowKind = "source" | "total" | "derived" | "ratio" | "section_header";

export function classifyRowKind(row: {
  key: string;
  formula?: string | null;
  section?: string | null;
}): SpreadRowKind {
  const k = row.key.toUpperCase();

  // Total rows
  if (k.startsWith("TOTAL_") || k === "NOI" || k === "NET_WORTH" || k === "PFS_NET_WORTH" ||
      k.includes("GLOBAL_CASH_FLOW") || k === "GCF_TOTAL_OBLIGATIONS" || k === "GCF_CASH_AVAILABLE") {
    return "total";
  }

  // Ratio rows
  if (k.includes("RATIO") || k.includes("MARGIN") || k.includes("DSCR") || k.includes("LTV") ||
      k.includes("PCT") || k.includes("COVERAGE")) {
    return "ratio";
  }

  // Derived / formula rows
  if (row.formula) {
    return "derived";
  }

  return "source";
}
