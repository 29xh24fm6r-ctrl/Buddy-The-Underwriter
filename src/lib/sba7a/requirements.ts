import type { BorrowerRequirement } from "@/lib/borrowerRequirements/types";

/**
 * SBA 7(a) "MVP" borrower-facing requirements.
 * We keep it conservative: common items that almost every SBA file needs.
 *
 * Tax years: pass in derived years (usually last 2–3).
 */
export function buildSba7aRequirements(input: {
  tax_years: number[];        // e.g. [2023, 2022]
  require_years_count: number; // 2 for MVP, easy to bump to 3 later
}) {
  const years = (input.tax_years ?? []).slice(0, input.require_years_count);

  const reqs: BorrowerRequirement[] = [];

  // Year-based returns
  for (const y of years) {
    reqs.push({
      id: `BUSINESS_TAX_RETURN_${y}`,
      title: `Business tax return (${y})`,
      description: "Complete return including all schedules.",
      status: "MISSING",
      required: true,
      doc_types: ["IRS_1065", "IRS_1120", "IRS_1120S"],
      year: y,
    });

    reqs.push({
      id: `PERSONAL_TAX_RETURN_${y}`,
      title: `Personal tax return (${y})`,
      description: "Complete return including W-2s/1099s and schedules.",
      status: "MISSING",
      required: true,
      doc_types: ["IRS_1040"],
      year: y,
    });
  }

  // Non-year-based core SBA staples
  reqs.push(
    {
      id: "PFS",
      title: "Personal Financial Statement (PFS)",
      description: "A current personal financial statement for each guarantor.",
      status: "MISSING",
      required: true,
      doc_types: ["PFS"],
    },
    {
      id: "FINANCIAL_STATEMENTS_YTD",
      title: "Year-to-date financial statements",
      description: "YTD P&L and balance sheet (within the last ~90 days).",
      status: "MISSING",
      required: true,
      doc_types: ["FINANCIAL_STATEMENT"],
    },
    {
      id: "BUSINESS_DEBT_SCHEDULE",
      title: "Business debt schedule",
      description: "List of all business debts (lender, balance, payment, maturity).",
      status: "MISSING",
      required: true,
      doc_types: ["DEBT_SCHEDULE"],
      notes: ["If you don't have one, we can generate it from statements after upload."],
    }
  );

  // Optional-but-common supporting docs
  reqs.push(
    {
      id: "BANK_STATEMENTS",
      title: "Business bank statements (last 3 months)",
      description: "Most recent statements for the primary operating account.",
      status: "OPTIONAL",
      required: false,
      doc_types: ["BANK_STATEMENT"],
    },
    {
      id: "AR_AGING",
      title: "Accounts receivable aging",
      description: "If applicable, provide AR aging report.",
      status: "OPTIONAL",
      required: false,
      doc_types: ["AR_AGING"],
    },
    {
      id: "AP_AGING",
      title: "Accounts payable aging",
      description: "If applicable, provide AP aging report.",
      status: "OPTIONAL",
      required: false,
      doc_types: ["AP_AGING"],
    }
  );

  return reqs;
}
