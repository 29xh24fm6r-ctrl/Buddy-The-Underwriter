import { getDealRecord, seedDealIfMissing } from "@/lib/db/dealRecords";
import { listDocuments } from "@/lib/db/docRecords";
import { listExtracts } from "@/lib/db/extractRecords";
import type { DealContext, EvidenceRef } from "./contextTypes";

// Deterministic underwriting metrics (placeholder calc)
// Replace with your real spread engine as inputs become structured.
function computeSpread(extracts: any[]): DealContext["spread"] {
  // Try to find DSCR/LTV in extracted fields
  const fieldFind = (keys: string[]) => {
    for (const ex of extracts) {
      for (const k of keys) {
        const v = ex.fields?.[k];
        if (typeof v === "number") return v;
        if (typeof v === "string" && v.trim() && !isNaN(Number(v))) return Number(v);
      }
    }
    return undefined;
  };

  const dscr = fieldFind(["dscr", "DSCR", "DebtServiceCoverage"]);
  const ltv = fieldFind(["ltv", "LTV", "LoanToValue"]);
  const revenue = fieldFind(["Revenue", "REVENUE", "Revenue_TTM", "Sales"]);
  const ebitda = fieldFind(["EBITDA", "Ebitda", "EBITDA_TTM"]);
  const netIncome = fieldFind(["NetIncome", "Net Income", "NetIncome_TTM"]);

  return {
    base: { dscr, ltv },
    downside: {
      dscr: dscr ? Math.max(0, dscr * 0.85) : undefined,
      assumptions: ["Revenue -10%", "Margin compression", "Fixed costs unchanged"],
    },
    rateShock: {
      dscr: dscr ? Math.max(0, dscr * 0.9) : undefined,
      deltaRateBps: 200,
    },
    evidence: [],
  };
}

export async function buildDealContext(dealId: string): Promise<DealContext> {
  const deal = getDealRecord(dealId) ?? seedDealIfMissing(dealId);
  const docs = listDocuments(dealId);
  const extracts = listExtracts(dealId);

  const evidenceIndex: EvidenceRef[] = [];
  for (const ex of extracts) {
    for (const ev of ex.evidence ?? []) evidenceIndex.push(ev);
  }

  const spread = computeSpread(extracts);

  return {
    dealId,
    dealName: deal.dealName,
    requestedClosingDate: deal.requestedClosingDate,
    status: deal.status,

    borrower: deal.borrower ?? { legalName: "UNKNOWN" },
    sponsors: deal.sponsors ?? [],
    facilities: deal.facilities ?? [],
    sourcesUses: deal.sourcesUses ?? { sources: [], uses: [] },
    collateral: deal.collateral ?? [],

    financials: deal.financials ?? [],
    spread,

    documents: docs.map((d: any) => ({
      docId: d.id,
      docName: d.name,
      docType: d.type,
      status: d.status,
    })),

    extracts: extracts.map((e: any) => ({
      docId: e.docId,
      docName: e.docName,
      docType: e.docType,
      extractedAt: e.extractedAt,
      fields: e.fields,
      tables: e.tables,
      evidence: e.evidence,
    })),

    evidenceIndex,
  };
}
