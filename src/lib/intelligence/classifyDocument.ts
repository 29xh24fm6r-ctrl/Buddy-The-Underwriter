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
  if (!text) return null;

  // 1. Highest signal: explicit "for calendar/tax year YYYY"
  const explicit = text.match(
    /for\s+(?:the\s+)?(?:calendar|tax)\s+year\s+(20[0-3]\d)\b/i,
  );
  if (explicit?.[1]) return explicit[1];

  // 2. Common 1040: "For the year Jan. 1–Dec. 31, YYYY"
  const forYear = text.match(
    /for\s+the\s+year[\s\S]{0,40}?(20[0-3]\d)\b/i,
  );
  if (forYear?.[1]) return forYear[1];

  // 3. Corporate/partnership: "beginning YYYY and ending YYYY" → pick beginning
  const beginEnd = text.match(
    /(?:tax\s+year\s+)?beginning[\s\S]{0,60}?(20[0-3]\d)\b[\s\S]{0,60}?and\s+ending[\s\S]{0,60}?(20[0-3]\d)\b/i,
  );
  if (beginEnd?.[1]) return beginEnd[1];

  // 4. Calendar year end: "December 31, YYYY" or "12/31/YYYY"
  const calYear = text.match(/(?:december\s+31|12\/31)[,\s]+(\d{4})/i);
  if (calYear?.[1]) {
    const y = Number(calYear[1]);
    if (y >= 2000 && y <= 2039) return String(y);
  }

  // 5. Fallback: first 500 chars, prefer the LOWEST plausible year (tax year,
  //    not preparation/filing year) to avoid picking future dates.
  const head = text.slice(0, 500);
  const allYears = [...head.matchAll(/\b(20[0-3]\d)\b/g)]
    .map((m) => Number(m[1]))
    .filter((y) => y >= 2000 && y <= 2039);
  if (allYears.length > 0) {
    // Remove years > current year (can't file a return for the future)
    const currentYear = new Date().getFullYear();
    const valid = allYears.filter((y) => y <= currentYear);
    if (valid.length > 0) {
      // Among valid years, prefer the most common; break ties with lowest
      const freq = new Map<number, number>();
      for (const y of valid) freq.set(y, (freq.get(y) ?? 0) + 1);
      const sorted = [...freq.entries()].sort(
        (a, b) => b[1] - a[1] || a[0] - b[0],
      );
      return String(sorted[0][0]);
    }
  }

  return null;
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
