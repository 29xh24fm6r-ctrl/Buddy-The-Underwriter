import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";

function normalizeText(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function parseMoney(raw: string): number | null {
  const cleaned = raw
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .replace(/\(([^)]+)\)/g, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function findLabeledAmount(text: string, label: string): { value: number | null; snippet: string | null } {
  // Look for: "<label> .... $1,234,567" within the next ~80 chars
  const re = new RegExp(`${label}[^\n\r]{0,80}?(\$?\(?-?[0-9][0-9,]*\)?(?:\.[0-9]{1,2})?)`, "i");
  const m = text.match(re);
  if (!m) return { value: null, snippet: null };
  const snippet = normalizeText(m[0]);
  return { value: parseMoney(m[1]), snippet };
}

export type ExtractedFact = {
  factKey: "TOTAL_PROJECT_COST" | "BORROWER_EQUITY" | "BANK_LOAN_TOTAL";
  value: number;
  confidence: number;
  provenance: FinancialFactProvenance;
};

export function extractSourcesUsesFactsFromText(args: {
  extractedText: string;
  documentId: string;
  docType: string | null;
}): ExtractedFact[] {
  const text = args.extractedText ?? "";
  if (!text.trim()) return [];

  const out: ExtractedFact[] = [];

  const total =
    findLabeledAmount(text, "total project cost").value !== null
      ? findLabeledAmount(text, "total project cost")
      : findLabeledAmount(text, "total uses");

  const equity =
    findLabeledAmount(text, "borrower equity").value !== null
      ? findLabeledAmount(text, "borrower equity")
      : findLabeledAmount(text, "cash injection");

  const loan =
    findLabeledAmount(text, "bank loan").value !== null
      ? findLabeledAmount(text, "bank loan")
      : findLabeledAmount(text, "loan amount");

  const mkProv = (snippet: string | null, confidence: number): FinancialFactProvenance => ({
    source_type: "DOC_EXTRACT",
    source_ref: `deal_documents:${args.documentId}`,
    as_of_date: null,
    extractor: "extractSourcesUsesFactsFromText:v1",
    confidence,
    citations: snippet ? [{ page: null, snippet }] : [],
    raw_snippets: snippet ? [snippet] : [],
  });

  if (total.value !== null) {
    out.push({
      factKey: "TOTAL_PROJECT_COST",
      value: total.value,
      confidence: 0.65,
      provenance: mkProv(total.snippet, 0.65),
    });
  }

  if (equity.value !== null) {
    out.push({
      factKey: "BORROWER_EQUITY",
      value: equity.value,
      confidence: 0.6,
      provenance: mkProv(equity.snippet, 0.6),
    });
  }

  if (loan.value !== null) {
    out.push({
      factKey: "BANK_LOAN_TOTAL",
      value: loan.value,
      confidence: 0.7,
      provenance: mkProv(loan.snippet, 0.7),
    });
  }

  return out;
}
