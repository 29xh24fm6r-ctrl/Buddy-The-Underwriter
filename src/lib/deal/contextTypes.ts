export type EvidenceRef = {
  id: string;              // stable id for memo anchors
  docId?: string;
  docName?: string;
  docType?: string;
  page?: number;
  table?: string;
  field?: string;
  excerpt?: string;        // short supporting snippet (optional)
  value?: string | number; // extracted value (optional)
  confidence?: number;     // 0-1
};

export type Facility = {
  name: string;
  amount: number;
  termMonths?: number;
  amortMonths?: number;
  rateType?: "FIXED" | "FLOATING";
  rate?: number; // nominal
  index?: string; // SOFR, Prime
  spreadBps?: number;
  fees?: Record<string, number>;
  purpose?: string;
};

export type CollateralItem = {
  type: string; // RE, A/R, Equipment, Inventory, etc.
  description: string;
  value: number;
  lienPosition?: string;
  evidence?: EvidenceRef[];
};

export type Borrower = {
  legalName: string;
  dba?: string;
  entityType?: string;
  naics?: string;
  state?: string;
  address?: string;
  yearsInBusiness?: number;
  employees?: number;
  evidence?: EvidenceRef[];
};

export type Sponsor = {
  name: string;
  role?: string;
  ownershipPct?: number;
  creditScore?: number;
  liquidity?: number;
  netWorth?: number;
  globalCashFlow?: {
    globalDSCR?: number;
    notes?: string;
  };
  evidence?: EvidenceRef[];
};

export type FinancialPeriod = {
  label: string; // "FY2023", "TTM", "Interim 06/30/2025"
  incomeStatement?: Record<string, number>;
  balanceSheet?: Record<string, number>;
  cashFlow?: Record<string, number>;
  evidence?: EvidenceRef[];
};

export type SpreadMetrics = {
  base: {
    dscr?: number;
    ltv?: number;
    leverage?: number;
    liquidity?: number;
    globalDscr?: number;
  };
  downside?: {
    dscr?: number;
    assumptions: string[];
  };
  rateShock?: {
    dscr?: number;
    deltaRateBps: number;
  };
  evidence?: EvidenceRef[];
};

export type DocumentExtract = {
  docId: string;
  docName: string;
  docType: string;
  extractedAt: string;
  fields: Record<string, any>; // key-value fields
  tables: Array<{
    name: string;
    columns: string[];
    rows: Array<Array<string | number>>;
  }>;
  evidence: EvidenceRef[]; // points into doc pages/tables/fields
};

export type DealContext = {
  dealId: string;
  dealName?: string;
  requestedClosingDate?: string;
  status?: string;

  borrower: Borrower;
  sponsors: Sponsor[];
  facilities: Facility[];
  sourcesUses?: {
    sources: Array<{ label: string; amount: number; evidence?: EvidenceRef[] }>;
    uses: Array<{ label: string; amount: number; evidence?: EvidenceRef[] }>;
  };
  collateral: CollateralItem[];

  financials: FinancialPeriod[];
  spread: SpreadMetrics;

  documents: Array<{
    docId: string;
    docName: string;
    docType: string;
    status: "RECEIVED" | "MISSING" | "REVIEWED";
  }>;
  extracts: DocumentExtract[];

  // high-level evidence inventory for memo generator to reference
  evidenceIndex: EvidenceRef[];
};
