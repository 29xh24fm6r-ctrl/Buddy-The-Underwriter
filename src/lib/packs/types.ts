// src/lib/packs/types.ts
export type PackScope =
  | { kind: "ALL" }
  | { kind: "TAX_YEAR"; year: number }
  | { kind: "PFS"; docId?: string }
  | { kind: "BUSINESS_FINANCIALS"; docId?: string }
  | { kind: "OTHER"; docId?: string };

export function scopeLabel(scope: PackScope) {
  switch (scope.kind) {
    case "ALL": return "All Documents";
    case "TAX_YEAR": return `Tax Returns — ${scope.year}`;
    case "PFS": return "Personal Financial Statements";
    case "BUSINESS_FINANCIALS": return "Business Financials";
    case "OTHER": return "Other Documents";
  }
}