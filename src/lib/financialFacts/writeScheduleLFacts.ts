import "server-only";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

type EntityRow = {
  type: string;
  normalizedValue?: {
    moneyValue?: { units: number; nanos: number };
  };
  confidence: number;
};

type ScheduleLInput = {
  dealId: string;
  bankId: string;
  documentId: string;
  taxYear: number | null;
  entities: EntityRow[];
};

// Map from Gemini entity type names to canonical fact keys
const SCHEDULE_L_ENTITY_MAP: Record<string, string> = {
  total_assets: "TOTAL_ASSETS",
  total_liabilities: "TOTAL_LIABILITIES",
  total_equity: "NET_WORTH",        // canonical key is NET_WORTH
  partners_capital: "NET_WORTH",    // partnership equivalent of equity
  retained_earnings_schedule_l: "RETAINED_EARNINGS_SCH_L",
  cash_schedule_l: "CASH_SCH_L",
  accounts_receivable_schedule_l: "AR_SCH_L",
  inventory_schedule_l: "INVENTORY_SCH_L",
};

function extractMoney(e: EntityRow): number | null {
  const units = e.normalizedValue?.moneyValue?.units;
  if (typeof units === "number" && Number.isFinite(units)) return units;
  return null;
}

function buildPeriodEnd(taxYear: number | null): string | null {
  if (!taxYear) return null;
  return `${taxYear}-12-31`;
}

/**
 * Write Schedule L (balance sheet) facts from BTR Gemini extraction output.
 *
 * Writes TOTAL_ASSETS, TOTAL_LIABILITIES, NET_WORTH (and supporting line items)
 * directly to deal_financial_facts as DOC_EXTRACT facts.
 *
 * Called after BTR extraction for IRS_1065, IRS_1120S, IRS_1120.
 * Never throws. Returns count of facts written.
 */
export async function writeScheduleLFacts(input: ScheduleLInput): Promise<{ factsWritten: number }> {
  let factsWritten = 0;
  const periodEnd = buildPeriodEnd(input.taxYear);
  const periodStart = input.taxYear ? `${input.taxYear}-01-01` : null;
  const sourceRef = `deal_documents:${input.documentId}`;

  const writes: Promise<any>[] = [];

  for (const entity of input.entities) {
    const canonicalKey = SCHEDULE_L_ENTITY_MAP[entity.type.toLowerCase()];
    if (!canonicalKey) continue;

    const value = extractMoney(entity);
    if (value === null) continue;

    writes.push(
      upsertDealFinancialFact({
        dealId: input.dealId,
        bankId: input.bankId,
        sourceDocumentId: input.documentId,
        factType: "BALANCE_SHEET",
        factKey: canonicalKey,
        factValueNum: value,
        confidence: entity.confidence,
        factPeriodStart: periodStart,
        factPeriodEnd: periodEnd,
        provenance: {
          source_type: "DOC_EXTRACT",
          source_ref: sourceRef,
          as_of_date: periodEnd,
          extractor: "writeScheduleLFacts:v1",
          confidence: entity.confidence,
        },
      }),
    );
  }

  if (writes.length > 0) {
    const results = await Promise.allSettled(writes);
    factsWritten = results.filter(
      (r) => r.status === "fulfilled" && (r.value as any)?.ok,
    ).length;
  }

  return { factsWritten };
}

// Re-export the entity map for testing
export { SCHEDULE_L_ENTITY_MAP };
