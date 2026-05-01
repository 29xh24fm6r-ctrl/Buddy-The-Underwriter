import { callGeminiForExtraction } from './geminiClient.js';
import { slicePdfPages } from './pdfPageExtractor.js';
import type { TocResult } from './types.js';

const TOC_PROMPT = `You are locating Item starting pages in a Franchise Disclosure Document (FDD).

The pages provided are the FRONT MATTER of the document — typically a cover
page, one or more state-specific cover/addendum pages, and then the actual
Table of Contents. The TOC may not appear on the first page; it is usually
several pages in.

═══════════════════════════════════════════════════════════════════════════
CRITICAL: PDF-PAGE NUMBERS, NOT TOC-PRINTED NUMBERS
═══════════════════════════════════════════════════════════════════════════

You must return the **PDF page number** for each Item — i.e. the position
of that Item in the actual PDF file you were given. Page 1 is the very
first page of this PDF file (the first thing you see).

The TOC text usually shows page numbers from the FDD body's INTERNAL
numbering, which starts AFTER the cover/addendum front matter. Those
numbers do NOT match the PDF page numbers when there are unnumbered
front-matter pages. You must compute and apply the offset.

How to compute the offset:
  1. Find the TOC in the PDF pages provided. Note which PDF page it
     appears on — call that TOC_PDF_PAGE (e.g. "the TOC appears on PDF
     page 7 of this slice").
  2. Look at the TOC's own printed page number (it's usually small Roman
     numerals like "ii", "iii", or a body number near the bottom of the
     TOC page). Convert that to its body-relative position:
        - "ii" → 2,  "iii" → 3,  "iv" → 4
        - or a small numeric like 2 or 3
     Call this TOC_BODY_PAGE.
  3. The offset is OFFSET = TOC_PDF_PAGE - TOC_BODY_PAGE.
     Example: TOC is on PDF page 7 and shows "ii" at the bottom →
              OFFSET = 7 - 2 = 5.
  4. For every item, the TOC says e.g. "Item 5 . . . 12". The PDF page
     for Item 5 is then 12 + OFFSET = 12 + 5 = 17. Return 17.

If you cannot determine the offset with confidence, return null for that
item's page rather than guessing. A null is better than a wrong number —
the downstream pipeline tolerates nulls but suffers from misaligned
slices.

If the TOC is NOT visible in this slice but you can see an Item heading
directly (e.g. a page that begins "ITEM 5. INITIAL FRANCHISE FEE"),
return the PDF page number where that heading appears. No offset math
needed in that case.

═══════════════════════════════════════════════════════════════════════════

Items to locate:
- Item 5: Initial Franchise Fee
- Item 6: Other Fees
- Item 7: Estimated Initial Investment
- Item 19: Financial Performance Representations
- Item 20: Outlets and Franchisee Information

Item 19 detection: many franchisors do NOT make Financial Performance
Representations. If the TOC simply lists Item 19, set item_19_present
to true (the body extractor will verify by reading the section). Set it
to false ONLY if the TOC or front matter explicitly says "We do not make
any financial performance representations".

Return JSON in EXACTLY this shape:
{
  "item_5_page": <PDF page number or null>,
  "item_6_page": <PDF page number or null>,
  "item_7_page": <PDF page number or null>,
  "item_19_page": <PDF page number or null>,
  "item_19_present": <boolean>,
  "item_20_page": <PDF page number or null>,
  "total_pages": <number>,
  "notes": "<your offset calculation: e.g. 'TOC on PDF page 7 shows ii, offset=5'>"
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
