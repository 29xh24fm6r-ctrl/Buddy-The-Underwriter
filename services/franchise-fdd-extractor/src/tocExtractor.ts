import { callGeminiForExtraction } from './geminiClient.js';
import { slicePdfPages } from './pdfPageExtractor.js';
import type { TocResult } from './types.js';

const TOC_PROMPT = `You are analyzing the Table of Contents of a Franchise Disclosure Document (FDD).

Find the starting page numbers for these items:
- Item 5: Initial Franchise Fee
- Item 6: Other Fees
- Item 7: Estimated Initial Investment
- Item 19: Financial Performance Representations
- Item 20: Outlets and Franchisee Information

Also determine:
- Does this FDD contain an Item 19? (Many franchisors skip it. If the document explicitly states "We do not make any financial performance representations" or similar, set item_19_present to false even if a page number appears.)
- Total page count of the document

Page numbers must be 1-indexed (the first page of the PDF is page 1).

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
  // FDD TOCs sit on page 2-3 typically; pages 1-5 covers cover page + TOC
  // for nearly every observed format.
  const slice = await slicePdfPages(pdfBuffer, 1, 5);

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
