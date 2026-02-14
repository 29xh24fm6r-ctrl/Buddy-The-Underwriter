import type { FinancialFact, RenderedSpread, RentRollRow, SpreadType } from "@/lib/financialSpreads/types";

/**
 * Prerequisites for meaningful spread rendering.
 * Supports fact_keys (strongest), fact_types (fallback), and table checks.
 */
export type SpreadPrereq = {
  facts?: {
    fact_keys?: string[];
    fact_types?: string[];
    min_count?: number;
  };
  tables?: {
    rent_roll_rows?: boolean;
  };
  note?: string;
};

export type SpreadTemplate = {
  spreadType: SpreadType;
  title: string;
  version: number;
  /** Rendering priority — lower runs first. */
  priority: number;
  /** Prerequisites for meaningful rendering. */
  prerequisites: () => SpreadPrereq;
  columns: string[];
  render: (args: {
    dealId: string;
    bankId: string;
    facts: FinancialFact[];
    rentRollRows?: RentRollRow[];
    ownerEntityId?: string | null;
  }) => RenderedSpread;
};
