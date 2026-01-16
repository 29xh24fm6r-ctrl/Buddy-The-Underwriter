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
  const re = new RegExp(`${label}[^\n\r]{0,80}?(\$?\(?-?[0-9][0-9,]*\)?(?:\.[0-9]{1,2})?)`, "i");
  const m = text.match(re);
  if (!m) return { value: null, snippet: null };
  const snippet = normalizeText(m[0]);
  return { value: parseMoney(m[1]), snippet };
}

export type ExtractedCollateralFact = {
  factKey: "GROSS_VALUE" | "NET_VALUE" | "DISCOUNTED_VALUE";
  value: number;
  confidence: number;
  provenance: FinancialFactProvenance;
};

export function extractCollateralFactsFromText(args: {
  extractedText: string;
  documentId: string;
  docType: string | null;
}): ExtractedCollateralFact[] {
  const text = args.extractedText ?? "";
  if (!text.trim()) return [];

  const out: ExtractedCollateralFact[] = [];

  // Appraisal-ish heuristics
  const gross =
    findLabeledAmount(text, "as-is value").value !== null
      ? findLabeledAmount(text, "as-is value")
      : findLabeledAmount(text, "appraised value");

  const net =
    findLabeledAmount(text, "net collateral value").value !== null
      ? findLabeledAmount(text, "net collateral value")
      : findLabeledAmount(text, "net value");

  const discounted =
    findLabeledAmount(text, "discounted value").value !== null
      ? findLabeledAmount(text, "discounted value")
      : findLabeledAmount(text, "discounted collateral");

  const mkProv = (snippet: string | null, confidence: number): FinancialFactProvenance => ({
    source_type: "DOC_EXTRACT",
    source_ref: `deal_documents:${args.documentId}`,
    as_of_date: null,
    extractor: "extractCollateralFactsFromText:v1",
    confidence,
    citations: snippet ? [{ page: null, snippet }] : [],
    raw_snippets: snippet ? [snippet] : [],
  });

  if (gross.value !== null) {
    out.push({ factKey: "GROSS_VALUE", value: gross.value, confidence: 0.6, provenance: mkProv(gross.snippet, 0.6) });
  }
  if (net.value !== null) {
    out.push({ factKey: "NET_VALUE", value: net.value, confidence: 0.5, provenance: mkProv(net.snippet, 0.5) });
  }
  if (discounted.value !== null) {
    out.push({ factKey: "DISCOUNTED_VALUE", value: discounted.value, confidence: 0.55, provenance: mkProv(discounted.snippet, 0.55) });
  }

  return out;
}
