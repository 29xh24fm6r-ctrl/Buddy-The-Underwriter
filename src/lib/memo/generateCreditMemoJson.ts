import type { RiskFacts } from "../risk/normalizeRiskFacts";
import type { PricingQuote } from "../pricing/generatePricingQuote";

export type CreditMemoContent = {
  header: {
    deal_name: string;
    borrower: string;
    date: string;
    prepared_by: string;
    request_summary: string;
  };
  executive_summary: {
    narrative: string;
    key_risks: string[];
    mitigants: string[];
  };
  transaction_overview: {
    loan_request: {
      amount: number;
      purpose: string;
      term_months: number;
    };
    sources_and_uses: {
      sources: Array<{ item: string; amount: number }>;
      uses: Array<{ item: string; amount: number }>;
    };
    structure: string[];
  };
  borrower_sponsor: {
    background: string;
    experience: string;
    guarantor_strength: string;
  };
  collateral: {
    property_description: string;
    market_analysis: string;
    valuation: {
      as_is: number | null;
      stabilized: number | null;
      method: string;
    };
    condition: string;
  };
  financial_analysis: {
    income_analysis: string;
    expense_analysis: string;
    noi: number | null;
    dscr: number | null;
    stress_tests: Array<{ scenario: string; result: string }>;
  };
  risk_factors: Array<{
    risk: string;
    severity: "low" | "medium" | "high";
    mitigants: string[];
  }>;
  policy_exceptions: Array<{
    exception: string;
    rationale: string;
    mitigants: string[];
  }>;
  proposed_terms: PricingQuote | null;
  conditions: {
    precedent: string[];
    ongoing: string[];
  };
  appendix: {
    tables: any[];
    raw_metrics: Record<string, any>;
  };
  references: {
    snapshot_id: string;
    risk_facts_id: string;
    pricing_quote_id: string | null;
    facts_hash: string;
  };
};

/**
 * Generate credit memo JSON from risk facts and optional pricing quote
 */
export function generateCreditMemoJson(
  snapshotId: string,
  riskFactsId: string,
  factsHash: string,
  facts: RiskFacts,
  pricingQuote: PricingQuote | null,
  pricingQuoteId: string | null
): CreditMemoContent {
  const today = new Date().toLocaleDateString();

  const memo: CreditMemoContent = {
    header: {
      deal_name: facts.borrower.entity_name,
      borrower: facts.borrower.entity_name,
      date: today,
      prepared_by: "Buddy The Underwriter (AI)",
      request_summary: `${formatCurrency(facts.loan.requested_amount)} ${facts.loan.purpose ?? "loan request"}`,
    },

    executive_summary: {
      narrative: generateExecutiveSummary(facts, pricingQuote),
      key_risks: identifyKeyRisks(facts),
      mitigants: identifyMitigants(facts),
    },

    transaction_overview: {
      loan_request: {
        amount: facts.loan.requested_amount ?? 0,
        purpose: facts.loan.purpose ?? "Not specified",
        term_months: facts.loan.term_months ?? 0,
      },
      sources_and_uses: {
        sources: [
          { item: "Proposed Loan", amount: facts.loan.requested_amount ?? 0 },
          { item: "Borrower Equity", amount: 0 }, // Would calculate from context
        ],
        uses: [
          { item: "Property Acquisition/Refinance", amount: facts.loan.requested_amount ?? 0 },
        ],
      },
      structure: [
        `Loan Amount: ${formatCurrency(facts.loan.requested_amount)}`,
        `Term: ${facts.loan.term_months ?? "TBD"} months`,
        `Recourse: ${facts.loan.recourse_type ?? "TBD"}`,
        pricingQuote ? `Rate: ${(pricingQuote.rate.all_in_rate * 100).toFixed(2)}%` : "",
      ].filter(Boolean),
    },

    borrower_sponsor: {
      background: `${facts.borrower.entity_name} with ${facts.borrower.guarantors.length} guarantor(s): ${facts.borrower.guarantors.join(", ")}`,
      experience: `Sponsor experience: ${facts.borrower.sponsor_experience_years ?? "Not specified"} years`,
      guarantor_strength: `Net Worth: ${formatCurrency(facts.financial.net_worth)}, Liquidity: ${formatCurrency(facts.financial.liquidity)}`,
    },

    collateral: {
      property_description: `${facts.collateral.property_type ?? "Property"} located at ${facts.collateral.address ?? "Address TBD"}`,
      market_analysis: `Occupancy: ${facts.collateral.occupancy ?? "N/A"}%`,
      valuation: {
        as_is: facts.collateral.as_is_value,
        stabilized: facts.collateral.stabilized_value,
        method: "Third-party appraisal",
      },
      condition: "Subject to inspection",
    },

    financial_analysis: {
      income_analysis: `NOI: ${formatCurrency(facts.financial.noi)}`,
      expense_analysis: "Subject to review",
      noi: facts.financial.noi,
      dscr: facts.collateral.dscr,
      stress_tests: [
        {
          scenario: "Base Case",
          result: `DSCR: ${facts.collateral.dscr?.toFixed(2) ?? "N/A"}x`,
        },
        {
          scenario: "10% Vacancy",
          result: facts.collateral.dscr ? `DSCR: ${(facts.collateral.dscr * 0.9).toFixed(2)}x` : "N/A",
        },
      ],
    },

    risk_factors: [
      ...facts.exceptions.map(e => ({
        risk: e.policy,
        severity: e.severity,
        mitigants: [e.description],
      })),
      ...(facts.collateral.dscr && facts.collateral.dscr < 1.25
        ? [{
            risk: "Low DSCR",
            severity: "medium" as const,
            mitigants: ["Additional reserves required", "Guarantor support"],
          }]
        : []),
    ],

    policy_exceptions: facts.exceptions.map(e => ({
      exception: e.policy,
      rationale: e.description,
      mitigants: ["Subject to senior credit approval"],
    })),

    proposed_terms: pricingQuote,

    conditions: {
      precedent: pricingQuote?.conditions.precedent ?? [
        "Satisfactory appraisal",
        "Environmental clearance",
        "Title insurance",
      ],
      ongoing: pricingQuote?.conditions.ongoing ?? [
        "Quarterly financial reporting",
        "Maintain required insurance",
      ],
    },

    appendix: {
      tables: [],
      raw_metrics: {
        ltv: facts.collateral.ltv,
        dscr: facts.collateral.dscr,
        noi: facts.financial.noi,
        occupancy: facts.collateral.occupancy,
      },
    },

    references: {
      snapshot_id: snapshotId,
      risk_facts_id: riskFactsId,
      pricing_quote_id: pricingQuoteId,
      facts_hash: factsHash,
    },
  };

  return memo;
}

