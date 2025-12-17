// lib/intelligence/classifyDocument.ts
import "server-only";
import { extractC3Lite } from "./c3LiteExtract";

export type ClassificationResult = {
  type: string;
  confidence: number;
  borrower?: {
    name?: string;
    address?: { raw?: string };
    ein_last4?: string;
    confidence?: number; // 0..1
  };
};

export async function classifyDocument({
  ocrText,
}: {
  ocrText: string;
}): Promise<ClassificationResult> {
  // -----------------------------------------
  // EXISTING CLASSIFICATION LOGIC (placeholder)
  // -----------------------------------------
  const text = ocrText ?? "";
  let type = "unknown";
  let confidence = 0.5;

  if (/Schedule\s+C/i.test(text) || /Form\s+1040/i.test(text)) {
    type = "tax_return";
    confidence = 0.95;
  } else if (/Balance\s+Sheet/i.test(text)) {
    type = "financial_statement";
    confidence = 0.9;
  } else if (/Profit\s+and\s+Loss/i.test(text) || /\bP&L\b/i.test(text)) {
    type = "profit_and_loss";
    confidence = 0.9;
  }

  const classification: ClassificationResult = { type, confidence };

  // -----------------------------------------
  // C3-LITE ENRICHMENT
  // -----------------------------------------
  const c3Lite = await extractC3Lite({ text });

  if (c3Lite.borrower) {
    classification.borrower = {
      name: c3Lite.borrower.name,
      address: c3Lite.borrower.address
        ? { raw: c3Lite.borrower.address.raw }
        : undefined,
      ein_last4: c3Lite.borrower.ein_last4,
      confidence: c3Lite.borrower.confidence,
    };
  }

  return classification;
}
