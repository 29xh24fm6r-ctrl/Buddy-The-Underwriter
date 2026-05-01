import { callGeminiForExtraction } from './geminiClient.js';
import { slicePdfPages } from './pdfPageExtractor.js';
import type {
  Item5Result,
  Item6Result,
  Item7Result,
  Item19Result,
  Item20Result,
  TocResult,
} from './types.js';

/** Bracket size around an item's TOC-reported start page. The TOC often
 *  understates by a page or two (page 76 in the TOC may actually be 78
 *  in the PDF if the front matter is unnumbered). A ±2 buffer on each
 *  side and a 6-8 page span downstream catches almost every layout. */
const ITEM_PAGE_BUFFER_BEFORE = 2;

function pageRange(start: number | null, after: number, totalPages: number): {
  startPage: number;
  endPage: number;
} | null {
  if (!start) return null;
  const startPage = Math.max(1, start - ITEM_PAGE_BUFFER_BEFORE);
  const endPage = Math.min(totalPages, start + after);
  return { startPage, endPage };
}

const ITEM_5_6_PROMPT = `You are extracting fee information from a Franchise Disclosure Document (FDD).

The pages provided contain Item 5 (Initial Franchise Fee) and possibly Item 6 (Other Fees).

ITEM 5 — Initial Franchise Fee:
- franchise_fee: The initial franchise fee amount. If a single value, use it for both min and max. If a range (e.g. "$25,000 to $50,000"), capture both. If tiered by territory size, use the lowest value for min and highest for max.
- franchise_fee_refundable: Is the fee refundable? (true/false)

ITEM 6 — Other Fees:
- royalty_pct: Ongoing royalty as a DECIMAL fraction of gross sales (e.g. 0.06 for 6%, 0.045 for 4.5%). If royalty is a fixed dollar amount, set royalty_pct to null and royalty_type="fixed".
- royalty_type: "percentage", "fixed", or "graduated"
- ad_fund_pct: Advertising/marketing fund as a DECIMAL fraction (e.g. 0.02 for 2%)
- technology_fee_monthly: Monthly technology/systems fee in dollars (if disclosed)

If a field cannot be confidently determined from the pages, return null for that field.

Return JSON:
{
  "item_5": {
    "franchise_fee_min": <number|null>,
    "franchise_fee_max": <number|null>,
    "refundable": <boolean|null>
  },
  "item_6": {
    "royalty_pct": <number|null>,
    "royalty_type": "<string|null>",
    "ad_fund_pct": <number|null>,
    "technology_fee_monthly": <number|null>
  }
}`;

const ITEM_7_PROMPT = `You are extracting the Estimated Initial Investment table from a Franchise Disclosure Document (FDD) Item 7.

Item 7 lists each expense category with a low and high estimate. Below the table, the franchisor often discloses net worth and liquidity requirements for prospective franchisees.

Extract:
- total_investment_min: TOTAL row, low column
- total_investment_max: TOTAL row, high column
- net_worth_requirement: Required net worth (numeric, in dollars). If a range, use the higher.
- liquidity_requirement: Required liquid capital (numeric, in dollars). If a range, use the higher.
- line_items: Each row of the Item 7 table — category name + low/high amounts + brief notes if any

If a field cannot be confidently determined, return null.

Return JSON:
{
  "total_investment_min": <number|null>,
  "total_investment_max": <number|null>,
  "net_worth_requirement": <number|null>,
  "liquidity_requirement": <number|null>,
  "line_items": [
    { "category": "<string>", "amount_low": <number|null>, "amount_high": <number|null>, "notes": "<string|null>" }
  ]
}`;

