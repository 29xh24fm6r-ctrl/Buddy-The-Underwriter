// src/lib/finance/normalize/normalizePfs.ts

export type PfsNormalized = {
  // Assets
  cashAndEquivalents: number;
  marketableSecurities: number;
  realEstate: number;
  retirementAccounts: number;
  otherInvestments: number;
  personalProperty: number;
  totalAssets: number;

  // Liabilities
  mortgageDebt: number;
  revolvingDebt: number;
  installmentDebt: number;
  otherDebt: number;
  totalLiabilities: number;

  // Net Worth
  netWorth: number;

  // Income (if available)
  annualIncome?: number;
  spouseIncome?: number;
  rentalIncome?: number;
  otherIncome?: number;
  totalIncome?: number;

  // Expenses (if available)
  housingExpense?: number;
  otherExpenses?: number;
  totalExpenses?: number;

  // Ratios
  debtToIncome?: number;
  liquidityRatio: number; // (Cash + Marketable) / Total Debt
};

export function normalizePfsFromC4(c4: unknown): PfsNormalized | null {
  if (!c4 || typeof c4 !== 'object') return null;

  // Initialize with zeros
  const normalized: PfsNormalized = {
    cashAndEquivalents: 0,
    marketableSecurities: 0,
    realEstate: 0,
    retirementAccounts: 0,
    otherInvestments: 0,
    personalProperty: 0,
    totalAssets: 0,
    mortgageDebt: 0,
    revolvingDebt: 0,
    installmentDebt: 0,
    otherDebt: 0,
    totalLiabilities: 0,
    netWorth: 0,
    liquidityRatio: 0,
  };

  try {
    // This would need to be implemented based on the actual C4 structure
    // For now, return a basic structure
    // In a real implementation, you'd parse the C4 JSON structure

    // Calculate totals
    normalized.totalAssets =
      normalized.cashAndEquivalents +
      normalized.marketableSecurities +
      normalized.realEstate +
      normalized.retirementAccounts +
      normalized.otherInvestments +
      normalized.personalProperty;

    normalized.totalLiabilities =
      normalized.mortgageDebt +
      normalized.revolvingDebt +
      normalized.installmentDebt +
      normalized.otherDebt;

    normalized.netWorth = normalized.totalAssets - normalized.totalLiabilities;

    // Calculate ratios
    if (normalized.totalLiabilities > 0) {
      normalized.liquidityRatio =
        (normalized.cashAndEquivalents + normalized.marketableSecurities) /
        normalized.totalLiabilities;
    }

    if (normalized.totalIncome && normalized.totalIncome > 0) {
      normalized.debtToIncome = normalized.totalLiabilities / normalized.totalIncome;
    }

    return normalized;
  } catch (error) {
    console.error('Error normalizing PFS:', error);
    return null;
  }
}