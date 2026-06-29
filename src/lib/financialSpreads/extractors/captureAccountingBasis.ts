import "server-only";

/**
 * SPEC-FINENGINE-KNOWLEDGE-WIRE-2 — accounting-basis capture (server-only writer).
 *
 * Path-agnostic: runs after the numeric extractors (Gemini OR deterministic) have
 * written this document's facts, derives the accounting basis from OCR text and —
 * for Form 1120, which has no standard method line — falls back to inferring it
 * from the just-written balance-sheet facts (Schedule L AR/inventory ⇒ ACCRUAL).
 *
 * Writes ONE categorical `ACCOUNTING_BASIS` fact (fact_value_text, null num) into
 * deal_financial_facts via the same chokepoint every fact uses. Best-effort:
 * never throws, returns the resolved basis. Only a determinable basis is written
 * (CASH/ACCRUAL/OTHER) — UNKNOWN writes nothing, since the finengine already
 * treats a missing basis as UNKNOWN.
 */

import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";
import {
  deriveAccountingBasisFromText,
  inferAccountingBasisFromFacts,
  type AccountingBasis,
} from "@/lib/financialSpreads/accountingBasis";
import { detectIrsFormType, resolveDocTaxYear } from "@/lib/financialSpreads/extractors/deterministic/parseUtils";

/** Doc types whose accounting basis is meaningful (business returns + GAAP statements). */
const BASIS_DOC_TYPES = new Set([
  "IRS_1120", "IRS_1120S", "IRS_1065", "IRS_BUSINESS", "BUSINESS_TAX_RETURN", "TAX_RETURN",
  "FINANCIAL_STATEMENT", "INCOME_STATEMENT", "OPERATING_STATEMENT", "BALANCE_SHEET",
]);

export async function captureAccountingBasis(args: {
  sb: any;
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
  normDocType: string;
  docYear: number | null;
}): Promise<{ ok: boolean; basis: AccountingBasis }> {
  try {
    if (!BASIS_DOC_TYPES.has(args.normDocType) || !args.ocrText) {
      return { ok: false, basis: "UNKNOWN" };
    }

    const formType = detectIrsFormType(args.ocrText);

    // 1. Text-derived basis (Schedule B / Schedule C method line, or a GAAP basis note).
    let { basis } = deriveAccountingBasisFromText(args.ocrText, { formType });

    // 2. Form 1120 (and any return with no method line) — infer ACCRUAL from
    //    Schedule-L receivables/inventory among the facts just written. Never CASH.
    if (basis === "UNKNOWN") {
      const { data: docFacts } = await args.sb
        .from("deal_financial_facts")
        .select("fact_key, fact_value_num")
        .eq("deal_id", args.dealId)
        .eq("source_document_id", args.documentId)
        .neq("fact_type", "EXTRACTION_HEARTBEAT");
      basis = inferAccountingBasisFromFacts((docFacts ?? []) as Array<{ fact_key: string; fact_value_num: number | null }>);
    }

    // Only a determinable basis is persisted (UNKNOWN ⇒ no fact; finengine defaults UNKNOWN).
    if (basis === "UNKNOWN") return { ok: false, basis };

    // Resolve the period — the basis belongs to the document's tax year. A valid
    // period is mandatory (writeFact rejects sentinel/pre-1990 dates).
    const taxYear = args.docYear ?? resolveDocTaxYear(args.ocrText, args.docYear);
    if (!taxYear) return { ok: false, basis };
    const periodEnd = `${taxYear}-12-31`;
    const periodStart = `${taxYear}-01-01`;

    const evidenceConfidence = formType === "1120" ? 0.6 : 0.75;

    const res = await upsertDealFinancialFact({
      dealId: args.dealId,
      bankId: args.bankId,
      sourceDocumentId: args.documentId,
      factType: "ACCOUNTING_BASIS",
      factKey: "ACCOUNTING_BASIS",
      factValueNum: null,
      factValueText: basis,
      confidence: evidenceConfidence,
      factPeriodStart: periodStart,
      factPeriodEnd: periodEnd,
      // BUSINESS-scope fact: owner_type DEAL + a business source_canonical_type
      // (auto-resolved from deal_documents.canonical_type) classifies it BUSINESS
      // in the finengine's entity partition.
      provenance: {
        source_type: "DOC_EXTRACT",
        source_ref: `deal_documents:${args.documentId}`,
        as_of_date: periodEnd,
        extractor: "accountingBasis:v1",
      },
    });

    return { ok: res.ok, basis };
  } catch {
    return { ok: false, basis: "UNKNOWN" };
  }
}
