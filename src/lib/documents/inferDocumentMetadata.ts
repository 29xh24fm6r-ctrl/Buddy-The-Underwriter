import "server-only";

export type InferredDocumentType =
  | "business_tax_return"
  | "personal_tax_return"
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

function inferTypeFromTextOrFilename(args: {
  filename: string;
  text: string;
}): { type: InferredDocumentType; anchor: string | null } {
  const hay = `${args.filename}\n${args.text}`.toLowerCase();

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

  return { type: "unknown", anchor: null };
}

export function inferDocumentMetadata(
  input: InferDocumentMetadataInput,
): InferDocumentMetadataResult {
  const filename = String(input.originalFilename || "");
  const text = String(input.extractedText || "");

  const { type, anchor } = inferTypeFromTextOrFilename({ filename, text });

  const strongYears = text ? extractStrongYearsFromText(text) : [];
  const filenameYears = extractYearsFromString(filename);
  const weakTextYears = text ? extractYearsFromString(text) : [];

  const years = Array.from(
    new Set<number>([...strongYears, ...filenameYears, ...weakTextYears]),
  ).sort((a, b) => b - a);

  const doc_years = years.length ? years : null;
  const doc_year = years.length ? years[0] : null;

  // Confidence heuristic
  let confidence = 0.0;
  let reason = "no_signal";

  if (anchor && strongYears.length) {
    confidence = 0.92;
    reason = `${anchor}+strong_year_phrase`;
  } else if (anchor && (filenameYears.length || weakTextYears.length)) {
    confidence = 0.78;
    reason = `${anchor}+year_found`;
  } else if (anchor) {
    confidence = 0.7;
    reason = anchor;
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
