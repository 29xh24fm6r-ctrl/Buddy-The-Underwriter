import "server-only";

export type InferredDocumentType =
  | "business_tax_return"
  | "personal_tax_return"
  | "income_statement"
  | "balance_sheet"
  | "financial_statement"
  | "unknown";

export type InferDocumentMetadataInput = {
  originalFilename: string | null;
  extractedText?: string | null;
};

export type InferDocumentMetadataResult = {
  document_type: InferredDocumentType;
  doc_year: number | null;
  doc_years: number[] | null;
  confidence: number;
  reason: string;
};

function extractYearsFromString(input: string): number[] {
  const years = new Set<number>();
  const re = /\b(20[0-3][0-9])\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const year = Number(m[1]);
    if (year >= 2000 && year <= 2039) years.add(year);
  }
  return Array.from(years).sort((a, b) => b - a);
}

function extractStrongYearsFromText(text: string): number[] {
  const years = new Set<number>();

  const patterns: RegExp[] = [
    /for\s+calendar\s+year\s+(20[0-3][0-9])/gi,
    /for\s+tax\s+year\s+(20[0-3][0-9])/gi,
    /tax\s+year\s+ending\s+.*?(20[0-3][0-9])/gi,
    /year\s+ending\s+.*?(20[0-3][0-9])/gi,
    /beginning\s+.*?(20[0-3][0-9])\s+and\s+ending\s+.*?(20[0-3][0-9])/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      for (let i = 1; i < m.length; i++) {
        const year = Number(m[i]);
        if (Number.isFinite(year) && year >= 2000 && year <= 2039) years.add(year);
      }
    }
  }

  return Array.from(years).sort((a, b) => b - a);
}

function clampYear(y: number): number | null {
  if (!Number.isFinite(y)) return null;
  const yy = Math.trunc(y);
  if (yy < 2000 || yy > 2039) return null;
  return yy;
}

/**
 * For tax returns, we want the *tax year* (e.g. 2023) not the filing year.
 * Many forms include both (e.g. "beginning 2023 and ending 2024").
 */
function inferTaxYearFromText(textRaw: string): { taxYear: number | null; evidence: string | null } {
  const text = String(textRaw || "");
  if (!text.trim()) return { taxYear: null, evidence: null };

  // Highest signal: explicit calendar/tax year statements.
  // Examples:
  // - "For calendar year 2023"
  // - "For tax year 2023"
  {
    const m = text.match(/for\s+(?:the\s+)?(?:calendar|tax)\s+year\s+(20[0-3][0-9])\b/i);
    if (m?.[1]) {
      const y = clampYear(Number(m[1]));
      if (y) return { taxYear: y, evidence: "for_calendar_or_tax_year" };
    }
  }

  // Common 1040 phrasing:
  // - "For the year Jan. 1–Dec. 31, 2023"
  {
    const m = text.match(/for\s+the\s+year[\s\S]{0,40}?(20[0-3][0-9])\b/i);
    if (m?.[1]) {
      const y = clampYear(Number(m[1]));
      if (y) return { taxYear: y, evidence: "for_the_year" };
    }
  }

  // Common corporate/partnership phrasing:
  // - "tax year beginning ... 2023 and ending ... 2024" -> choose 2023
  // - "beginning ... 2023 and ending ... 2024" -> choose 2023
  {
    const m = text.match(/(?:tax\s+year\s+)?beginning[\s\S]{0,60}?(20[0-3][0-9])\b[\s\S]{0,60}?and\s+ending[\s\S]{0,60}?(20[0-3][0-9])\b/i);
    if (m?.[1]) {
      const y = clampYear(Number(m[1]));
      if (y) return { taxYear: y, evidence: "beginning_and_ending" };
    }
  }

  // Fallback: "year ending ... 2023" (less ideal; can be fiscal year-end)
  {
    const m = text.match(/year\s+ending[\s\S]{0,40}?(20[0-3][0-9])\b/i);
    if (m?.[1]) {
      const y = clampYear(Number(m[1]));
      if (y) return { taxYear: y, evidence: "year_ending" };
    }
  }

  return { taxYear: null, evidence: null };
}

