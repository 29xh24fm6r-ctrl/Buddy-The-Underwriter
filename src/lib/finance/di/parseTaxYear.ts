// src/lib/finance/di/parseTaxYear.ts

export type TaxYearParseResult = {
  year: number | null;
  confidence: number; // 0..1
  evidence?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Best-effort extraction of tax year from Azure Document Intelligence (or similar) raw JSON.
 * We intentionally support multiple possible shapes because DI models differ.
 */
export function parseTaxYearFromDiRaw(raw: unknown): TaxYearParseResult {
  try {
    if (!isRecord(raw) && !Array.isArray(raw)) return { year: null, confidence: 0 };

    const strings: string[] = [];
    const seen = new Set<unknown>();
    const stack: unknown[] = [raw];
    const LIMIT = 6000;

    while (stack.length && strings.length < LIMIT) {
      const node = stack.pop();
      if (!node) continue;
      if (seen.has(node)) continue;
      seen.add(node);

      // Walk objects
      if (isRecord(node)) {
        for (const k of Object.keys(node)) {
          const v = node[k];

          if (typeof v === "string") strings.push(v);
          else if (typeof v === "number") strings.push(String(v));
          else if (isRecord(v) || Array.isArray(v)) stack.push(v);
        }
      }

      // Walk arrays
      if (Array.isArray(node)) {
        for (const v of node) {
          if (typeof v === "string") strings.push(v);
          else if (typeof v === "number") strings.push(String(v));
          else if (isRecord(v) || Array.isArray(v)) stack.push(v);
        }
      }
    }

    const corpus = strings.join("\n");

    const strongPatterns: Array<{ re: RegExp; evidenceLabel: string }> = [
      { re: /\bTax\s*Year\b[\s:=-]*\b(20\d{2}|19\d{2})\b/i, evidenceLabel: "Tax Year" },
      { re: /\bFor\s+the\s+year\b.*?\b(20\d{2}|19\d{2})\b/i, evidenceLabel: "For the year" },
      { re: /\bYear\s+ended\b.*?\b(20\d{2}|19\d{2})\b/i, evidenceLabel: "Year ended" },
    ];

    for (const p of strongPatterns) {
      const m = corpus.match(p.re);
      const yStr = m?.[1];
      if (!yStr) continue;

      const y = Number(yStr);
      if (y >= 1990 && y <= 2100) {
        return {
          year: y,
          confidence: 0.9,
          evidence: `${p.evidenceLabel}: ${(m?.[0] ?? "").slice(0, 60)}`,
        };
      }
    }

    const dateMatches = corpus.match(
      /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-]((?:20|19)\d{2})\b/g
    );

    if (dateMatches?.length) {
      const counts = new Map<number, number>();

      for (const s of dateMatches) {
        const mm = s.match(/((?:20|19)\d{2})\b/);
        const yStr = mm?.[1];
        if (!yStr) continue;

        const y = Number(yStr);
        if (y < 1990 || y > 2100) continue;

        counts.set(y, (counts.get(y) ?? 0) + 1);
      }

      let bestYear: number | null = null;
      let bestCount = 0;

      for (const [y, c] of counts.entries()) {
        if (c > bestCount) {
          bestYear = y;
          bestCount = c;
        }
      }

      if (bestYear) {
        return { year: bestYear, confidence: 0.55, evidence: `Dates suggest year ${bestYear}` };
      }
    }

    const yearTokens = corpus.match(/\b(20\d{2}|19\d{2})\b/g);
    if (yearTokens?.length) {
      const counts = new Map<number, number>();

      for (const t of yearTokens) {
        const y = Number(t);
        if (y < 1990 || y > 2100) continue;
        counts.set(y, (counts.get(y) ?? 0) + 1);
      }

      let bestYear: number | null = null;
      let bestCount = 0;

      for (const [y, c] of counts.entries()) {
        if (c > bestCount) {
          bestYear = y;
          bestCount = c;
        }
      }

      if (bestYear) {
        return { year: bestYear, confidence: 0.35, evidence: `Frequent year token ${bestYear}` };
      }
    }

    return { year: null, confidence: 0 };
  } catch {
    return { year: null, confidence: 0 };
  }
}
