import "server-only";

import type { LoanRequest } from "@/lib/loanRequests/types";
import { computeStructuralPricing } from "./computeStructuralPricing";
import { materializeDebtServiceFact } from "./materializeDebtServiceFact";

/**
 * Orchestrator: auto-create structural pricing when a loan request is submitted.
 *
 * Chains: compute structural pricing -> materialize ANNUAL_DEBT_SERVICE fact -> ledger event.
 * Wrapped in try/catch — never throws (fire-and-forget safe).
 */
export async function onLoanRequestSubmitted(loanRequest: LoanRequest): Promise<void> {
  try {
    const bankId = loanRequest.bank_id ?? "unknown";

    // Step 1: Compute structural pricing
    const pricing = await computeStructuralPricing(loanRequest);
    if (!pricing.ok) {
      console.warn("[onLoanRequestSubmitted] structural pricing failed:", pricing.error);
      return;
    }

    // Step 2: Materialize ANNUAL_DEBT_SERVICE fact
    const fact = await materializeDebtServiceFact({
      dealId: loanRequest.deal_id,
      bankId,
      structuralPricing: pricing.data,
    });

    if (!fact.ok) {
      console.warn("[onLoanRequestSubmitted] fact materialization failed:", fact.error);
    }

    // Step 3: Write ledger event (fire-and-forget)
    try {
      const { logLedgerEvent } = await import("@/lib/pipeline/logLedgerEvent");
      await logLedgerEvent({
        dealId: loanRequest.deal_id,
        bankId,
        eventKey: "structural_pricing.created",
        uiState: "done",
        uiMessage: `Structural pricing auto-created from loan request #${loanRequest.request_number}`,
        meta: {
          loan_request_id: loanRequest.id,
          structural_pricing_id: pricing.data.id,
          annual_debt_service_est: pricing.data.annual_debt_service_est,
          structural_rate_pct: pricing.data.structural_rate_pct,
        },
      });
    } catch {
      // Ledger event is non-fatal
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[onLoanRequestSubmitted] unexpected error (non-fatal):", msg);
  }
}
