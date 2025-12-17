// src/lib/finance/underwriting/creditMemoV1.ts

export type CreditMemoV1 = {
  // Header / General & Applicant Info
  header: {
    dealId: string;
    applicantName: string;
    dbaName?: string;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
    };
    phone?: string;
    email?: string;
    entityType: string; // LLC, Corp, Partnership, etc.
    ein?: string;
    naicsCode?: string;
    naicsDescription?: string;
    incorporationDate?: string;
    yearsInBusiness?: number;
  };

  // Financing Request + Deal Summary
  financingRequest: {
    loanAmount: number;
    loanPurpose: string;
    termMonths: number;
    interestRate?: number;
    sbaGuarantee?: number; // percentage
    sourcesAndUses?: {
      sources: Array<{ description: string; amount: number }>;
      uses: Array<{ description: string; amount: number }>;
    };
  };

  // Collateral Analysis
  collateral: {
    realEstate?: Array<{
      description: string;
      appraisedValue?: number;
      lienPosition?: number;
      ltv?: number;
    }>;
    equipment?: Array<{
      description: string;
      value?: number;
    }>;
    accountsReceivable?: {
      value?: number;
      concentration?: string;
    };
    inventory?: {
      value?: number;
    };
    personalGuarantee?: boolean;
    crossCollateralization?: boolean;
  };

  // Eligibility / NAICS / SOP notes
  eligibility: {
    sbaEligible: boolean;
    naicsEligible: boolean;
    sizeStandard?: string;
    ruralDevelopment?: boolean;
    disasterRelief?: boolean;
    exportRelated?: boolean;
    notes: string[];
  };

  // Business & Industry Analysis
  businessAnalysis: {
    operations: {
      description: string;
      productsServices: string[];
      customerBase: string;
      geographicMarkets: string[];
      seasonality?: string;
      competition: string;
    };
    industry: {
      naicsSummary: string;
      demandDrivers: string[];
      cyclicality: string;
      regulationRisk: string;
      competitionLevel: string;
      outlook: string;
      sources: Array<{ title: string; url: string; date?: string }>;
    };
  };

  // Management Qualifications
  management: {
    owners: Array<{
      name: string;
      title: string;
      experience: string;
      ownershipPercentage: number;
      backgroundCheck?: {
        ofacClear: boolean;
        criminalHistory?: string;
        creditScore?: number;
      };
    }>;
    keyEmployees?: Array<{
      name: string;
      title: string;
      experience: string;
    }>;
    successionPlan?: string;
  };

  // Financial Analysis
  financialAnalysis: {
    taxReturns: {
      years: number[];
      revenue: Record<number, number>;
      netIncome: Record<number, number>;
      trends: {
        revenueGrowth: number;
        profitabilityTrend: string;
      };
    };
    dscr: {
      base: number;
      stressed?: number;
      policyMin: number;
      compliance: 'pass' | 'near' | 'fail';
      worstYear?: number;
    };
    globalCashFlow?: {
      borrowerIncome: number;
      spouseIncome?: number;
      rentalIncome?: number;
      otherIncome?: number;
      totalIncome: number;
      debtPayments: number;
      livingExpenses: number;
      surplusDeficit: number;
    };
    liquidity: {
      currentRatio?: number;
      quickRatio?: number;
      debtToEquity?: number;
      workingCapital?: number;
    };
    stressTests: Array<{
      scenario: string;
      dscr: number;
      verdict: 'approve' | 'caution' | 'decline_risk';
    }>;
  };

  // PFS + Personal Budget / Global
  personalFinancial: {
    netWorth: number;
    liquidity: number;
    debtToIncome?: number;
    globalCashFlow?: {
      monthlyIncome: number;
      monthlyExpenses: number;
      monthlySurplus: number;
    };
    assets: Array<{
      type: string;
      description: string;
      value: number;
    }>;
    liabilities: Array<{
      type: string;
      description: string;
      balance: number;
      monthlyPayment: number;
    }>;
  };

  // Strengths / Weaknesses / Conditions
  swot: {
    strengths: string[];
    weaknesses: string[];
    conditions: string[];
    mitigants: string[];
  };

  // Research & Sources
  research: {
    company: {
      website?: string;
      description?: string;
      reputation?: string;
      news?: Array<{ title: string; url: string; date: string }>;
      sources: Array<{ title: string; url: string }>;
    };
    industry: {
      summary: string;
      risks: string[];
      opportunities: string[];
      sources: Array<{ title: string; url: string }>;
    };
    owners: Array<{
      name: string;
      background?: string;
      experience?: string;
      reputation?: string;
      sources: Array<{ title: string; url: string }>;
    }>;
  };

  // Document Pack Coverage
  documentCoverage: {
    taxReturns: Record<number, {
      present: boolean;
      confidence: number;
      source: string;
    }>;
    pfs: {
      present: boolean;
      confidence: number;
      source?: string;
    };
    businessFinancials: {
      present: boolean;
      years: number[];
      confidence: number;
      source?: string;
    };
    debtSchedule: {
      present: boolean;
      confidence: number;
      source?: string;
    };
    leaseEvidence: {
      present: boolean;
      confidence: number;
      source?: string;
    };
    missingDocuments: string[];
    recommendations: string[];
  };

  // Metadata
  metadata: {
    generatedAt: string;
    version: string;
    confidence: {
      overall: number;
      financials: number;
      research: number;
      documents: number;
    };
    warnings: string[];
  };
};