// src/lib/intelligence/classifyDocument.ts
import "server-only";

export type ClassificationResult = {
  doc_type:
    | "IRS_1040"
    | "IRS_1065"
    | "IRS_1120"
    | "IRS_1120S"
    | "K1"
    | "PFS"
    | "BANK_STATEMENT"
    | "LEASE"
    | "FINANCIAL_STATEMENT"
    | "INVOICE"
    | "UNKNOWN";
  confidence: number; // 0-100
  reasons: string[];
  tags: string[];
  tax_year: string | null;

  // Optional extras (safe to include; UI will ignore if unused)
  pack?: boolean;
  subtypes?: string[];
  issuer_hint?: string | null;

  // C3-lite (optional) — keep shape compatible with UploadBox.tsx
  borrower?: {
    name?: string;
    address?: { raw?: string };
    ein_last4?: string;
    confidence?: number; // 0..1
  };
};

function norm(s: string) {
  return (s || "").toLowerCase();
}

function pickTaxYear(text: string): string | null {
  const m = text.match(/\b(19|20)\d{2}\b/g);
  if (!m || m.length === 0) return null;
  // prefer the latest year mentioned
  const years = Array.from(new Set(m)).sort();
  return years[years.length - 1] ?? null;
}

function looksLikePAndL(t: string) {
  return (
    t.includes("profit and loss") ||
    t.includes("income statement") ||
    (t.includes("revenue") && t.includes("expenses") && t.includes("net income"))
  );
}

function looksLikeBalanceSheet(t: string) {
  return (
    t.includes("balance sheet") ||
    (t.includes("assets") && t.includes("liabilities") && t.includes("equity"))
  );
}

function looksLikeBankStatement(t: string) {
  return (
    t.includes("account number") ||
    t.includes("beginning balance") ||
    t.includes("ending balance") ||
    t.includes("deposits and other credits") ||
    t.includes("withdrawals and other debits")
  );
}

function looksLikeLease(t: string) {
  return t.includes("landlord") || t.includes("tenant") || t.includes("premises") || t.includes("base rent");
}

function looksLikeInvoice(t: string) {
  return t.includes("invoice") || t.includes("bill to") || t.includes("amount due") || t.includes("invoice number");
}

function looksLikeTaxReturn(text: string) {
  const t = norm(text);
  if (t.includes("form 1040")) return "IRS_1040";
  if (t.includes("form 1065")) return "IRS_1065";
  if (t.includes("form 1120-s") || t.includes("form 1120s")) return "IRS_1120S";
  if (t.includes("form 1120")) return "IRS_1120";
  if (t.includes("schedule k-1") || t.includes("k-1")) return "K1";
  return null;
}

/**
 * classifyDocument
 * Input: OCR text preview (string)
 * Output: stable, UI-compatible classification object
 */
export async function classifyDocument({ ocrText }: { ocrText: string }): Promise<ClassificationResult> {
  const t = norm(ocrText);
  const reasons: string[] = [];
  const tags: string[] = [];
  let doc_type: ClassificationResult["doc_type"] = "UNKNOWN";
  let confidence = 55;

  const taxYear = pickTaxYear(ocrText);

  const tax = looksLikeTaxReturn(ocrText);
  if (tax) {
    doc_type = tax as any;
    confidence = 92;
    reasons.push(`Matched tax return keyword: ${tax}`);
    if (taxYear) reasons.push(`Detected year: ${taxYear}`);
    return {
      doc_type,
      confidence,
      reasons,
      tags,
      tax_year: taxYear,
      pack: false,
    };
  }

  if (looksLikePAndL(t) || looksLikeBalanceSheet(t)) {
    doc_type = "FINANCIAL_STATEMENT";
    confidence = 88;
    reasons.push("Detected financial statement terms (P&L / Balance Sheet)");
    if (looksLikePAndL(t)) tags.push("P&L");
    if (looksLikeBalanceSheet(t)) tags.push("BalanceSheet");
    return {
      doc_type,
      confidence,
      reasons,
      tags,
      tax_year: taxYear,
    };
  }

  if (looksLikeBankStatement(t)) {
    doc_type = "BANK_STATEMENT";
    confidence = 85;
    reasons.push("Detected bank statement terms (balances/credits/debits)");
    return { doc_type, confidence, reasons, tags, tax_year: taxYear };
  }

  if (looksLikeLease(t)) {
    doc_type = "LEASE";
    confidence = 82;
    reasons.push("Detected lease terms (landlord/tenant/rent/premises)");
    return { doc_type, confidence, reasons, tags, tax_year: taxYear };
  }

  if (looksLikeInvoice(t)) {
    doc_type = "INVOICE";
    confidence = 80;
    reasons.push("Detected invoice terms (invoice/amount due/invoice number)");
    return { doc_type, confidence, reasons, tags, tax_year: taxYear };
  }

  return {
    doc_type,
    confidence,
    reasons: reasons.length ? reasons : ["No strong document-type indicators found"],
    tags,
    tax_year: taxYear,
  };
}
