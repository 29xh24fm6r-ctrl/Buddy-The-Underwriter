// Placeholder type until pdfTextCoords module is implemented
type TextItemCoord = { str: string; page: number; x: number; y: number; w?: number; h?: number };

/**
 * Heuristic signals:
 * - Too few tokens overall or per page
 * - Too little alphabetic content (scanned PDFs often have zero tokens)
 * - Low unique token diversity
 */
export function scoreTextLayer(items: TextItemCoord[]) {
  const total = items.length;
  const pages = Array.from(new Set(items.map((i) => i.page)));
  const pagesCount = pages.length || 1;

  const perPage = total / pagesCount;

  let alphaChars = 0;
  let totalChars = 0;

  const uniq = new Set<string>();
  for (const it of items) {
    const s = (it.str ?? "").toString();
    totalChars += s.length;
    alphaChars += (s.match(/[A-Za-z]/g) ?? []).length;
    const key = s.trim().toLowerCase();
    if (key) uniq.add(key);
  }

  const alphaRatio = totalChars > 0 ? alphaChars / totalChars : 0;
  const uniqueRatio = total > 0 ? uniq.size / total : 0;

  // Score: higher is better
  let score = 0;
  if (total >= 1200) score += 3;
  else if (total >= 400) score += 2;
  else if (total >= 120) score += 1;

  if (perPage >= 250) score += 2;
  else if (perPage >= 120) score += 1;

  if (alphaRatio >= 0.35) score += 2;
  else if (alphaRatio >= 0.18) score += 1;

  if (uniqueRatio >= 0.45) score += 1;

  const scannedLikely =
    total < 120 || perPage < 50 || alphaRatio < 0.12;

  return {
    score,                // 0-8
    totalTokens: total,
    pagesCount,
    tokensPerPage: perPage,
    alphaRatio,
    uniqueRatio,
    scannedLikely,
  };
}
