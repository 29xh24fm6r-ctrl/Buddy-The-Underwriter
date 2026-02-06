import type { FinancialFact, RenderedSpread, RentRollRow, SpreadType } from "@/lib/financialSpreads/types";

export type SpreadTemplate = {
  spreadType: SpreadType;
  title: string;
  version: number;
  columns: string[];
  render: (args: {
    dealId: string;
    bankId: string;
    facts: FinancialFact[];
    rentRollRows?: RentRollRow[];
    ownerEntityId?: string | null;
  }) => RenderedSpread;
};
