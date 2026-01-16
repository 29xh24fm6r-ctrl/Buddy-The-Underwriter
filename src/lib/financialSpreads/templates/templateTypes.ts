import type { FinancialFact, RenderedSpread, SpreadType } from "@/lib/financialSpreads/types";

export type SpreadTemplate = {
  spreadType: SpreadType;
  title: string;
  version: number;
  columns: string[];
  render: (args: {
    dealId: string;
    bankId: string;
    facts: FinancialFact[];
  }) => RenderedSpread;
};
