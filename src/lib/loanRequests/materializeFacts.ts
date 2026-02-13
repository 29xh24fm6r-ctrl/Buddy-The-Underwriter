import "server-only";

import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";
import { CANONICAL_FACTS, type FinancialFactProvenance } from "@/lib/financialFacts/keys";
import type { LoanRequest } from "./types";

/**
 * Materialize key loan-request values into deal_financial_facts.
 *
 * This bridges the gap between borrower/banker input and the
 * snapshot builder. Runs on create/update of loan requests.
 *
 * Facts written:
 *  - BANK_LOAN_TOTAL  (from requested_amount or approved_amount)
 *  - COLLATERAL_GROSS_VALUE  (from property_value or purchase_price)
 *  - BORROWER_EQUITY  (from down_payment)
 *
 * All facts use source_type: "LOAN_REQUEST" so they're clearly
 * distinguished from document-extracted or spread-derived facts.
 */
export async function materializeLoanRequestFacts(
  lr: LoanRequest,
): Promise<{ ok: boolean; factsWritten: number }> {
  if (!lr.deal_id || !lr.bank_id) return { ok: true, factsWritten: 0 };

  const provenance = (label: string): FinancialFactProvenance => ({
    source_type: "MANUAL",
    source_ref: `deal_loan_requests:${lr.id}`,
    as_of_date: lr.updated_at?.slice(0, 10) ?? null,
    extractor: "materializeLoanRequestFacts",
    confidence: 0.95,
    citations: [],
    raw_snippets: [label],
  });

  // Use loan request ID as source_document_id → stable upsert key per request
  const sourceDocId = lr.id;

  const writes: Array<{ factType: string; factKey: string; value: number; label: string }> = [];

  // BANK_LOAN_TOTAL — from requested_amount (preferred) or approved_amount
  const loanAmount = lr.requested_amount ?? lr.approved_amount ?? null;
  if (loanAmount && loanAmount > 0) {
    writes.push({
      factType: CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_type,
      factKey: CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_key,
      value: loanAmount,
      label: `Loan amount: ${loanAmount}`,
    });
  }

  // COLLATERAL_GROSS_VALUE — from property_value (preferred) or purchase_price
  const collateralValue = lr.property_value ?? lr.purchase_price ?? null;
  if (collateralValue && collateralValue > 0) {
    writes.push({
      factType: CANONICAL_FACTS.COLLATERAL_GROSS_VALUE.fact_type,
      factKey: CANONICAL_FACTS.COLLATERAL_GROSS_VALUE.fact_key,
      value: collateralValue,
      label: `Collateral value: ${collateralValue}`,
    });
  }

  // BORROWER_EQUITY — from down_payment
  if (lr.down_payment && lr.down_payment > 0) {
    writes.push({
      factType: CANONICAL_FACTS.BORROWER_EQUITY.fact_type,
      factKey: CANONICAL_FACTS.BORROWER_EQUITY.fact_key,
      value: lr.down_payment,
      label: `Down payment: ${lr.down_payment}`,
    });
  }

  let written = 0;
  for (const w of writes) {
    const result = await upsertDealFinancialFact({
      dealId: lr.deal_id,
      bankId: lr.bank_id,
      sourceDocumentId: sourceDocId,
      factType: w.factType,
      factKey: w.factKey,
      factValueNum: w.value,
      confidence: 0.95,
      provenance: provenance(w.label),
    });
    if (result.ok) written++;
  }

  return { ok: true, factsWritten: written };
}
