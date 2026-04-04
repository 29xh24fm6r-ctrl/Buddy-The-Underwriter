import "server-only";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

type K1BaseInput = {
  dealId: string;
  bankId: string;
  documentId: string;
  taxYear: number | null;
  /** Ordinary business income from the entity return (1065 or 1120S OBI) */
  ordinaryBusinessIncome: number | null;
  /** Known ownership percentage (0–100). Defaults to 100 for single-owner. */
  ownershipPct?: number;
  /** Number of owners/partners — if > 1, skip K-1 approximation */
  ownerCount?: number;
};

/**
 * Write K-1 approximation facts for single-owner pass-through entities.
 *
 * For entities with a single owner and known OBI, writes:
 * - K1_ORDINARY_INCOME = OBI (100% allocation)
 * - K1_OWNERSHIP_PCT = 100 (or known pct)
 *
 * IMPORTANT: This is an approximation pending full Schedule K-1 parsing.
 * source_ref includes "k1_approx" to distinguish from real K-1 data.
 * The reconciliator uses this to run K1_TO_ENTITY checks.
 *
 * Skipped when ownerCount > 1 — multi-owner K-1 allocation requires
 * real Schedule K-1 parsing, not a passthrough approximation.
 *
 * Never throws. Returns count of facts written.
 */
export async function writeK1BaseFacts(input: K1BaseInput): Promise<{ factsWritten: number; skipped: boolean }> {
  // Skip for multi-owner entities — approximation is not valid
  if (input.ownerCount && input.ownerCount > 1) {
    return { factsWritten: 0, skipped: true };
  }

  if (input.ordinaryBusinessIncome === null) {
    return { factsWritten: 0, skipped: true };
  }

  const periodEnd = input.taxYear ? `${input.taxYear}-12-31` : null;
  const periodStart = input.taxYear ? `${input.taxYear}-01-01` : null;
  const ownershipPct = input.ownershipPct ?? 100;
  const sourceRef = `deal_documents:${input.documentId}:k1_approx`;

  const provenance = {
    source_type: "DOC_EXTRACT" as const,
    source_ref: sourceRef,
    as_of_date: periodEnd,
    extractor: "writeK1BaseFacts:v1",
    confidence: 0.7, // lower confidence — this is an approximation
  };

  const results = await Promise.allSettled([
    upsertDealFinancialFact({
      dealId: input.dealId,
      bankId: input.bankId,
      sourceDocumentId: input.documentId,
      factType: "TAX_RETURN",
      factKey: "K1_ORDINARY_INCOME",
      factValueNum: input.ordinaryBusinessIncome,
      confidence: 0.7,
      factPeriodStart: periodStart,
      factPeriodEnd: periodEnd,
      provenance,
    }),
    upsertDealFinancialFact({
      dealId: input.dealId,
      bankId: input.bankId,
      sourceDocumentId: input.documentId,
      factType: "TAX_RETURN",
      factKey: "K1_OWNERSHIP_PCT",
      factValueNum: ownershipPct,
      confidence: 0.7,
      factPeriodStart: periodStart,
      factPeriodEnd: periodEnd,
      provenance,
    }),
  ]);

  const factsWritten = results.filter(
    (r) => r.status === "fulfilled" && (r.value as any)?.ok,
  ).length;

  return { factsWritten, skipped: false };
}
