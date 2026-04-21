/**
 * Wisconsin DFI Franchise Search scraper.
 *
 * Reverse-engineered from inspection of the live ASP.NET WebForms site:
 *   https://apps.dfi.wi.gov/apps/FranchiseSearch/MainSearch.aspx
 *
 * Key facts (discovered, not assumed):
 * - Search form fields: `txtName` (text input), `btnSearch` (submit with value "(S)earch").
 * - Viewstate is chunked: `__VIEWSTATEFIELDCOUNT` gates the number of `__VIEWSTATE*`
 *   fields (typically 2 on search, 7 on detail).
 * - There is NO `__EVENTVALIDATION` field. Do not attempt to read one.
 * - Content-Length must be explicit and a User-Agent is required (411 otherwise).
 * - Search results live in `<table id="grdSearchResults">`. One row per filing, 25+
 *   historical rows for major brands. Only the current Registered row has a
 *   clickable Details link in the last cell; expired rows have `&nbsp;`.
 * - Detail URL shape: `details.aspx?id=<num>&hash=<num>&search=external&type=GENERAL`.
 * - FDD PDF download is a FORM POST to the detail URL with `upload_downloadFile=Download`
 *   and the full (7-chunk) viewstate from the detail page. Not a direct link.
 */

const WI_DFI_BASE = 'https://apps.dfi.wi.gov/apps/FranchiseSearch';
const SEARCH_URL = `${WI_DFI_BASE}/MainSearch.aspx`;
const USER_AGENT =
  'Mozilla/5.0 (compatible; buddy-the-underwriter/1.0; +franchise-intelligence)';

export interface WiDfiSearchResult {
  fileNumber: string;
  legalName: string;
  tradeName: string;
  effectiveDate: string | null;  // ISO (YYYY-MM-DD)
  expirationDate: string | null; // ISO
  status: string;
  detailUrl: string | null;      // null for expired rows
}

export interface WiDfiFilingDetail {
  legalName: string | null;
  tradeName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  statesFiledList: string[];
  hasFddPdf: boolean;
  fddUploadDate: string | null;  // ISO date parsed from "File uploaded on MM/DD/YYYY..."
  viewstateFields: Record<string, string>; // harvested tokens for subsequent POST
}

/** Generic N-chunk viewstate harvester. Handles __VIEWSTATEFIELDCOUNT split. */
export function extractViewstate(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const count = parseInt(pickField(html, '__VIEWSTATEFIELDCOUNT') ?? '1', 10);

  fields['__VIEWSTATEFIELDCOUNT'] = String(count);
  fields['__VIEWSTATE'] = pickField(html, '__VIEWSTATE') ?? '';
  for (let i = 1; i < count; i++) {
    fields[`__VIEWSTATE${i}`] = pickField(html, `__VIEWSTATE${i}`) ?? '';
  }
  fields['__VIEWSTATEGENERATOR'] = pickField(html, '__VIEWSTATEGENERATOR') ?? '';
  fields['__VIEWSTATEENCRYPTED'] = pickField(html, '__VIEWSTATEENCRYPTED') ?? '';
  return fields;
}

function pickField(html: string, fieldName: string): string | null {
  // Require an exact-name match (not a substring) via word boundaries on both sides.
  // This prevents `__VIEWSTATE` from swallowing `__VIEWSTATE1`.
  const re = new RegExp(`id="${fieldName}"[^>]*value="([^"]*)"(?![^"]*id=")`, 'i');
  const m = html.match(re);
  if (m) return decodeHtml(m[1]!);

  // Alt ordering: value="..." before id="..."
  const re2 = new RegExp(`name="${fieldName}"[^>]*value="([^"]*)"`, 'i');
  const m2 = html.match(re2);
  return m2 ? decodeHtml(m2[1]!) : null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Search WI DFI for a brand name. */
export async function searchWiDfi(brandName: string): Promise<WiDfiSearchResult[]> {
  // 1. GET the search page to harvest viewstate
  const pageRes = await fetch(SEARCH_URL, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!pageRes.ok) {
    throw new Error(`WI DFI search page GET returned ${pageRes.status}`);
  }
  const pageHtml = await pageRes.text();
  const tokens = extractViewstate(pageHtml);
  if (!tokens['__VIEWSTATE']) {
    throw new Error('WI DFI: could not extract __VIEWSTATE from search page');
  }

  // 2. POST the search form
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(tokens)) form.set(k, v);
  form.set('txtName', brandName);
  form.set('btnSearch', '(S)earch');

  const body = form.toString();
  const searchRes = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(body)),
      'User-Agent': USER_AGENT,
      Referer: SEARCH_URL,
    },
    body,
  });
  if (!searchRes.ok) {
    throw new Error(`WI DFI search POST returned ${searchRes.status}`);
  }
  const resultsHtml = await searchRes.text();
  return parseSearchResults(resultsHtml);
}

/** Parse the results table. Rows in `grdSearchResults` with classes
 *  `SearchResultsOddRow` / `SearchResultsEvenRow`. Columns:
 *  [File Number, Legal Name, Trade Name, Effective Date, Expiration Date, Status, Details]
 *  The Details cell is `&nbsp;` for expired rows, an <a href> for the current one. */
