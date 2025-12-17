// src/lib/finance/underwriting/creditMemoWriter.ts

import type { CreditMemoV1 } from "./creditMemoV1";

export type CreditMemoSections = {
  executiveSummary: string;
  financingRequest: string;
  sourcesAndUses: string;
  collateral: string;
  eligibility: string;
  businessAnalysis: string;
  management: string;
  financialAnalysis: string;
  personalFinancial: string;
  swot: string;
  conclusion: string;
};

export function generateCreditMemoNarrative(memo: CreditMemoV1): CreditMemoSections {
  return {
    executiveSummary: generateExecutiveSummary(memo),
    financingRequest: generateFinancingRequest(memo),
    sourcesAndUses: generateSourcesAndUses(memo),
    collateral: generateCollateral(memo),
    eligibility: generateEligibility(memo),
    businessAnalysis: generateBusinessAnalysis(memo),
    management: generateManagement(memo),
    financialAnalysis: generateFinancialAnalysis(memo),
    personalFinancial: generatePersonalFinancial(memo),
    swot: generateSwot(memo),
    conclusion: generateConclusion(memo),
  };
}

function generateExecutiveSummary(memo: CreditMemoV1): string {
  const { header, financingRequest, financialAnalysis } = memo;

  return `${header.applicantName}, a ${header.entityType} incorporated in ${header.incorporationDate ? new Date(header.incorporationDate).getFullYear() : 'recent years'}, is requesting ${formatCurrency(financingRequest.loanAmount)} for ${financingRequest.loanPurpose}.

The business operates as ${header.dbaName || header.applicantName} and has been in operation for ${header.yearsInBusiness || 'several'} years. Financial analysis shows ${financialAnalysis.dscr.compliance === 'pass' ? 'acceptable' : 'challenging'} debt service coverage with a worst-case DSCR of ${financialAnalysis.dscr.base?.toFixed(2) || 'N/A'}x.

${header.naicsCode ? `The business operates in NAICS ${header.naicsCode}${header.naicsDescription ? ` (${header.naicsDescription})` : ''}.` : ''}`;
}

function generateFinancingRequest(memo: CreditMemoV1): string {
  const { financingRequest } = memo;

  return `The applicant is requesting ${formatCurrency(financingRequest.loanAmount)} to be used for ${financingRequest.loanPurpose}. The proposed financing structure includes:

• Loan Amount: ${formatCurrency(financingRequest.loanAmount)}
• Term: ${financingRequest.termMonths} months
• Interest Rate: ${financingRequest.interestRate ? `${financingRequest.interestRate}%` : 'Market rate'}
• SBA Guarantee: ${financingRequest.sbaGuarantee ? `${financingRequest.sbaGuarantee}%` : 'None requested'}

The financing will support ${financingRequest.loanPurpose.toLowerCase()}.`;
}

function generateSourcesAndUses(memo: CreditMemoV1): string {
  const { financingRequest } = memo;

  if (!financingRequest.sourcesAndUses) {
    return 'Sources and uses statement not provided.';
  }

  const { sources, uses } = financingRequest.sourcesAndUses;

  let text = 'Sources of Funds:\n';
  sources.forEach(source => {
    text += `• ${source.description}: ${formatCurrency(source.amount)}\n`;
  });

  text += '\nUses of Funds:\n';
  uses.forEach(use => {
    text += `• ${use.description}: ${formatCurrency(use.amount)}\n`;
  });

  return text;
}

