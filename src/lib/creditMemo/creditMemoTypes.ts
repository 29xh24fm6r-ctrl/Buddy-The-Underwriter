export type MemoSource = {
  title: string;
  url?: string | null;
  note?: string | null;
};

export type MemoSection = {
  id: string;
  title: string;
  body: string;
  bullets?: string[];
  sources?: MemoSource[];
  flags?: string[];
};

export type CreditMemoV1 = {
  version: "v1";
  deal_id: string;

  generated_at: string;

  doc_coverage: {
    years_detected: number[];
    has_1120s: boolean;
    has_pfs: boolean;
    has_financial_statement: boolean;
    notes?: string[];
  };

  executive_summary: {
    request_summary: string;
    conclusion_headline: string;
    key_strengths: string[];
    key_risks: string[];
  };

  underwriting_snapshot: {
    policy_min_dscr: number;
    ads: number | null;
    worst_year: number | null;
    worst_dscr: number | null;
    weighted_dscr: number | null;
    stressed_dscr: number | null;
    verdict_level: "approve" | "caution" | "decline_risk";
    verdict_rationale: string[];
  };

  sections: MemoSection[];

  research: {
    company?: {
      summary?: string;
      bullets?: string[];
      sources?: MemoSource[];
    };
    industry?: {
      summary?: string;
      bullets?: string[];
      sources?: MemoSource[];
    };
    owner?: {
      summary?: string;
      bullets?: string[];
      sources?: MemoSource[];
    };
    ran_at?: string;
  };
};
