export interface FilingRow {
  id: string;
  brandId: string;
  brandName: string;
  filingState: string;
  filingYear: number;
  gcsPath: string;
  pdfSha256: string | null;
}

export interface TocResult {
  item5Page: number | null;
  item6Page: number | null;
  item7Page: number | null;
  item19Page: number | null;
  item19Present: boolean;
  item20Page: number | null;
  totalPages: number;
  notes?: string;
}

export interface Item5Result {
  franchiseFeeMin: number | null;
  franchiseFeeMax: number | null;
  refundable: boolean | null;
}

export interface Item6Result {
  royaltyPct: number | null;
  royaltyType: string | null;
  adFundPct: number | null;
  technologyFeeMonthly: number | null;
}

export interface Item7LineItem {
  category: string;
  amountLow: number | null;
  amountHigh: number | null;
  notes?: string;
}

export interface Item7Result {
  totalInvestmentMin: number | null;
  totalInvestmentMax: number | null;
  netWorthRequirement: number | null;
  liquidityRequirement: number | null;
  lineItems: Item7LineItem[];
}

export interface Item19Metric {
  metricName: string;
  value: number | null;
  metricType: 'currency' | 'percentage' | 'count' | string;
  cohortDefinition: string | null;
  cohortSize: number | null;
  percentileRank: number | null;
  sourcePage: number | null;
}

export interface Item19Result {
  hasItem19: boolean;
  fiscalYear: number | null;
  metrics: Item19Metric[];
  notes?: string;
}

export interface Item20Result {
  fiscalYear: number | null;
  totalUnits: number | null;
  unitsOpened: number | null;
  unitsClosed: number | null;
  unitsTransferred: number | null;
  companyOwned: number | null;
}

export interface ExtractionResult {
  toc: TocResult;
  item5: Item5Result | null;
  item6: Item6Result | null;
  item7: Item7Result | null;
  item19: Item19Result | null;
  item20: Item20Result | null;
  modelUsed: string;
  cacheHitFromFilingId?: string;
}

export interface ExtractionStats {
  processed: number;
  completed: number;
  cacheHits: number;
  failed: number;
  skippedNoToc: number;
  noItem19: number;
  item19RowsUpserted: number;
  brandsUpdated: number;
  errors: Array<{ filing_id: string; brand_name: string; error: string }>;
  remaining: number;
  runId: string;
}