function generateCollateral(memo: CreditMemoV1): string {
  const { collateral } = memo;

  if (!collateral.realEstate?.length && !collateral.equipment?.length) {
    return 'No collateral analysis provided.';
  }

  let text = '';

  if (collateral.realEstate?.length) {
    text += 'Real Estate Collateral:\n';
    collateral.realEstate.forEach(property => {
      text += `• ${property.description}`;
      if (property.appraisedValue) text += ` - Appraised Value: ${formatCurrency(property.appraisedValue)}`;
      if (property.ltv) text += ` - LTV: ${(property.ltv * 100).toFixed(1)}%`;
      text += '\n';
    });
  }

  if (collateral.equipment?.length) {
    text += '\nEquipment Collateral:\n';
    collateral.equipment.forEach(equipment => {
      text += `• ${equipment.description}`;
      if (equipment.value) text += ` - Value: ${formatCurrency(equipment.value)}`;
      text += '\n';
    });
  }

  if (collateral.personalGuarantee) {
    text += '\nPersonal guarantee provided by owner(s).';
  }

  return text;
}

function generateEligibility(memo: CreditMemoV1): string {
  const { eligibility } = memo;

  let text = `SBA Eligibility: ${eligibility.sbaEligible ? 'Eligible' : 'Not Eligible'}\n`;
  text += `NAICS Eligibility: ${eligibility.naicsEligible ? 'Eligible' : 'Not Eligible'}\n`;

  if (eligibility.sizeStandard) {
    text += `Size Standard: ${eligibility.sizeStandard}\n`;
  }

  if (eligibility.notes.length) {
    text += '\nAdditional Notes:\n';
    eligibility.notes.forEach(note => {
      text += `• ${note}\n`;
    });
  }

  return text;
}

function generateBusinessAnalysis(memo: CreditMemoV1): string {
  const { businessAnalysis } = memo;

  let text = businessAnalysis.operations.description + '\n\n';

  text += `Products/Services: ${businessAnalysis.operations.productsServices.join(', ')}\n`;
  text += `Customer Base: ${businessAnalysis.operations.customerBase}\n`;
  text += `Geographic Markets: ${businessAnalysis.operations.geographicMarkets.join(', ')}\n`;

  if (businessAnalysis.operations.seasonality) {
    text += `Seasonality: ${businessAnalysis.operations.seasonality}\n`;
  }

  text += `Competition: ${businessAnalysis.operations.competition}\n\n`;

  text += `Industry Analysis: ${businessAnalysis.industry.naicsSummary}\n\n`;

  if (businessAnalysis.industry.demandDrivers.length) {
    text += 'Demand Drivers:\n';
    businessAnalysis.industry.demandDrivers.forEach(driver => {
      text += `• ${driver}\n`;
    });
  }

  return text;
}

function generateManagement(memo: CreditMemoV1): string {
  const { management } = memo;

  let text = '';

  management.owners.forEach(owner => {
    text += `${owner.name} (${owner.title}) - ${owner.ownershipPercentage}% ownership\n`;
    text += `Experience: ${owner.experience}\n`;

    if (owner.backgroundCheck) {
      text += `Background Check: ${owner.backgroundCheck.ofacClear ? 'OFAC Clear' : 'OFAC Review Required'}`;
      if (owner.backgroundCheck.criminalHistory) {
        text += ` - ${owner.backgroundCheck.criminalHistory}`;
      }
      text += '\n';
    }

    text += '\n';
  });

  if (management.keyEmployees?.length) {
    text += 'Key Employees:\n';
    management.keyEmployees.forEach(employee => {
      text += `• ${employee.name} (${employee.title}) - ${employee.experience}\n`;
    });
  }

  return text;
}

