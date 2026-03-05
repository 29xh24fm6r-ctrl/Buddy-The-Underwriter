import type { FinancialFact, RenderedSpread, RentRollRow, SpreadType } from "@/lib/financialSpreads/types";

/**
 * Prerequisites for meaningful spread rendering.
 * Supports fact_keys (strongest), fact_types (fallback), and table checks.
 */
export type SpreadPrereq = {
  facts?: {
    fact_keys?: string[];
    /** AND semantics: ALL listed fact_types must be present. */
    fact_types?: string[];
    /** OR semantics: at least ONE of these fact_types must be present. */
    fact_types_any?: string[];
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
