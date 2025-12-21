import "server-only";

type AzureWord = {
  content?: string;
  text?: string;
  polygon?: Array<{ x: number; y: number }>;
  boundingPolygon?: Array<{ x: number; y: number }>;
};

type AzurePage = {
  pageNumber?: number;
  page_number?: number;
  width?: number;
  height?: number;
  words?: AzureWord[];
};

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function polygonToBBox(poly: Array<{ x: number; y: number }>) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const p of poly) {
    const x = num(p?.x);
    const y = num(p?.y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function getAnalyzeResultPages(raw: any): AzurePage[] {
  // Handles multiple Azure DI response shapes.
  // Common shapes:
  // raw.analyzeResult.pages
  // raw.analyzeResult.documentPages
  // raw.pages
  const ar = raw?.analyzeResult ?? raw;
  const pages =
    ar?.pages ??
    ar?.documentPages ??
    raw?.pages ??
    [];

  return Array.isArray(pages) ? pages : [];
}

function getWordPolygon(w: any): Array<{ x: number; y: number }> | null {
  const poly = w?.polygon ?? w?.boundingPolygon ?? w?.bounding_box ?? null;
  if (!Array.isArray(poly) || poly.length < 4) return null;
  return poly.map((p: any) => ({ x: num(p?.x), y: num(p?.y) }));
}

export type NormalizedWordBox = {
  page_number: number;
  word_index: number;
  content: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export function extractNormalizedWordBoxesFromAzure(rawJson: any): NormalizedWordBox[] {
  const pages = getAnalyzeResultPages(rawJson);
  const out: NormalizedWordBox[] = [];

  for (const pg of pages) {
    const pageNumber = num(pg?.pageNumber ?? pg?.page_number ?? 1, 1);
    const width = num(pg?.width, 0);
    const height = num(pg?.height, 0);
    const words = Array.isArray(pg?.words) ? pg.words : [];

    // If width/height missing, we still store unnormalized but clamped (will degrade).
    const denomW = width > 0 ? width : 1;
    const denomH = height > 0 ? height : 1;

    let idx = 0;
    for (const w of words) {
      const content = String(w?.content ?? w?.text ?? "").trim();
      if (!content) continue;

      const poly = getWordPolygon(w);
      if (!poly) continue;

      const bb = polygonToBBox(poly);
      if (!bb) continue;

      const x1 = clamp01(bb.minX / denomW);
      const y1 = clamp01(bb.minY / denomH);
      const x2 = clamp01(bb.maxX / denomW);
      const y2 = clamp01(bb.maxY / denomH);

      out.push({
        page_number: pageNumber,
        word_index: idx,
        content,
        x1,
        y1,
        x2,
        y2,
      });

      idx++;
    }
  }

  return out;
}
