import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";
import type { SbaEligibilityResult } from "@/lib/sba/eligibilityEngine";

export function buildSbaForm1919(args: {
  snapshot: DealFinancialSnapshotV1;
  borrowerName: string | null;
  entityType: string | null;
  loanAmount: number | null;
  useOfProceeds: string[] | null;
  eligibility: SbaEligibilityResult;
}) {
  const fields: Record<string, string | number | null> = {
    borrower_name: args.borrowerName ?? null,
    entity_type: args.entityType ?? null,
    loan_amount: args.loanAmount ?? null,
    use_of_proceeds: (args.useOfProceeds ?? []).join(", ") || null,
    sba_status: args.eligibility.status ?? null,
  };

  return {
    form: "1919" as const,
    fields,
    missing: Object.entries(fields)
      .filter(([, v]) => v == null || v === "")
      .map(([k]) => k),
  };
}