function generateExecutiveSummary(facts: RiskFacts, quote: PricingQuote | null): string {
  const parts = [
    `${facts.borrower.entity_name} requests ${formatCurrency(facts.loan.requested_amount)} for ${facts.loan.purpose ?? "financing"}.`,
    `Collateral: ${facts.collateral.property_type ?? "Property"} at ${facts.collateral.address ?? "TBD"}.`,
    facts.collateral.dscr ? `DSCR: ${facts.collateral.dscr.toFixed(2)}x.` : "",
    facts.collateral.ltv ? `LTV: ${facts.collateral.ltv}%.` : "",
    quote ? `Proposed rate: ${(quote.rate.all_in_rate * 100).toFixed(2)}%.` : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function identifyKeyRisks(facts: RiskFacts): string[] {
  const risks: string[] = [];

  if (facts.collateral.dscr && facts.collateral.dscr < 1.25) {
    risks.push("DSCR below 1.25x threshold");
  }
  if (facts.collateral.ltv && facts.collateral.ltv > 75) {
    risks.push("LTV above 75%");
  }
  if (facts.collateral.occupancy && facts.collateral.occupancy < 85) {
    risks.push("Occupancy below 85%");
  }
  if (facts.exceptions.length > 0) {
    risks.push(`${facts.exceptions.length} policy exception(s)`);
  }

  return risks.length > 0 ? risks : ["Standard commercial real estate risks"];
}

function identifyMitigants(facts: RiskFacts): string[] {
  const mitigants: string[] = [];

  if (facts.borrower.guarantors.length > 0) {
    mitigants.push(`Strong guarantor support (${facts.borrower.guarantors.length} guarantor(s))`);
  }
  if (facts.borrower.sponsor_experience_years && facts.borrower.sponsor_experience_years >= 10) {
    mitigants.push("Experienced sponsor with 10+ years");
  }
  if (facts.loan.recourse_type === "full-recourse") {
    mitigants.push("Full recourse loan structure");
  }

  return mitigants.length > 0 ? mitigants : ["Standard underwriting mitigants"];
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
