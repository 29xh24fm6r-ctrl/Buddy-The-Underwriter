/**
 * Producer-side normalization of page references in a DocAI chunk response.
 *
 * After applying offsets, the JSON looks as if DocAI processed the full
 * document in a single call — no consumer offset logic required.
 *
 * Handles all known page-indexed fields in the Document AI v1 response:
 *   - document.pages[].pageNumber           (1-based integer)
 *   - pageAnchor.pageRefs[].page            (0-based, may be omitted for 0)
 *   - textAnchor.textSegments[].startIndex   (0-based string int64, may be omitted for 0)
 *   - textAnchor.textSegments[].endIndex     (string int64)
 *   - pageSpan.pageStart / pageEnd           (1-based, documentLayout + chunkedDocument)
 *
 * Pure function — no DB, no IO, no server-only deps. Safe to import in CI tests.
 */

export function applyPageOffsetToDocAiJson(
  response: any,
  pageOffset: number,
  textOffset: number,
): any {
  if (!response || (pageOffset === 0 && textOffset === 0)) return response;

  // Deep clone to avoid mutating the original
  const r = JSON.parse(JSON.stringify(response));

  // Recursive walk handles all known page-indexed fields
  walkAndOffset(r, pageOffset, textOffset);

  return r;
}

// ── Internal helpers ─────────────────────────────────────────────────────

function walkAndOffset(obj: any, pageOffset: number, textOffset: number): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) walkAndOffset(item, pageOffset, textOffset);
    return;
  }

  // document.pages[].pageNumber (1-based integer)
  if ("pageNumber" in obj) {
    const pn = toNum(obj.pageNumber);
    if (pn !== null) obj.pageNumber = pn + pageOffset;
  }

  // pageAnchor.pageRefs[].page (0-based int32, may be omitted for 0)
  if (Array.isArray(obj.pageRefs)) {
    for (const ref of obj.pageRefs) {
      const page = toNum(ref.page) ?? 0; // omitted = 0 (protobuf default)
      ref.page = page + pageOffset;
    }
  }

  // textAnchor.textSegments[].startIndex/endIndex (0-based string int64, may be omitted for 0)
  if (Array.isArray(obj.textSegments)) {
    for (const seg of obj.textSegments) {
      const start = toNum(seg.startIndex) ?? 0; // omitted = 0 (protobuf default)
      seg.startIndex = String(start + textOffset);
      if (seg.endIndex !== undefined) {
        seg.endIndex = String((toNum(seg.endIndex) ?? 0) + textOffset);
      }
    }
  }

  // pageSpan.pageStart/pageEnd (1-based, in documentLayout.blocks + chunkedDocument.chunks)
  if ("pageStart" in obj) {
    const ps = toNum(obj.pageStart);
    if (ps !== null) obj.pageStart = ps + pageOffset;
  }
  if ("pageEnd" in obj) {
    const pe = toNum(obj.pageEnd);
    if (pe !== null) obj.pageEnd = pe + pageOffset;
  }

  // Recurse into child properties
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      walkAndOffset(obj[key], pageOffset, textOffset);
    }
  }
}

function toNum(val: any): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  }
  return null;
}