function inferTypeFromTextOrFilename(args: {
  filename: string;
  text: string;
}): { type: InferredDocumentType; anchor: string | null } {
  const hay = `${args.filename}\n${args.text}`.toLowerCase();

  const looksLikeIncomeStatement =
    /\b(profit\s*and\s*loss|p\s*\&\s*l|p\&l|income\s*statement|statement\s*of\s*operations|statement\s*of\s*income)\b/i.test(
      hay,
    );
  const looksLikeBalanceSheet =
    /\b(balance\s*sheet|statement\s*of\s*financial\s*position)\b/i.test(hay);

  // Business returns
  if (
    /\b(form\s*)?(1120s|1120-s|1120|1065)\b/i.test(hay) ||
    /\b(schedule\s*k-?1|k-?1)\b/i.test(hay) ||
    /\b(btr|business\s*tax)\b/i.test(hay)
  ) {
    return { type: "business_tax_return", anchor: "business_form_token" };
  }

  // Personal returns
  if (/\b(form\s*)?(1040|1040-sr|1040sr)\b/i.test(hay) || /\b(ptr|personal\s*tax)\b/i.test(hay)) {
    return { type: "personal_tax_return", anchor: "personal_form_token" };
  }

  // Financial statements
  // Some uploads include both statements in one PDF; represent that as a combined type.
  if (looksLikeIncomeStatement && looksLikeBalanceSheet) {
    return { type: "financial_statement", anchor: "pl+bs_token" };
  }
  if (looksLikeIncomeStatement) {
    return { type: "income_statement", anchor: "pl_token" };
  }
  if (looksLikeBalanceSheet) {
    return { type: "balance_sheet", anchor: "bs_token" };
  }

  return { type: "unknown", anchor: null };
}

export function inferDocumentMetadata(
  input: InferDocumentMetadataInput,
): InferDocumentMetadataResult {
  const filename = String(input.originalFilename || "");
  const text = String(input.extractedText || "");

  const { type, anchor } = inferTypeFromTextOrFilename({ filename, text });

  const taxYearInference =
    type === "business_tax_return" || type === "personal_tax_return"
      ? inferTaxYearFromText(text)
      : { taxYear: null as number | null, evidence: null as string | null };

  const strongYears = text ? extractStrongYearsFromText(text) : [];
  const filenameYears = extractYearsFromString(filename);
  const weakTextYears = text ? extractYearsFromString(text) : [];

  const years = Array.from(
    new Set<number>([...strongYears, ...filenameYears, ...weakTextYears]),
  ).sort((a, b) => b - a);

  // Prefer inferred tax year when available (avoid selecting filing year).
  const preferredYear = taxYearInference.taxYear;
  const doc_year = preferredYear ?? (years.length ? years[0] : null);
  const doc_years =
    preferredYear != null
      ? Array.from(new Set<number>([preferredYear, ...years])).sort((a, b) => b - a)
      : years.length
        ? years
        : null;

  // Confidence heuristic
  let confidence = 0.0;
  let reason = "no_signal";

  if (anchor && taxYearInference.taxYear && taxYearInference.evidence) {
    confidence = 0.94;
    reason = `${anchor}+tax_year:${taxYearInference.evidence}`;
  } else if (anchor && strongYears.length) {
    confidence = 0.92;
    reason = `${anchor}+strong_year_phrase`;
  } else if (anchor && (filenameYears.length || weakTextYears.length)) {
    confidence = 0.78;
    reason = `${anchor}+year_found`;
  } else if (anchor) {
    confidence = 0.7;
    reason = anchor;
  } else if (taxYearInference.taxYear && taxYearInference.evidence) {
    confidence = 0.7;
    reason = `tax_year:${taxYearInference.evidence}`;
  } else if (strongYears.length) {
    confidence = 0.65;
    reason = "strong_year_phrase_only";
  } else if (filenameYears.length) {
    confidence = 0.6;
    reason = "filename_year_only";
  } else if (weakTextYears.length) {
    confidence = 0.55;
    reason = "text_year_only";
  }

  return {
    document_type: type,
    doc_year,
    doc_years,
    confidence,
    reason,
  };
}
