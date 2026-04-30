/**
 * Minnesota CARDS (Commerce Actions and Regulatory Documents Search) scraper.
 *
 * Reverse-engineered from inspection of the live site:
 *   https://cards.web.commerce.state.mn.us/franchise-registrations
 *
 * Key facts (discovered, not assumed):
 * - Search is a plain GET form. No viewstate, no CSRF. Query params:
 *     `doSearch=true`, `franchiseName`, `franchisor`, `year`,
 *     `documentTitle`, `fileNumber`, `documentType`, `content`.
 * - **Year is required** for useful results — without it the server
 *   returns "all registrations ever filed" for the brand.
 * - Results live in `<table id="results">`. Each `<tr>` (in `<tbody>`)
 *   has 9 cells: row#, document-link, franchisor, franchise name,
 *   document type, year, file number, content (blank), filed date,
 *   effective date.
 * - PDF download is a direct GET against the `<a href>` in the
 *   document cell — no auth, no POST. Pattern:
 *     /documents/{GUID}/download?documentClass=FRANCHISE_REGISTRATIONS&contentSequence=0
 * - The link's `title` attribute carries the original filename + size,
 *   e.g. `34006-202504-06.pdf (7MB)`.
 * - FDD-relevant document types in MN (in priority order — most
 *   recent and "cleanest" first): Final FDD, Clean FDD,
 *   Revised FDD - Clean, Revised FDD - Marked Up, Marked FDD.
 */

const MN_BASE = 'https://cards.web.commerce.state.mn.us';
const SEARCH_PATH = '/franchise-registrations';
const USER_AGENT =
  'Mozilla/5.0 (compatible; buddy-the-underwriter/1.0; +franchise-intelligence)';

/** Document types that contain the actual FDD body, ordered by preference.
 *  Final FDD > Clean FDD > Revised FDD - Clean > Revised FDD - Marked Up >
 *  Marked FDD. */
export const FDD_DOC_TYPES: ReadonlyArray<string> = [
  'Final FDD',
  'Clean FDD',
  'Revised FDD - Clean',
  'Revised FDD - Marked Up',
  'Marked FDD',
];

const FDD_DOC_TYPE_SET = new Set(FDD_DOC_TYPES.map((t) => t.toLowerCase()));

export interface MnCardsSearchResult {
  documentId: string;          // GUID without surrounding {}
  downloadUrl: string;         // absolute, ready to GET
  fileLabel: string;           // anchor text, e.g. "34006-202504-06"
  fileSizeHint: string | null; // e.g. "7MB" parsed from link title
  franchisor: string;
  franchiseName: string;
  documentType: string;        // e.g. "Clean FDD"
  year: number | null;
  fileNumber: string;
  filedDate: string | null;    // ISO YYYY-MM-DD
  effectiveDate: string | null;
}

export interface MnCardsSearchOptions {
  /** Search by franchise (brand) name. Server-side does substring match. */
  franchiseName?: string;
  /** Search by franchisor (legal entity) name. */
  franchisor?: string;
  /** Filing year. **Required** to scope the result set; passing none returns
   *  every filing in CARDS history for the matching brand. */
  year: number;
  /** Optional document-type filter applied server-side. */
  documentType?: string;
}

