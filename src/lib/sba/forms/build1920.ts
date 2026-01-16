import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";
import { SBA_1920_FIELDS, buildMissing } from "@/lib/sba/forms/sbaFieldMap";

export function buildSbaForm1920(args: {
  snapshot: DealFinancialSnapshotV1;
  borrowerName: string | null;
  loanAmount: number | null;
}) {
  const fields: Record<string, string | number | null> = {
    borrower_name: args.borrowerName ?? null,
    loan_amount: args.loanAmount ?? null,
    dscr: args.snapshot.dscr?.value_num ?? null,
    ltv: args.snapshot.ltv_net?.value_num ?? null,
    collateral_value: args.snapshot.collateral_net_value?.value_num ?? null,
  };

  return {
    form: "1920" as const,
    fields,
    missing: buildMissing(SBA_1920_FIELDS, fields),
  };
}
