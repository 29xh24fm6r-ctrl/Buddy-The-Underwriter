import { CHECKLIST_RULES, AiDocType, ChecklistKey } from "./taxonomy";

export type GeminiScanResult = {
  docType?: string;
  subtype?: string;
  issuer?: string;
  formNumbers?: string[];
  taxYear?: number;
  periodStart?: string;
  periodEnd?: string;
  borrowerName?: string;
  businessName?: string;
  confidence?: number;
  extracted?: any;
  textHints?: string[];
};

export type MappingSuggestion = {
  checklistKey: ChecklistKey;
  docYear?: number | null;
  confidence: number;
  reason: string;
  features: Record<string, any>;
};

function extractFormNumbersFromText(textRaw: string): string[] {
  const text = String(textRaw || "");
  if (!text.trim()) return [];

  const hits = new Set<string>();

  // Common IRS form tokens.
  const re = /\b(?:form\s*)?(1040|1065|1120s|1120-s|1120|990|941|940)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = String(m[1] || "").toUpperCase().replace("-", "");
    if (v) hits.add(v);
  }

  if (/\bschedule\s+k-?1\b/i.test(text)) hits.add("K-1");
  if (/\bsba\s*form\s*1919\b/i.test(text)) hits.add("SBA_1919");
  if (/\bsba\s*form\s*413\b/i.test(text)) hits.add("SBA_413");

  return Array.from(hits);
}

function inferIssuer(textRaw: string): string | null {
  const text = String(textRaw || "");
  if (!text.trim()) return null;

  if (/\binternal\s+revenue\s+service\b/i.test(text) || /\birs\b/i.test(text)) return "IRS";
  if (/\bsocial\s+security\s+number\b/i.test(text) && /\bform\s*1040\b/i.test(text)) return "IRS";

  // Insurer hints.
  if (/\bdeclarations\b/i.test(text) && /\binsurance\b/i.test(text)) return "INSURER";

  // Bank statement hints.
  if (/\baccount\s+statement\b/i.test(text) || /\bbalance\s+forward\b/i.test(text)) return "BANK";

  return null;
}

function normalizeDocType(scan: GeminiScanResult): AiDocType {
  const t = (scan.docType || "").toLowerCase();
  const sub = (scan.subtype || "").toLowerCase();
  const forms = (scan.formNumbers || []).map((x) => String(x).toLowerCase());

  // Canonical strings already used elsewhere in Buddy.
  if (t === "business_tax_return") return "business_tax_return";
  if (t === "personal_tax_return") return "personal_tax_return";

  // Tax returns
  if (t.includes("tax") || forms.some((f) => ["1040", "1065", "1120", "1120s", "990"].includes(f))) {
    if (forms.includes("1040") || sub.includes("1040")) return "personal_tax_return";
    return "business_tax_return";
  }

  // PFS
  if (t.includes("personal financial") || t.includes("pfs") || t.includes("sba_413") || forms.includes("sba_413")) {
    return "personal_financial_statement";
  }

  // Rent roll / operating statement / T12
  if (t.includes("rent roll")) return "rent_roll";
  if (t.includes("t12") || t.includes("trailing 12") || t.includes("operating statement") || t.includes("income statement")) {
    return "operating_statement";
  }

  // Insurance
  if (t.includes("insurance") || t.includes("declarations")) return "insurance_declarations";

  // Bank statements
  if (t.includes("bank statement") || t.includes("account statement")) return "bank_statement";

  // Lease
  if (t.includes("lease")) return "lease";

  // Appraisal
  if (t.includes("appraisal")) return "appraisal";

  // Tax bill
  if (t.includes("tax bill") || t.includes("property tax")) return "tax_bill";

  // Use statement / occupancy
  if (t.includes("occupancy") || t.includes("use statement") || t.includes("property use")) return "use_statement";

  // YTD financials
  if (t.includes("ytd") || t.includes("year to date") || t.includes("interim")) return "ytd_financials";

  return "unknown";
}

export function mapGeminiScanToChecklist(scan: GeminiScanResult): MappingSuggestion[] {
  const aiType = normalizeDocType(scan);
  const baseConf = Math.max(0, Math.min(1, scan.confidence ?? 0.6));

  if (aiType === "unknown") return [];

  const suggestions: MappingSuggestion[] = [];

  for (const rule of CHECKLIST_RULES) {
    if (!rule.accepts.includes(aiType)) continue;

    const docYear = rule.yearAware ? (scan.taxYear ?? null) : null;

    let conf = baseConf;
    if (rule.yearAware) conf = docYear ? Math.min(1, conf + 0.15) : Math.max(0, conf - 0.2);

    const reasonParts = [
      `aiType=${aiType}`,
      rule.yearAware ? `taxYear=${docYear ?? "missing"}` : null,
      scan.formNumbers?.length ? `forms=${scan.formNumbers.join(",")}` : null,
      scan.issuer ? `issuer=${scan.issuer}` : null,
    ].filter(Boolean);

    suggestions.push({
      checklistKey: rule.key,
      docYear,
      confidence: conf,
      reason: reasonParts.join(" | "),
      features: {
        aiType,
        issuer: scan.issuer,
        formNumbers: scan.formNumbers,
        taxYear: scan.taxYear,
        periodStart: scan.periodStart,
        periodEnd: scan.periodEnd,
        borrowerName: scan.borrowerName,
        businessName: scan.businessName,
      },
    });
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions;
}

export function buildGeminiScanResultFromExtractedText(args: {
  extractedText: string;
  inferredDocType?: string | null;
  inferredTaxYear?: number | null;
  confidence01?: number | null;
  extracted?: any;
}): GeminiScanResult {
  const forms = extractFormNumbersFromText(args.extractedText);
  const issuer = inferIssuer(args.extractedText) ?? null;

  return {
    docType: args.inferredDocType ?? undefined,
    subtype: forms.find((f) => f === "1040" || f === "1120" || f === "1120S" || f === "1065") ?? undefined,
    issuer: issuer ?? undefined,
    formNumbers: forms.length ? forms : undefined,
    taxYear: args.inferredTaxYear ?? undefined,
    confidence: typeof args.confidence01 === "number" ? Math.max(0, Math.min(1, args.confidence01)) : undefined,
    extracted: args.extracted,
  };
}
