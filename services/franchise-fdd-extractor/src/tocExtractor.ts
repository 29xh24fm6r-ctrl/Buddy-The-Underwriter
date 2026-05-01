import { callGeminiForExtraction } from './geminiClient.js';
import { slicePdfPages } from './pdfPageExtractor.js';
import type { TocResult } from './types.js';

const TOC_PROMPT = `You are locating Item starting pages in a Franchise Disclosure Document (FDD).

The pages provided are the FRONT MATTER of the document — typically a cover
page, one or more state-specific cover/addendum pages, and then the actual
Table of Contents. The TOC may not appear on the first page; it is usually
several pages in.

Find the starting page numbers (as printed in the TOC) for these items:
- Item 5: Initial Franchise Fee
- Item 6: Other Fees
- Item 7: Estimated Initial Investment
- Item 19: Financial Performance Representations
- Item 20: Outlets and Franchisee Information

If the Table of Contents is in the provided pages, use the page numbers it
lists. The TOC's page numbers refer to positions in the FULL document
(which may be 200-700 pages long), NOT to positions in this slice — use
them as-is. If the TOC is NOT in the provided pages but you can see Item
headings directly (e.g. a page that begins with "ITEM 5. INITIAL
FRANCHISE FEE"), return the page number where that heading appears.

Item 19 detection: many franchisors do NOT make Financial Performance
Representations. If the TOC entry for Item 19 says something like "FINANCIAL
PERFORMANCE REPRESENTATIONS" but the body says "We do not make any
financial performance representations" set item_19_present to false. If the
TOC simply lists Item 19 without that disclaimer, set item_19_present to
true (the body extractor will verify).

Page numbers must be 1-indexed in the FULL document (not in this slice).

Return JSON in EXACTLY this shape:
{
  "item_5_page": <number or null>,
  "item_6_page": <number or null>,
  "item_7_page": <number or null>,
  "item_19_page": <number or null>,
  "item_19_present": <boolean>,
  "item_20_page": <number or null>,
  "total_pages": <number>,
  "notes": "<any observations about the TOC structure>"
}`;

interface TocResponse {
  item_5_page?: number | null;
  item_6_page?: number | null;
  item_7_page?: number | null;
  item_19_page?: number | null;
  item_19_present?: boolean;
  item_20_page?: number | null;
  total_pages?: number;
  notes?: string;
}

export async function extractToc(
  pdfBuffer: Buffer
): Promise<{ toc: TocResult | null; modelUsed: string; error?: string }> {
  // FDDs typically have multiple front-matter pages before the actual TOC:
  // a cover sheet, then state-specific addendum cover pages, then the TOC.
  // Pages 1-15 covers the practical worst case observed in production.
  const slice = await slicePdfPages(pdfBuffer, 1, 15);

  const res = await callGeminiForExtraction<TocResponse>({
    logTag: 'toc',
    prompt: TOC_PROMPT,
    pdfBase64: slice.pdf.toString('base64'),
  });

  if (!res.ok || !res.result) {
    return { toc: null, modelUsed: res.modelUsed, error: res.error };
  }

  const r = res.result;
  return {
    toc: {
      item5Page: nullableInt(r.item_5_page),
      item6Page: nullableInt(r.item_6_page),
      item7Page: nullableInt(r.item_7_page),
      item19Page: nullableInt(r.item_19_page),
      item19Present: r.item_19_present === true,
      item20Page: nullableInt(r.item_20_page),
      // Trust pdf-lib's count over the model's; the model's value can drift
      // when a TOC says "267 pages" but the PDF was sliced or extended.
      totalPages: slice.totalPages,
      notes: r.notes,
    },
    modelUsed: res.modelUsed,
  };
}

function nullableInt(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
}