const ITEM_19_PROMPT = `You are extracting financial performance data from Item 19 of a Franchise Disclosure Document (FDD).

Item 19 contains Financial Performance Representations — actual financial performance data from existing franchise units. Not all franchisors include this item. If the pages say "We do not make any financial performance representations" or similar, return has_item_19: false.

Extract ALL metrics disclosed. Common metrics include:
- AVERAGE_UNIT_VOLUME, MEDIAN_GROSS_REVENUE, AVERAGE_GROSS_REVENUE
- AVERAGE_NET_INCOME, MEDIAN_NET_INCOME, NET_INCOME
- COGS_PCT, LABOR_PCT, OCCUPANCY_PCT
- EBITDA, EBITDA_MARGIN
- GROSS_PROFIT, GROSS_PROFIT_MARGIN

For each metric, capture:
- metric_name: standardized SCREAMING_SNAKE_CASE name from the list above (or invent a similar one if needed)
- value: the numeric value (raw — e.g. 421000 for $421,000; 0.32 for 32%)
- metric_type: "currency" or "percentage" or "count"
- cohort_definition: what subset of units this applies to (e.g. "All units open 2+ years", "Top quartile", "Units in operation full calendar year 2024", "All franchised outlets")
- cohort_size: number of units in the cohort (n=)
- percentile_rank: if this is a percentile metric (use 0.25, 0.50, 0.75, 0.90 etc.)
- source_page: 1-indexed page number where this data appears in the slice provided

Return JSON:
{
  "has_item_19": <boolean>,
  "fiscal_year": <number|null>,
  "metrics": [
    {
      "metric_name": "<string>",
      "value": <number|null>,
      "metric_type": "<string>",
      "cohort_definition": "<string|null>",
      "cohort_size": <number|null>,
      "percentile_rank": <number|null>,
      "source_page": <number|null>
    }
  ],
  "notes": "<caveats or important footnotes>"
}`;

const ITEM_20_PROMPT = `You are extracting franchise unit count data from Item 20 of a Franchise Disclosure Document.

Item 20 has multiple tables; you want the SUMMARY table for the most recent fiscal year, showing:
- Total units at end of fiscal year (franchised + company-owned, if combined)
- Units opened
- Units closed (terminations + non-renewals)
- Units transferred (sales of operating units between franchisees)
- Company-owned outlets (separate count if disclosed)

Use the most recent year shown in the table.

Return JSON:
{
  "fiscal_year": <number|null>,
  "total_units": <number|null>,
  "units_opened": <number|null>,
  "units_closed": <number|null>,
  "units_transferred": <number|null>,
  "company_owned": <number|null>
}`;

interface RawItem5_6 {
  item_5?: { franchise_fee_min?: unknown; franchise_fee_max?: unknown; refundable?: unknown };
  item_6?: {
    royalty_pct?: unknown;
    royalty_type?: unknown;
    ad_fund_pct?: unknown;
    technology_fee_monthly?: unknown;
  };
}

interface RawItem7 {
  total_investment_min?: unknown;
  total_investment_max?: unknown;
  net_worth_requirement?: unknown;
  liquidity_requirement?: unknown;
  line_items?: Array<{ category?: unknown; amount_low?: unknown; amount_high?: unknown; notes?: unknown }>;
}

interface RawItem19 {
  has_item_19?: unknown;
  fiscal_year?: unknown;
  metrics?: Array<{
    metric_name?: unknown;
    value?: unknown;
    metric_type?: unknown;
    cohort_definition?: unknown;
    cohort_size?: unknown;
    percentile_rank?: unknown;
    source_page?: unknown;
  }>;
  notes?: unknown;
}

interface RawItem20 {
  fiscal_year?: unknown;
  total_units?: unknown;
  units_opened?: unknown;
  units_closed?: unknown;
  units_transferred?: unknown;
  company_owned?: unknown;
}

function num(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}
function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.floor(n);
}
function str(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim();
}
function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  return null;
}

export async function extractItem5And6(
  pdfBuffer: Buffer,
  toc: TocResult
): Promise<{ item5: Item5Result | null; item6: Item6Result | null; modelUsed: string }> {
  const range = pageRange(toc.item5Page, 8, toc.totalPages);
  if (!range) return { item5: null, item6: null, modelUsed: '' };

  const slice = await slicePdfPages(pdfBuffer, range.startPage, range.endPage);
  const res = await callGeminiForExtraction<RawItem5_6>({
    logTag: 'items5_6',
    prompt: ITEM_5_6_PROMPT,
    pdfBase64: slice.pdf.toString('base64'),
  });
  if (!res.ok || !res.result) {
    return { item5: null, item6: null, modelUsed: res.modelUsed };
  }
  const r = res.result;
  const item5 = r.item_5
    ? {
        franchiseFeeMin: num(r.item_5.franchise_fee_min),
        franchiseFeeMax: num(r.item_5.franchise_fee_max),
        refundable: bool(r.item_5.refundable),
      }
    : null;
  const item6 = r.item_6
    ? {
        royaltyPct: num(r.item_6.royalty_pct),
        royaltyType: str(r.item_6.royalty_type),
        adFundPct: num(r.item_6.ad_fund_pct),
        technologyFeeMonthly: num(r.item_6.technology_fee_monthly),
      }
    : null;
  return { item5, item6, modelUsed: res.modelUsed };
}

