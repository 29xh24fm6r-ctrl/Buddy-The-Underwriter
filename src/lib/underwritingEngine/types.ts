/**
 * Underwriting Engine — Types
 *
 * Full-pipeline orchestrator types.
 * Chains all computation layers into a single result.
 *
 * ORCHESTRATOR: No new logic — composition only.
 */

import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";
import type { CreditSnapshotOpts, CreditSnapshot } from "@/lib/creditMetrics/types";
import type { ProductType, ProductAnalysis } from "@/lib/creditLenses/types";
import type { PolicyResult } from "@/lib/policyEngine/types";
import type { StressResult } from "@/lib/stressEngine/types";
import type { PricingResult } from "@/lib/pricingEngine/types";
import type { CreditMemo } from "@/lib/memoEngine/types";
import type { BankConfig } from "@/lib/configEngine/types";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface UnderwriteInput {
  model: FinancialModel;
  product: ProductType;
  instruments?: DebtInstrument[];
  snapshotOpts?: Partial<CreditSnapshotOpts>;
  /** Optional bank-specific configuration. When omitted, system defaults apply. */
  bankConfig?: BankConfig;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface UnderwriteResult {
  snapshot: CreditSnapshot;
  analysis: ProductAnalysis;
  policy: PolicyResult;
  stress: StressResult;
  pricing: PricingResult;
  memo: CreditMemo;
  diagnostics: {
    pipelineComplete: boolean;
  };
}

export interface UnderwriteFailure {
  failedAt: "snapshot" | "stress";
  diagnostics: {
    pipelineComplete: false;
    reason: string;
  };
}