function generateFinancialAnalysis(memo: CreditMemoV1): string {
  const { financialAnalysis } = memo;

  let text = `Tax Return Analysis (${financialAnalysis.taxReturns.years.length} years):\n`;
  text += `Revenue Range: ${formatCurrency(Math.min(...Object.values(financialAnalysis.taxReturns.revenue)))} - ${formatCurrency(Math.max(...Object.values(financialAnalysis.taxReturns.revenue)))}\n`;
  text += `Revenue Growth: ${(financialAnalysis.taxReturns.trends.revenueGrowth * 100).toFixed(1)}%\n`;
  text += `Profitability Trend: ${financialAnalysis.taxReturns.trends.profitabilityTrend}\n\n`;

  text += `DSCR Analysis:\n`;
  text += `Policy Minimum: ${financialAnalysis.dscr.policyMin.toFixed(2)}x\n`;
  text += `Worst Case DSCR: ${financialAnalysis.dscr.base?.toFixed(2) || 'N/A'}x`;
  if (financialAnalysis.dscr.worstYear) {
    text += ` (Year ${financialAnalysis.dscr.worstYear})`;
  }
  text += `\nCompliance: ${financialAnalysis.dscr.compliance.toUpperCase()}\n\n`;

  if (financialAnalysis.globalCashFlow) {
    text += `Global Cash Flow Analysis:\n`;
    text += `Borrower Income: ${formatCurrency(financialAnalysis.globalCashFlow.borrowerIncome)}\n`;
    text += `Total Income: ${formatCurrency(financialAnalysis.globalCashFlow.totalIncome)}\n`;
    text += `Debt Payments: ${formatCurrency(financialAnalysis.globalCashFlow.debtPayments)}\n`;
    text += `Living Expenses: ${formatCurrency(financialAnalysis.globalCashFlow.livingExpenses)}\n`;
    text += `Surplus/(Deficit): ${formatCurrency(financialAnalysis.globalCashFlow.surplusDeficit)}\n\n`;
  }

  if (financialAnalysis.liquidity.currentRatio) {
    text += `Liquidity Ratios:\n`;
    text += `Current Ratio: ${financialAnalysis.liquidity.currentRatio.toFixed(2)}:1\n`;
    if (financialAnalysis.liquidity.quickRatio) {
      text += `Quick Ratio: ${financialAnalysis.liquidity.quickRatio.toFixed(2)}:1\n`;
    }
    if (financialAnalysis.liquidity.debtToEquity) {
      text += `Debt-to-Equity: ${financialAnalysis.liquidity.debtToEquity.toFixed(2)}:1\n`;
    }
  }

  return text;
}

function generatePersonalFinancial(memo: CreditMemoV1): string {
  const { personalFinancial } = memo;

  let text = `Net Worth: ${formatCurrency(personalFinancial.netWorth)}\n`;
  text += `Liquidity: ${formatCurrency(personalFinancial.liquidity)}\n`;

  if (personalFinancial.debtToIncome) {
    text += `Debt-to-Income Ratio: ${(personalFinancial.debtToIncome * 100).toFixed(1)}%\n`;
  }

  if (personalFinancial.globalCashFlow) {
    text += `\nMonthly Cash Flow:\n`;
    text += `Income: ${formatCurrency(personalFinancial.globalCashFlow.monthlyIncome)}\n`;
    text += `Expenses: ${formatCurrency(personalFinancial.globalCashFlow.monthlyExpenses)}\n`;
    text += `Surplus: ${formatCurrency(personalFinancial.globalCashFlow.monthlySurplus)}\n`;
  }

  return text;
}

function generateSwot(memo: CreditMemoV1): string {
  const { swot } = memo;

  let text = 'Strengths:\n';
  swot.strengths.forEach(strength => {
    text += `• ${strength}\n`;
  });

  text += '\nWeaknesses:\n';
  swot.weaknesses.forEach(weakness => {
    text += `• ${weakness}\n`;
  });

  if (swot.conditions.length) {
    text += '\nConditions:\n';
    swot.conditions.forEach(condition => {
      text += `• ${condition}\n`;
    });
  }

  if (swot.mitigants.length) {
    text += '\nMitigants:\n';
    swot.mitigants.forEach(mitigant => {
      text += `• ${mitigant}\n`;
    });
  }

  return text;
}

function generateConclusion(memo: CreditMemoV1): string {
  const { metadata } = memo;

  // This would be generated based on the overall analysis
  return `Based on the comprehensive analysis above, this credit request ${metadata.confidence.overall > 0.7 ? 'demonstrates' : 'requires additional consideration for'} acceptable risk characteristics for SBA financing.

Key considerations include ${metadata.warnings.length ? metadata.warnings.join(', ') : 'standard underwriting requirements'}.`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}