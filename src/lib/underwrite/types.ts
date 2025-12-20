// src/lib/underwrite/types.ts

export type UnderwriteSource =
  | { from: "banker_underwrite_input"; id: string }
  | { from: "borrower_loan_request"; id: string }
  | { from: "doc_fact"; key: string; docId?: string }
  | { from: "default" };

export type FieldWithSource<T> = {
  value: T | null;
  source: UnderwriteSource;
};

export type NormalizedUnderwrite = {
  dealId: string;

  // High level selection
  primaryProductType: FieldWithSource<string>;
  requestedProducts: string[];

  // Core structure
  amount: FieldWithSource<number>;
  termMonths: FieldWithSource<number>;
  amortMonths: FieldWithSource<number>;
  interestOnlyMonths: FieldWithSource<number>;
  rateType: FieldWithSource<"FIXED" | "VARIABLE">;
  rateIndex: FieldWithSource<string>;
  spreadBps: FieldWithSource<number>;

  // Purpose / narrative
  purpose: FieldWithSource<string>;
  useOfProceeds: FieldWithSource<any>; // keep jsonb-compatible
  collateralSummary: FieldWithSource<string>;
  guarantorsSummary: FieldWithSource<string>;

  // Underwrite targets (banker only)
  guaranteePercent: FieldWithSource<number>;
  ltvTarget: FieldWithSource<number>;
  dscrTarget: FieldWithSource<number>;
  globalDscrTarget: FieldWithSource<number>;
  pricingFloorRate: FieldWithSource<number>;

  // Doc facts (best-effort)
  docFacts: Record<string, any>;

  // For UX + audits
  selected: {
    borrowerRequestId: string | null;
    bankerUnderwriteInputId: string | null;
  };
};