export function parseSearchResults(html: string): WiDfiSearchResult[] {
  const results: WiDfiSearchResult[] = [];

  // Isolate the grid first
  const gridMatch = html.match(
    /<table[^>]*id="grdSearchResults"[\s\S]*?<\/table>/i
  );
  if (!gridMatch) return results;
  const grid = gridMatch[0];

  // Each data row starts with class="SearchResults{Odd,Even}Row"
  const rowRe = /<tr[^>]*class="SearchResults(?:Odd|Even)Row"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(grid)) !== null) {
    const rowHtml = rowMatch[1]!;
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => m[1]!.trim()
    );
    if (cells.length < 7) continue;

    const fileNumber = stripTags(cells[0]!).trim();
    const legalName = decodeHtml(stripTags(cells[1]!)).trim();
    const tradeName = decodeHtml(stripTags(cells[2]!)).trim();
    const effectiveDate = usToIso(stripTags(cells[3]!).trim());
    const expirationDate = usToIso(stripTags(cells[4]!).trim());
    const status = stripTags(cells[5]!).trim();

    // Details cell has href="details.aspx?..." when clickable
    const linkMatch = cells[6]!.match(/href="([^"]*details\.aspx[^"]*)"/i);
    const detailUrl = linkMatch
      ? `${WI_DFI_BASE}/${decodeHtml(linkMatch[1]!).replace(/^\.?\//, '')}`
      : null;

    results.push({
      fileNumber,
      legalName,
      tradeName,
      effectiveDate,
      expirationDate,
      status,
      detailUrl,
    });
  }
  return results;
}

/** Fetch a detail page and extract metadata + viewstate (needed for PDF POST). */
export async function getFilingDetail(
  detailUrl: string
): Promise<WiDfiFilingDetail> {
  const res = await fetch(detailUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`WI DFI detail GET returned ${res.status}`);
  }
  const html = await res.text();
  return parseFilingDetail(html);
}

export function parseFilingDetail(html: string): WiDfiFilingDetail {
  const span = (id: string) => {
    const re = new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</span>`, 'i');
    const m = html.match(re);
    return m ? decodeHtml(stripTags(m[1]!)).trim() || null : null;
  };

  // States-filed list uses <BR /> between entries
  let statesFiledList: string[] = [];
  const statesRaw = span('lblStatesFiledList');
  if (statesRaw) {
    // Re-parse from html to handle <BR /> which the span() helper already stripped
    const statesHtmlMatch = html.match(
      /id="lblStatesFiledList"[^>]*>([\s\S]*?)<\/span>/i
    );
    if (statesHtmlMatch) {
      statesFiledList = statesHtmlMatch[1]!
        .split(/<br\s*\/?\s*>/gi)
        .map((s) => decodeHtml(stripTags(s)).trim())
        .filter(Boolean);
    }
  }

  // FDD upload date from "File uploaded on 12/01/2025 at 04:24:57."
  const uploadMatch = html.match(
    /File uploaded on\s+(\d{1,2}\/\d{1,2}\/\d{4})/i
  );
  const fddUploadDate = uploadMatch ? usToIso(uploadMatch[1]!) : null;
  const hasFddPdf = /name="upload_downloadFile"/i.test(html);

  return {
    legalName: span('lblFranchiseLegalName'),
    tradeName: span('lblFranchiseTradeName'),
    addressLine1: span('lblFranchiseAddressLine1'),
    addressLine2: span('lblFranchiseAddressLine2'),
    city: span('lblFranchiseCity'),
    state: span('lblFranchiseState'),
    zipCode: span('lblFranchiseZipCode'),
    country: span('lblFranchiseCountry'),
    contactName: span('lblContactName'),
    contactEmail: span('lblEmailAddress'),
    contactPhone: span('lblContactPhone'),
    statesFiledList,
    hasFddPdf,
    fddUploadDate,
    viewstateFields: extractViewstate(html),
  };
}

/** Download the FDD PDF by POSTing the detail page's viewstate + download button.
 *  Returns the PDF buffer. Throws if the response isn't application/pdf. */
export async function downloadFddPdf(
  detailUrl: string,
  viewstateFields: Record<string, string>
): Promise<Buffer> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(viewstateFields)) form.set(k, v);
  form.set('upload_downloadFile', 'Download');

  const body = form.toString();
  const res = await fetch(detailUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(body)),
      'User-Agent': USER_AGENT,
      Referer: detailUrl,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`WI DFI PDF POST returned ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (!ct.includes('pdf') && buf.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error(
      `WI DFI PDF response not a PDF (content-type="${ct}", first-bytes="${buf
        .subarray(0, 8)
        .toString('hex')}")`
    );
  }
  return buf;
}

/** Strip all HTML tags, collapse whitespace. */
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** Convert "M/D/YYYY" → "YYYY-MM-DD". Returns null on parse failure. */
function usToIso(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}