/** Search MN CARDS for franchise-registration documents. */
export async function searchMnCards(
  opts: MnCardsSearchOptions
): Promise<MnCardsSearchResult[]> {
  if (!opts.franchiseName && !opts.franchisor) {
    throw new Error('searchMnCards: franchiseName or franchisor required');
  }

  const qs = new URLSearchParams();
  qs.set('doSearch', 'true');
  qs.set('documentTitle', '');
  qs.set('franchisor', opts.franchisor ?? '');
  qs.set('franchiseName', opts.franchiseName ?? '');
  qs.set('year', String(opts.year));
  qs.set('fileNumber', '');
  qs.set('documentType', opts.documentType ?? '');
  qs.set('content', '');

  const url = `${MN_BASE}${SEARCH_PATH}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });
  if (!res.ok) {
    throw new Error(`MN CARDS search GET returned ${res.status}`);
  }
  const html = await res.text();
  return parseSearchResults(html);
}

/** Parse the `<table id="results">` body. */
export function parseSearchResults(html: string): MnCardsSearchResult[] {
  const out: MnCardsSearchResult[] = [];

  const tableMatch = html.match(
    /<table[^>]*id="results"[\s\S]*?<\/table>/i
  );
  if (!tableMatch) return out;
  const table = tableMatch[0];

  const tbodyMatch = table.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return out;
  const tbody = tbodyMatch[1]!;

  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tbody)) !== null) {
    const rowHtml = rowMatch[1]!;
    const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (m) => m[1]!
    );
    // Expected layout: [row#, doc-link, franchisor, franchise, doc-type,
    //   year, fileNumber, content, filedDate, effectiveDate]
    if (cells.length < 10) continue;

    const docCell = cells[1]!;
    const anchorMatch = docCell.match(/<a\b[^>]*>[\s\S]*?<\/a>/i);
    if (!anchorMatch) continue;
    const anchor = anchorMatch[0];

    const hrefMatch = anchor.match(
      /href="(\/documents\/\{([^}]+)\}\/download\?[^"]*)"/i
    );
    if (!hrefMatch) continue;
    const relHref = decodeHtml(hrefMatch[1]!);
    const documentId = hrefMatch[2]!;

    const titleMatch = anchor.match(/title="([^"]*)"/i);
    const titleAttr = titleMatch ? decodeHtml(titleMatch[1]!) : '';
    const sizeMatch = titleAttr.match(/\(([^)]+)\)/);
    const fileSizeHint = sizeMatch ? sizeMatch[1]!.trim() : null;

    const labelMatch = anchor.match(/>([\s\S]*?)<\/a>/i);
    const fileLabel = labelMatch ? stripTags(labelMatch[1]!).trim() : '';

    const franchisor = decodeHtml(stripTags(cells[2]!)).trim();
    const franchiseName = decodeHtml(stripTags(cells[3]!)).trim();
    const documentType = decodeHtml(stripTags(cells[4]!)).trim();
    const yearStr = stripTags(cells[5]!).trim();
    const year = /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : null;
    const fileNumber = stripTags(cells[6]!).trim();
    const filedDate = usToIso(stripTags(cells[8]!).trim());
    const effectiveDate = usToIso(stripTags(cells[9]!).trim());

    out.push({
      documentId,
      downloadUrl: `${MN_BASE}${relHref}`,
      fileLabel,
      fileSizeHint,
      franchisor,
      franchiseName,
      documentType,
      year,
      fileNumber,
      filedDate,
      effectiveDate,
    });
  }
  return out;
}

/** Filter results to only those that are FDD bodies (Clean / Final / Revised
 *  / Marked FDD). Other document types in CARDS — Cover Letter, Application,
 *  Order, Bond, etc. — are administrative and never carry the disclosure body. */
export function filterToFddDocs(
  results: MnCardsSearchResult[]
): MnCardsSearchResult[] {
  return results.filter((r) =>
    FDD_DOC_TYPE_SET.has(r.documentType.toLowerCase())
  );
}

/** Pick the best FDD candidate. Preference order:
 *  1. Document-type rank (FDD_DOC_TYPES order — Final FDD beats Marked FDD).
 *  2. Most recent effectiveDate (then filedDate).
 *  Returns null if no FDD-typed rows are present. */
export function pickBestFdd(
  results: MnCardsSearchResult[]
): MnCardsSearchResult | null {
  const fdds = filterToFddDocs(results);
  if (fdds.length === 0) return null;

  const docTypeRank = (t: string): number => {
    const i = FDD_DOC_TYPES.findIndex((d) => d.toLowerCase() === t.toLowerCase());
    return i === -1 ? FDD_DOC_TYPES.length : i;
  };

  return fdds.slice().sort((a, b) => {
    const r = docTypeRank(a.documentType) - docTypeRank(b.documentType);
    if (r !== 0) return r;
    const aDate = a.effectiveDate ?? a.filedDate ?? '';
    const bDate = b.effectiveDate ?? b.filedDate ?? '';
    return bDate.localeCompare(aDate);
  })[0]!;
}

/** Download a CARDS document PDF by direct GET. Validates the response is
 *  actually a PDF (the URL pattern is stable but a 404 on a missing GUID
 *  returns an HTML error page with status 200 in some servlet stacks). */
export async function downloadMnFddPdf(
  downloadUrl: string
): Promise<Buffer> {
  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`MN CARDS PDF GET returned ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (!ct.includes('pdf') && buf.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error(
      `MN CARDS PDF response not a PDF (content-type="${ct}", first-bytes="${buf
        .subarray(0, 8)
        .toString('hex')}")`
    );
  }
  return buf;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function usToIso(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}