export async function extractItem7(
  pdfBuffer: Buffer,
  toc: TocResult
): Promise<{ item7: Item7Result | null; modelUsed: string }> {
  const range = pageRange(toc.item7Page, 6, toc.totalPages);
  if (!range) return { item7: null, modelUsed: '' };

  const slice = await slicePdfPages(pdfBuffer, range.startPage, range.endPage);
  const res = await callGeminiForExtraction<RawItem7>({
    logTag: 'item7',
    prompt: ITEM_7_PROMPT,
    pdfBase64: slice.pdf.toString('base64'),
  });
  if (!res.ok || !res.result) {
    return { item7: null, modelUsed: res.modelUsed };
  }
  const r = res.result;
  return {
    item7: {
      totalInvestmentMin: num(r.total_investment_min),
      totalInvestmentMax: num(r.total_investment_max),
      netWorthRequirement: num(r.net_worth_requirement),
      liquidityRequirement: num(r.liquidity_requirement),
      lineItems: Array.isArray(r.line_items)
        ? r.line_items.map((li) => ({
            category: str(li.category) ?? '',
            amountLow: num(li.amount_low),
            amountHigh: num(li.amount_high),
            notes: str(li.notes) ?? undefined,
          }))
        : [],
    },
    modelUsed: res.modelUsed,
  };
}

export async function extractItem19(
  pdfBuffer: Buffer,
  toc: TocResult
): Promise<{ item19: Item19Result | null; modelUsed: string }> {
  if (!toc.item19Present || !toc.item19Page) {
    return { item19: { hasItem19: false, fiscalYear: null, metrics: [] }, modelUsed: '' };
  }
  // Item 19 commonly spans 5-15 pages with multiple cohort tables; cast a
  // wider net than the other items.
  const range = pageRange(toc.item19Page, 14, toc.totalPages);
  if (!range) return { item19: null, modelUsed: '' };

  const slice = await slicePdfPages(pdfBuffer, range.startPage, range.endPage);
  const res = await callGeminiForExtraction<RawItem19>({
    logTag: 'item19',
    prompt: ITEM_19_PROMPT,
    pdfBase64: slice.pdf.toString('base64'),
    timeoutMs: 90_000, // bigger PDF slice → slower response
  });
  if (!res.ok || !res.result) {
    return { item19: null, modelUsed: res.modelUsed };
  }
  const r = res.result;
  const has = bool(r.has_item_19) ?? false;
  return {
    item19: {
      hasItem19: has,
      fiscalYear: int(r.fiscal_year),
      metrics: !has || !Array.isArray(r.metrics)
        ? []
        : r.metrics
            .filter((m) => str(m.metric_name) !== null)
            .map((m) => ({
              metricName: (str(m.metric_name) ?? '').toUpperCase().replace(/\s+/g, '_'),
              value: num(m.value),
              metricType: str(m.metric_type) ?? 'currency',
              cohortDefinition: str(m.cohort_definition),
              cohortSize: int(m.cohort_size),
              percentileRank: num(m.percentile_rank),
              sourcePage: int(m.source_page),
            })),
      notes: str(r.notes) ?? undefined,
    },
    modelUsed: res.modelUsed,
  };
}

export async function extractItem20(
  pdfBuffer: Buffer,
  toc: TocResult
): Promise<{ item20: Item20Result | null; modelUsed: string }> {
  // Item 20 has multiple tables — give it 8 pages of headroom.
  const range = pageRange(toc.item20Page, 8, toc.totalPages);
  if (!range) return { item20: null, modelUsed: '' };

  const slice = await slicePdfPages(pdfBuffer, range.startPage, range.endPage);
  const res = await callGeminiForExtraction<RawItem20>({
    logTag: 'item20',
    prompt: ITEM_20_PROMPT,
    pdfBase64: slice.pdf.toString('base64'),
  });
  if (!res.ok || !res.result) {
    return { item20: null, modelUsed: res.modelUsed };
  }
  const r = res.result;
  return {
    item20: {
      fiscalYear: int(r.fiscal_year),
      totalUnits: int(r.total_units),
      unitsOpened: int(r.units_opened),
      unitsClosed: int(r.units_closed),
      unitsTransferred: int(r.units_transferred),
      companyOwned: int(r.company_owned),
    },
    modelUsed: res.modelUsed,
  };
}
