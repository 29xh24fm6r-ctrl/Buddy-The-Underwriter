// src/lib/packs/requirements/defaults.ts

import type { PackRequirement } from "./types";

export type DealKind = "CRE" | "LINE_OF_CREDIT" | "TERM_LOAN" | "SBA_7A" | "SBA_504";

export function getDefaultRequirements(input: {
  dealKind: DealKind;
  taxYears?: number[]; // e.g. [2023, 2022]
}): PackRequirement[] {
  const taxYears = input.taxYears ?? [];

  const base: PackRequirement[] = [
    {
      id: "pfs_min_1",
      label: "Personal Financial Statement (PFS)",
      category: "BORROWER",
      required: true,
      rule: { rule: "DOC_TYPE_MIN_COUNT", docType: "PFS", minCount: 1 },
      notes: "Most recent PFS for guarantor(s).",
    },
    {
      id: "biz_fin_stmt_min_1",
      label: "Business Financial Statements",
      category: "BUSINESS",
      required: true,
      rule: { rule: "DOC_TYPE_MIN_COUNT", docType: "FINANCIAL_STATEMENT", minCount: 1 },
      notes: "At least one business financial package (YTD or annual).",
    },
  ];

  const taxReqs: PackRequirement[] =
    taxYears.length === 0
      ? []
      : [
          {
            id: "biz_returns_by_year",
            label: `Business Tax Returns (${taxYears.join(", ")})`,
            category: "TAX",
            required: true,
            rule: { rule: "DOC_TYPE_PER_YEAR", docType: "IRS_1120", years: taxYears },
            notes: "Adjust doc type rules as entity type expands (1120S/1065).",
          },
          {
            id: "personal_returns_by_year",
            label: `Personal Tax Returns (${taxYears.join(", ")})`,
            category: "TAX",
            required: true,
            rule: { rule: "DOC_TYPE_PER_YEAR", docType: "IRS_1040", years: taxYears },
          },
        ];

  // Deal-kind specific adds (starter set)
  const kindAdds: PackRequirement[] = [];
  if (input.dealKind === "CRE") {
    kindAdds.push({
      id: "leases_optional",
      label: "Leases / Rent Roll (if applicable)",
      category: "COLLATERAL",
      required: false,
      rule: { rule: "DOC_TYPE_MIN_COUNT", docType: "LEASE", minCount: 1 },
    });
  }

  if (input.dealKind === "SBA_7A" || input.dealKind === "SBA_504") {
    kindAdds.push({
      id: "bank_statements_optional",
      label: "Bank Statements (recent)",
      category: "BANKING",
      required: false,
      rule: { rule: "DOC_TYPE_MIN_COUNT", docType: "BANK_STATEMENT", minCount: 1 },
      notes: "Optional for now; later you can make this required based on SOP rules.",
    });
  }

  return [...base, ...taxReqs, ...kindAdds];
}