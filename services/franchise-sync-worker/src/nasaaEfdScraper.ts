/**
 * NASAA EFD (Electronic Filing Depository) Franchise Search scraper.
 *
 * Reverse-engineered from inspection of the live ASP.NET WebForms site:
 *   https://www.nasaaefd.org/Franchise/Search
 *
 * Key facts (discovered, not assumed):
 * - Search is ASP.NET WebForms postback. NO captcha. Required tokens:
 *   __VIEWSTATE, __VIEWSTATEGENERATOR, __EVENTVALIDATION, plus the two
 *   ctl00$hdn timing fields. Search field name is
 *   `ctl00$MainContent$txtSearchField`; submit button is
 *   `ctl00$MainContent$btnSearch` with value "Search".
 * - **Cookie session matters**: the GET that seeds tokens also sets
 *   `ASP.NET_SessionId` and `__AntiXsrfToken` cookies. Reusing the same
 *   cookie jar for the POST is required — without it the POST 302's to
 *   `/default` and silently discards the search.
 * - Search results render INLINE on the result page in a single
 *   `<table class="table table-hover table-striped">` with thead columns
 *   [EFDID, Franchisor Name, Franchise Name, Business Name]. The HTML
 *   from this server has stray missing `</td>` close tags between the
 *   franchisor and franchise-name cells, so the row parser splits on
 *   `<td...>` openers rather than relying on close tags.
 * - Brand detail at `/Franchise/{EFDID}/{slug}` has TWO tables:
 *   Registrations and Exemptions. Each row has a state-name link with
 *   `?EFDID=X&RegistrationId=Y&isRegistered=true|false`.
 * - Notice page at `/Franchise/ViewNotices?...` lists documents. Most
 *   are marked "not publicly accessible". The Franchise Disclosure
 *   Document row has download/view links carrying `DocId`.
 * - PDF download is a direct GET against
 *   `/Franchise/Actions/DownloadFile.ashx?DocId=Z&isRegistered=true|false`.
 *   Returns `application/pdf`. No POST, no viewstate.
 */

const NASAA_BASE = 'https://www.nasaaefd.org';
const SEARCH_URL = `${NASAA_BASE}/Franchise/Search`;
const USER_AGENT =
  'Mozilla/5.0 (compatible; buddy-the-underwriter/1.0; +franchise-intelligence)';

export interface NasaaSearchHit {
  efdid: string;
  detailUrl: string;          // absolute /Franchise/{EFDID}/{slug}
  franchisor: string;
  brand: string;
  businessName: string;
}

export interface NasaaRegistrationRow {
  state: string;
  applicationType: string;    // e.g. "Renewal", "Initial", "Amendment"
  stateFileNumber: string;
  effectiveStartDate: string | null;  // ISO YYYY-MM-DD
  effectiveEndDate: string | null;
  registrationId: string;
  isRegistered: boolean;       // false for exemption rows
  noticesUrl: string;          // absolute ViewNotices URL
}

export interface NasaaDocument {
  docType: string;             // e.g. "Franchise Disclosure Document"
  description: string;         // filename hint
  docId: string | null;        // null when row is "not publicly accessible"
  isRegistered: boolean;
  downloadUrl: string | null;  // absolute DownloadFile.ashx URL
}

interface SessionTokens {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
  pageStartTime: string;
  pageFinishedBuildTime: string;
}

/** Parse the Set-Cookie response headers and append to a cookie jar map. */
function captureCookies(jar: Map<string, string>, response: Response): void {
  const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookieHeaders) {
    const eq = raw.indexOf('=');
    const semi = raw.indexOf(';');
    if (eq <= 0) continue;
    const name = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1, semi === -1 ? undefined : semi).trim();
    if (name) jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>): string | undefined {
  if (jar.size === 0) return undefined;
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** Parse "Apr 27, 2022" or "M/D/YYYY" or "MM/DD/YYYY" → "YYYY-MM-DD". */
function parseDateLoose(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    return `${slash[3]}-${slash[1]!.padStart(2, '0')}-${slash[2]!.padStart(2, '0')}`;
  }
  const long = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (long) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const m = months[long[1]!.slice(0, 3).toLowerCase()];
    if (!m) return null;
    return `${long[3]}-${m}-${long[2]!.padStart(2, '0')}`;
  }
  return null;
}

/** Robust cell splitter: NASAA's HTML has missing `</td>` close tags between
 *  some cells. Splitting on `<td...>` openers and trimming any trailing
 *  `</td>` (or `</tr>`) handles both well-formed and broken markup. */
function splitRowCells(rowHtml: string): string[] {
  const chunks = rowHtml.split(/<td[^>]*>/i).slice(1);
  return chunks.map((chunk) => chunk.replace(/<\/t[dr]>[\s\S]*$/i, '').trim());
}

function pickToken(html: string, name: string): string {
  const re = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? decodeHtml(m[1]!) : '';
}

function pickHiddenByLooseName(html: string, suffix: string): string {
  const re = new RegExp(`name="ctl00\\$${suffix}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? decodeHtml(m[1]!) : '';
}

function extractTokens(html: string): SessionTokens {
  return {
    viewState: pickToken(html, '__VIEWSTATE'),
    viewStateGenerator: pickToken(html, '__VIEWSTATEGENERATOR'),
    eventValidation: pickToken(html, '__EVENTVALIDATION'),
    pageStartTime: pickHiddenByLooseName(html, 'hdnPageStartTime'),
    pageFinishedBuildTime: pickHiddenByLooseName(html, 'hdnPageFinishedBuildTime'),
  };
}

/** Search NASAA EFD for a franchise name. Performs the paired GET-then-POST
 *  cookie session required by the server. Returns all hits — caller is
 *  responsible for normalize-matching against the canonical brand name. */
export async function searchNasaaEfd(brandName: string): Promise<NasaaSearchHit[]> {
  const jar = new Map<string, string>();

  const getRes = await fetch(SEARCH_URL, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!getRes.ok) {
    throw new Error(`NASAA EFD search GET returned ${getRes.status}`);
  }
  captureCookies(jar, getRes);
  const seedHtml = await getRes.text();
  const tokens = extractTokens(seedHtml);
  if (!tokens.viewState) {
    throw new Error('NASAA EFD: could not extract __VIEWSTATE from search page');
  }

  const form = new URLSearchParams();
  form.set('__EVENTTARGET', '');
  form.set('__EVENTARGUMENT', '');
  form.set('__VIEWSTATE', tokens.viewState);
  form.set('__VIEWSTATEGENERATOR', tokens.viewStateGenerator);
  form.set('__EVENTVALIDATION', tokens.eventValidation);
  form.set('ctl00$cphNavSearch$ctl00$txtSearch', '');
  form.set('ctl00$MainContent$txtSearchField', brandName);
  form.set('ctl00$MainContent$btnSearch', 'Search');
  form.set('ctl00$hdnPageStartTime', tokens.pageStartTime);
  form.set('ctl00$hdnPageFinishedBuildTime', tokens.pageFinishedBuildTime);

  const body = form.toString();
  const cookies = cookieHeader(jar);
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/x-www-form-urlencoded',
    Referer: SEARCH_URL,
  };
  if (cookies) headers.Cookie = cookies;

  const postRes = await fetch(SEARCH_URL, {
    method: 'POST',
    headers,
    body,
    redirect: 'follow',
  });
  if (!postRes.ok) {
    throw new Error(`NASAA EFD search POST returned ${postRes.status}`);
  }
  // 302 → /default is the "logged-out / search rejected" path.
  if (postRes.url.endsWith('/default') || postRes.url.endsWith('/Default')) {
    throw new Error('NASAA EFD search POST redirected to /default — session rejected');
  }
  const resultHtml = await postRes.text();
  return parseSearchResults(resultHtml);
}

export function parseSearchResults(html: string): NasaaSearchHit[] {
  const out: NasaaSearchHit[] = [];

  // Find the result table by its thead signature
  const tableMatch = html.match(
    /<thead>\s*<tr>\s*<th>EFDID<\/th>[\s\S]*?<\/table>/i
  );
  if (!tableMatch) return out;
  const tbodyMatch = tableMatch[0].match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return out;

  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tbodyMatch[1]!)) !== null) {
    const rowHtml = rowMatch[1]!;
    const cells = splitRowCells(rowHtml);
    if (cells.length < 3) continue;

    const link = cells[0]!.match(
      /href=\s*['"]\s*(\/Franchise\/(\d+)\/[^'"\s]+)['"]/i
    );
    if (!link) continue;
    const efdid = link[2]!;
    const detailUrl = `${NASAA_BASE}${decodeHtml(link[1]!).trim()}`;

    out.push({
      efdid,
      detailUrl,
      franchisor: decodeHtml(stripTags(cells[1] ?? '')).trim(),
      brand: decodeHtml(stripTags(cells[2] ?? '')).trim(),
      businessName: decodeHtml(stripTags(cells[3] ?? '')).trim(),
    });
  }
  return out;
}

/** Fetch a brand detail page and parse all rows from both Registrations and
 *  Exemptions tables. Returns rows with parsed dates and the URL ready to
 *  fetch documents from. */
export async function getBrandDetail(detailUrl: string): Promise<NasaaRegistrationRow[]> {
  const res = await fetch(detailUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`NASAA EFD detail GET returned ${res.status}`);
  }
  const html = await res.text();
  return parseBrandDetail(html);
}

export function parseBrandDetail(html: string): NasaaRegistrationRow[] {
  const out: NasaaRegistrationRow[] = [];
  const tableRe = /<table class="table table-striped">([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const tbodyMatch = tableMatch[1]!.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) continue;
    const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tbodyMatch[1]!)) !== null) {
      const cells = splitRowCells(rowMatch[1]!);
      if (cells.length < 5) continue;

      // First cell: <a href='/Franchise/ViewNotices?EFDID=X&RegistrationId=Y&isRegistered=true|false'>State</a>
      const linkMatch = cells[0]!.match(
        /href=\s*['"]\s*([^'"]*ViewNotices\?[^'"]+)['"]/i
      );
      if (!linkMatch) continue;
      const noticesPath = decodeHtml(linkMatch[1]!).trim();
      const regIdMatch = noticesPath.match(/RegistrationId=\s*(\d+)/i);
      const isRegMatch = noticesPath.match(/isRegistered=\s*(true|false)/i);
      if (!regIdMatch) continue;

      const state = decodeHtml(stripTags(cells[0]!)).trim();
      if (!state) continue;

      out.push({
        state,
        applicationType: decodeHtml(stripTags(cells[1] ?? '')).trim(),
        stateFileNumber: decodeHtml(stripTags(cells[2] ?? '')).trim(),
        effectiveStartDate: parseDateLoose(decodeHtml(stripTags(cells[4] ?? ''))),
        effectiveEndDate: parseDateLoose(decodeHtml(stripTags(cells[5] ?? ''))),
        registrationId: regIdMatch[1]!,
        isRegistered: (isRegMatch?.[1] ?? 'true').toLowerCase() === 'true',
        noticesUrl: noticesPath.startsWith('http')
          ? noticesPath
          : `${NASAA_BASE}${noticesPath.startsWith('/') ? '' : '/'}${noticesPath}`,
      });
    }
  }
  return out;
}

/** Fetch the ViewNotices page for a registration and extract document rows.
 *  Most rows are marked "not publicly accessible" (docId=null). The
 *  Franchise Disclosure Document row carries a downloadable DocId. */
export async function getRegistrationDocuments(
  noticesUrl: string
): Promise<NasaaDocument[]> {
  const res = await fetch(noticesUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`NASAA EFD ViewNotices GET returned ${res.status}`);
  }
  const html = await res.text();
  return parseDocumentList(html);
}

export function parseDocumentList(html: string): NasaaDocument[] {
  const out: NasaaDocument[] = [];
  const tableMatch = html.match(
    /<table class="table table-striped table-hover table-bordered">([\s\S]*?)<\/table>/i
  );
  if (!tableMatch) return out;
  const tbodyMatch = tableMatch[1]!.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return out;

  const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tbodyMatch[1]!)) !== null) {
    const cells = splitRowCells(rowMatch[1]!);
    if (cells.length < 3) continue;

    const docType = decodeHtml(stripTags(cells[0] ?? '')).trim();
    const description = decodeHtml(stripTags(cells[1] ?? '')).trim();
    const actionCell = cells[2] ?? '';

    const downloadMatch = actionCell.match(
      /href=\s*['"]\s*([^'"]*DownloadFile\.ashx\?[^'"]+)['"]/i
    );
    const docIdMatch = downloadMatch?.[1]?.match(/DocId=\s*(\d+)/i);
    const isRegMatch = downloadMatch?.[1]?.match(/isRegistered=\s*(true|false)/i);

    out.push({
      docType,
      description,
      docId: docIdMatch?.[1] ?? null,
      isRegistered: (isRegMatch?.[1] ?? 'true').toLowerCase() === 'true',
      downloadUrl: downloadMatch
        ? `${NASAA_BASE}${decodeHtml(downloadMatch[1]!).trim()}`
        : null,
    });
  }
  return out;
}

/** Pick the row that is the actual Franchise Disclosure Document. The
 *  exact label NASAA uses is "Franchise Disclosure Document". */
export function pickFddDocument(docs: NasaaDocument[]): NasaaDocument | null {
  return (
    docs.find(
      (d) =>
        d.downloadUrl &&
        d.docId &&
        /franchise disclosure document/i.test(d.docType)
    ) ?? null
  );
}

export async function downloadNasaaEfdPdf(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`NASAA EFD PDF GET returned ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (!ct.includes('pdf') && buf.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error(
      `NASAA EFD PDF response not a PDF (content-type="${ct}", first-bytes="${buf
        .subarray(0, 8)
        .toString('hex')}")`
    );
  }
  return buf;
}

/** Two-letter USPS abbreviations for the states we expect to see in the
 *  Registrations table. NASAA uses full state names ("South Dakota") in
 *  the table; we persist `filing_state` as the abbreviation. */
const STATE_ABBREV: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR',
  california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME',
  maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE',
  nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'puerto rico': 'PR', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
  texas: 'TX', utah: 'UT', vermont: 'VT', 'virgin islands': 'VI',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
};

export function stateAbbrev(stateName: string): string | null {
  return STATE_ABBREV[stateName.trim().toLowerCase()] ?? null;
}
